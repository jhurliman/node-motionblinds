'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('node:dgram')
const { once } = require('node:events')
const { MotionGateway, UDP_PORT_SEND, DEVICE_TYPE_BLIND } = require('../dist')

test(
  'real UDP loopback carries a full 28-device response without hardware',
  { timeout: 5000 },
  async () => {
    const server = dgram.createSocket('udp4')
    const gateway = new MotionGateway({ gatewayIp: '127.0.0.1', listenMulticast: false })
    const devices = Array.from({ length: 28 }, (_, i) => ({
      mac: String(i),
      deviceType: DEVICE_TYPE_BLIND,
    }))
    server.on('message', (payload, remote) => {
      const request = JSON.parse(payload)
      if (request.msgType !== 'GetDeviceList') return
      server.send(
        JSON.stringify({
          msgType: 'GetDeviceListAck',
          mac: 'gateway',
          deviceType: '02000002',
          ProtocolVersion: '0.9',
          token: '0123456789abcdef',
          data: devices,
        }),
        remote.port,
        remote.address
      )
    })
    try {
      server.bind(UDP_PORT_SEND, '127.0.0.1')
      await once(server, 'listening')
      assert.deepEqual((await gateway.getDeviceList()).data, devices)
    } finally {
      gateway.stop()
      server.close()
    }
  }
)
