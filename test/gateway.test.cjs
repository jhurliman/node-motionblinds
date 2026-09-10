'use strict'
const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const dgram = require('node:dgram')
const {
  MotionGateway,
  DEVICE_TYPE_BLIND,
  DEVICE_TYPE_GATEWAY,
  DEVICE_TYPE_GATEWAY_LEGACY,
  MULTICAST_IP,
  UDP_PORT_RECEIVE,
} = require('../dist')
const flush = () => new Promise((resolve) => setImmediate(resolve))
const address = { address: '192.0.2.1', port: 32100, family: 'IPv4', size: 100 }
class Socket extends EventEmitter {
  constructor() {
    super()
    this.sent = []
    this.closed = 0
  }
  bind(...args) {
    this.binding = args
    queueMicrotask(() => this.emit('listening'))
  }
  addMembership(...args) {
    this.membership = args
  }
  setMulticastInterface(value) {
    this.interface = value
  }
  send(payload, port, host, callback) {
    this.sent.push({ message: JSON.parse(payload), port, host })
    queueMicrotask(() => callback(null))
  }
  close() {
    this.closed++
  }
}
function setup(t, options = {}) {
  const sockets = []
  mock.method(dgram, 'createSocket', () => {
    const socket = new Socket()
    sockets.push(socket)
    return socket
  })
  const gateway = new MotionGateway(options)
  t.after(() => {
    gateway.stop()
    mock.restoreAll()
  })
  function reply(index = 0, overrides = {}, socket = gateway.sendSocket) {
    const request = gateway.sendSocket.sent[index].message
    const response =
      request.msgType === 'GetDeviceList'
        ? {
            msgType: 'GetDeviceListAck',
            mac: 'gateway',
            token: '0123456789abcdef',
            deviceType: DEVICE_TYPE_GATEWAY,
            ProtocolVersion: '0.9',
            data: [],
          }
        : {
            msgType: request.msgType + 'Ack',
            mac: request.mac,
            deviceType: request.deviceType,
            msgID: request.msgID,
            data: {},
          }
    socket.emit('message', Buffer.from(JSON.stringify({ ...response, ...overrides })), address)
  }
  return { gateway, sockets, reply }
}

test('AES access token matches the vendor vector, and invalid inputs reject', () => {
  assert.equal(
    MotionGateway.AccessToken('74ae544c-d16e-4c', '37412C478E0FBEAB'),
    '8570A96BC18ADB21D1FC155B24ECFD73'
  )
  assert.throws(() => MotionGateway.AccessToken('short', 'short'), RangeError)
  assert.equal(MotionGateway.BatteryInfo(844)[1], 1)
  assert.ok(Math.abs(MotionGateway.BatteryInfo(1232)[1] - 0.872727272727273) < 1e-12)
  assert.throws(() => MotionGateway.BatteryInfo(NaN), RangeError)
})

test('start is idempotent and binds the wildcard address before multicast membership (#12/#13)', async (t) => {
  const f = setup(t, { multicastInterface: '192.0.2.2' })
  f.gateway.start()
  f.gateway.start()
  await flush()
  assert.equal(f.sockets.length, 2)
  assert.deepEqual(f.sockets[1].binding, [UDP_PORT_RECEIVE, '0.0.0.0'])
  assert.deepEqual(f.sockets[1].membership, [MULTICAST_IP, '192.0.2.2'])
  f.gateway.stop()
  f.gateway.stop()
  assert.deepEqual(
    f.sockets.map((s) => s.closed),
    [1, 1]
  )
})

test('concurrent requests to one device are serialized, including differently-cased MACs', async (t) => {
  const f = setup(t)
  const first = f.gateway.readDevice('AABB', DEVICE_TYPE_BLIND)
  const second = f.gateway.readDevice('aabb', DEVICE_TYPE_BLIND)
  await flush()
  assert.equal(f.gateway.sendSocket.sent.length, 1)
  f.reply(0)
  await first
  await flush()
  assert.equal(f.gateway.sendSocket.sent.length, 2)
  let resolved = false
  second.then(() => {
    resolved = true
  })
  f.reply(0)
  await flush()
  assert.equal(resolved, false)
  f.reply(1)
  await second
  assert.equal(f.gateway.callbacks.size, 0)
})

test('concurrent discovery requests complete separately instead of overwriting callbacks', async (t) => {
  const f = setup(t)
  const first = f.gateway.getDeviceList()
  const second = f.gateway.getDeviceList()
  await flush()
  f.reply(0)
  await first
  await flush()
  f.reply(1)
  await second
  assert.equal(f.gateway.sendSocket.sent.length, 2)
})

test('acknowledgements on the receive socket resolve requests and lists retain 28 devices (#9)', async (t) => {
  const f = setup(t)
  const result = f.gateway.getDeviceList()
  await flush()
  const devices = Array.from({ length: 28 }, (_, index) => ({
    mac: String(index),
    deviceType: DEVICE_TYPE_BLIND,
  }))
  f.reply(0, { data: devices }, f.gateway.recvSocket)
  assert.deepEqual((await result).data, devices)
})

test('readAllDevices skips both known gateway type codes', async (t) => {
  const f = setup(t)
  const result = f.gateway.readAllDevices()
  await flush()
  f.reply(0, {
    data: [
      { mac: 'gateway1', deviceType: DEVICE_TYPE_GATEWAY },
      { mac: 'gateway2', deviceType: DEVICE_TYPE_GATEWAY_LEGACY },
      { mac: 'blind', deviceType: DEVICE_TYPE_BLIND },
    ],
  })
  await flush()
  assert.equal(f.gateway.sendSocket.sent.length, 2)
  f.reply(1)
  assert.equal((await result).length, 1)
})

test('stop rejects active and queued requests and old socket errors cannot stop a restarted client', async (t) => {
  const f = setup(t)
  const results = Promise.allSettled([f.gateway.getDeviceList(), f.gateway.getDeviceList()])
  await flush()
  const old = f.gateway.sendSocket
  f.gateway.stop()
  assert.deepEqual(
    (await results).map((r) => r.status),
    ['rejected', 'rejected']
  )
  const next = f.gateway.getDeviceList()
  await flush()
  old.emit('error', Error('late old error'))
  f.reply(0)
  await next
  assert.equal(f.gateway.callbacks.size, 0)
})

test('retry deadlines honor timeoutSec and clean up all pending state', async (t) => {
  const f = setup(t, { timeoutSec: 3 })
  let now = 0
  mock.method(performance, 'now', () => now)
  mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => mock.timers.reset())
  const rejected = assert.rejects(f.gateway.getDeviceList(), /timed out/)
  await flush()
  for (const delay of [400, 800, 1200, 600]) {
    now += delay
    mock.timers.tick(delay)
    await flush()
  }
  await rejected
  assert.equal(f.gateway.sendSocket.sent.length, 4)
  assert.equal(f.gateway.callbacks.size, 0)
  now += 100000
  mock.timers.tick(100000)
  await flush()
  assert.equal(f.gateway.sendSocket.sent.length, 4)
})

test('write validation rejects NaN and invalid credentials before opening sockets', async (t) => {
  const f = setup(t)
  await assert.rejects(
    f.gateway.writeDevice('a', DEVICE_TYPE_BLIND, { targetPosition: NaN }),
    RangeError
  )
  await assert.rejects(
    f.gateway.writeDevice('a', DEVICE_TYPE_BLIND, { targetAngle: 181 }),
    RangeError
  )
  await assert.rejects(f.gateway.writeDevice('a', DEVICE_TYPE_BLIND, {}, 'bad'), RangeError)
  await assert.rejects(f.gateway.writeDevice('a', DEVICE_TYPE_BLIND, {}), /missing key/)
  assert.equal(f.sockets.length, 0)
})

test('a gateway write rejection rejects the promise', async (t) => {
  const f = setup(t)
  const result = f.gateway.writeDevice(
    'a',
    DEVICE_TYPE_BLIND,
    { targetPosition: 0 },
    'a'.repeat(32)
  )
  const rejected = assert.rejects(result, /rejected request/)
  await flush()
  f.reply(0, { actionResult: 'AccessToken error' })
  await rejected
})

test('messages from a different gateway cannot change the selected token', async (t) => {
  const f = setup(t, { gatewayIp: address.address })
  const result = f.gateway.getDeviceList()
  await flush()
  f.gateway.sendSocket.emit(
    'message',
    Buffer.from(
      JSON.stringify({ msgType: 'Heartbeat', mac: 'other', token: 'xxxxxxxxxxxxxxxx', data: {} })
    ),
    { ...address, address: '192.0.2.99' }
  )
  assert.equal(f.gateway.token, undefined)
  f.reply()
  await result
  assert.equal(f.gateway.token, '0123456789abcdef')
})

test('malformed datagrams report errors without adopting a token or completing a request', async (t) => {
  const f = setup(t)
  const errors = []
  f.gateway.on('error', (error) => errors.push(error))
  f.gateway.start()
  for (const payload of [
    'null',
    '{}',
    '{',
    JSON.stringify({
      msgType: 'GetDeviceListAck',
      mac: 'x',
      token: '0123456789abcdef',
      data: [null],
    }),
  ]) {
    f.gateway.sendSocket.emit('message', Buffer.from(payload), address)
  }
  assert.equal(errors.length, 4)
  assert.equal(f.gateway.token, undefined)
})

test('message IDs remain unique valid timestamps across a millisecond rollover and clock rollback', () => {
  let now = new Date(2025, 11, 31, 23, 59, 59, 999).getTime()
  mock.method(Date, 'now', () => now)
  try {
    const gateway = new MotionGateway()
    assert.equal(gateway.generateMessageID(), '20251231235959999')
    assert.equal(gateway.generateMessageID(), '20260101000000000')
    now -= 1000
    assert.equal(gateway.generateMessageID(), '20260101000000001')
  } finally {
    mock.restoreAll()
  }
})
