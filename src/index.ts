/// <reference types="node" preserve="true" />
import * as dgram from 'node:dgram'
import * as crypto from 'node:crypto'
import { EventEmitter } from 'node:events'

export const MULTICAST_IP = '238.0.0.18'
export const UDP_PORT_SEND = 32100
export const UDP_PORT_RECEIVE = 32101
export const PROTOCOL_VERSION = '0.9'

export const DEVICE_TYPE_GATEWAY_LEGACY = '02000001'
export const DEVICE_TYPE_GATEWAY = '02000002' // Gateway
export const DEVICE_TYPE_BLIND = '10000000' // Standard Blind
export const DEVICE_TYPE_TDBU = '10000001' // Top Down Bottom Up
export const DEVICE_TYPE_DR = '10000002' // Double Roller

export const DEVICE_TYPES = {
  [DEVICE_TYPE_GATEWAY]: 'Gateway',
  [DEVICE_TYPE_GATEWAY_LEGACY]: 'Gateway',
  [DEVICE_TYPE_BLIND]: 'Blind',
  [DEVICE_TYPE_TDBU]: 'Top Down Bottom Up',
  [DEVICE_TYPE_DR]: 'Double Roller',
}

export type DeviceType =
  | typeof DEVICE_TYPE_GATEWAY
  | typeof DEVICE_TYPE_GATEWAY_LEGACY
  | typeof DEVICE_TYPE_BLIND
  | typeof DEVICE_TYPE_TDBU
  | typeof DEVICE_TYPE_DR

export enum BlindType {
  RollerBlind = 1,
  VenetianBlind = 2,
  RomanBlind = 3,
  HoneycombBlind = 4,
  ShangriLaBlind = 5,
  RollerShutter = 6,
  RollerGate = 7,
  Awning = 8,
  TopDownBottomUp = 9,
  DayNightBlind = 10,
  DimmingBlind = 11,
  Curtain = 12,
  CurtainLeft = 13,
  CurtainRight = 14,
  DoubleRoller = 17,
  Switch = 43,
}

export enum CurrentState {
  Working = 1,
  Pairing = 2,
  Updating = 3,
}

export enum Operation {
  CloseDown = 0,
  OpenUp = 1,
  Stop = 2,
  StatusQuery = 5,
}

export enum VoltageMode {
  AC = 0,
  DC = 1,
}

export enum LimitsState {
  NoLimits = 0,
  TopLimitDetected = 1,
  BottomLimitDetected = 2,
  LimitsDetected = 3,
  ThirdLimitDetected = 4,
}

export enum WirelessMode {
  UniDirectional = 0,
  BiDirectional = 1,
  BiDirectionalMechanicalLimits = 2,
  Other = 3,
}

export type DeviceStatus = {
  type: BlindType
  operation: Operation
  currentPosition: number
  currentAngle: number
  currentState: LimitsState
  voltageMode: VoltageMode
  batteryLevel: number
  wirelessMode: WirelessMode
  RSSI: number
}

export type GetDeviceListAck = {
  msgType: 'GetDeviceListAck'
  mac: string
  deviceType: DeviceType
  ProtocolVersion: string
  token: string
  data: { mac: string; deviceType: DeviceType }[]
}

export type ReadDeviceAck = {
  msgID?: string
  actionResult?: string
  msgType: 'ReadDeviceAck'
  mac: string
  deviceType: DeviceType
  data: DeviceStatus | MultiMotorStatus
}

export type WriteDeviceData = {
  operation?: Operation
  targetPosition?: number // [0-100]
  targetAngle?: number // [0-180]
  operation_T?: Operation
  operation_B?: Operation
  targetPosition_T?: number // [0-100]
  targetPosition_B?: number // [0-100]
}

export type MultiMotorStatus = {
  type: BlindType
  exist_subid: number
  operation_T: Operation
  operation_B: Operation
  currentPosition_T: number
  currentPosition_B: number
  currentState_T: LimitsState
  currentState_B: LimitsState
  voltageMode: VoltageMode
  batteryLevel_T: number
  batteryLevel_B: number
  wirelessMode: WirelessMode
  RSSI: number
}

export type WriteDeviceAck = {
  msgType: 'WriteDeviceAck'
  mac: string
  deviceType: DeviceType
  msgID?: string
  actionResult?: string
  data: DeviceStatus | MultiMotorStatus
}

export type Heartbeat = {
  msgType: 'Heartbeat'
  mac: string
  deviceType: DeviceType
  token: string
  data: {
    currentState: CurrentState
    numberOfDevices: number
    RSSI: number
  }
}

export type Report = {
  msgType: 'Report'
  mac: string
  deviceType: DeviceType
  data: DeviceStatus | MultiMotorStatus
}

export type BatteryInfo = [number, number] // [voltage, percent]

export type MotionGatewayOpts = {
  key?: string
  token?: string
  gatewayIp?: string
  multicastInterface?: string
  timeoutSec?: number
  listenMulticast?: boolean
}

export type Acknowledgement = GetDeviceListAck | ReadDeviceAck | WriteDeviceAck

export type ReceivedMessage = GetDeviceListAck | ReadDeviceAck | WriteDeviceAck | Heartbeat | Report

const MESSAGE_TYPES = new Set<string>([
  'GetDeviceListAck',
  'ReadDeviceAck',
  'WriteDeviceAck',
  'Heartbeat',
  'Report',
])

const RETRY_MS = [400, 800, 1200, 1600]
const MAX_RETRIES = 4

// Private helpers /////////////////////////////////////////////////////////////

type SendCallback = (err: Error | undefined, res: Acknowledgement | undefined) => void

function GetWaitHandle(msgType: string, msg: ReceivedMessage) {
  switch (msgType) {
    case 'ReadDeviceAck':
    case 'WriteDeviceAck':
      return `${msgType}${msg.mac.toLowerCase()}`
    case 'GetDeviceListAck':
    default:
      return msgType
  }
}

function Clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(min, value), max)
}

////////////////////////////////////////////////////////////////////////////////

export declare interface MotionGateway {
  on(event: 'heartbeat', listener: (heartbeat: Heartbeat, rinfo: dgram.RemoteInfo) => void): this
  on(event: 'report', listener: (report: Report, rinfo: dgram.RemoteInfo) => void): this
  on(event: 'error', listener: (err: Error) => void): this
}

// eslint-disable-next-line no-redeclare
export class MotionGateway extends EventEmitter {
  static Gateway = DEVICE_TYPE_GATEWAY
  static Blind = DEVICE_TYPE_BLIND
  static TDBU = DEVICE_TYPE_TDBU
  static DR = DEVICE_TYPE_DR

  static BlindType = BlindType
  static CurrentState = CurrentState
  static Operation = Operation
  static VoltageMode = VoltageMode
  static LimitsState = LimitsState
  static WirelessMode = WirelessMode

  key?: string
  token?: string
  gatewayIp?: string
  multicastInterface?: string
  seenGatewayIp?: string
  maxTimeoutSec: number
  sendSocket?: dgram.Socket
  recvSocket?: dgram.Socket
  callbacks = new Map<string, SendCallback>()

  private lastMessageTime = 0
  private generation = 0
  private readonly queues = new Map<string, Promise<void>>()
  private readonly listenMulticast: boolean

  constructor({
    key,
    token,
    gatewayIp,
    multicastInterface,
    timeoutSec,
    listenMulticast = true,
  }: MotionGatewayOpts = {}) {
    super()
    this.key = key
    this.token = token
    this.gatewayIp = gatewayIp
    this.multicastInterface = multicastInterface
    this.maxTimeoutSec = timeoutSec ?? 3
    if (
      !Number.isFinite(this.maxTimeoutSec) ||
      this.maxTimeoutSec <= 0 ||
      this.maxTimeoutSec > 2147483
    ) {
      throw new RangeError('timeoutSec must be positive and no greater than 2147483')
    }
    if (key !== undefined && Buffer.byteLength(key) !== 16)
      throw new RangeError('key must be 16 UTF-8 bytes')
    if (token !== undefined && Buffer.byteLength(token) !== 16)
      throw new RangeError('token must be 16 UTF-8 bytes')
    this.listenMulticast = listenMulticast
  }

  start() {
    if (this.sendSocket) return
    const send = (this.sendSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true }))
    send.on('error', (error) => {
      if (this.sendSocket === send) this.socketError(error)
    })
    send.on('message', (payload, rinfo) => {
      if (this.sendSocket === send) this.receive(payload, rinfo)
    })
    send.on('listening', () => {
      if (this.sendSocket !== send) return
      try {
        if (this.multicastInterface) send.setMulticastInterface(this.multicastInterface)
      } catch (error) {
        this.socketError(error as Error)
      }
    })
    send.bind(0, '0.0.0.0')
    if (!this.listenMulticast) return
    const recv = (this.recvSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true }))
    recv.on('error', (error) => {
      if (this.recvSocket === recv) this.socketError(error)
    })
    recv.on('message', (payload, rinfo) => {
      if (this.recvSocket === recv) this.receive(payload, rinfo)
    })
    recv.on('listening', () => {
      if (this.recvSocket !== recv) return
      try {
        if (this.multicastInterface) recv.setMulticastInterface(this.multicastInterface)
        recv.addMembership(MULTICAST_IP, this.multicastInterface)
      } catch (error) {
        this.socketError(error as Error)
      }
    })
    // Bind the local wildcard address, then join the multicast group (#13).
    recv.bind(UDP_PORT_RECEIVE, '0.0.0.0')
  }

  stop() {
    this.terminate(new Error('Gateway stopped'))
  }

  private terminate(error: Error) {
    this.generation++
    for (const callback of [...this.callbacks.values()]) callback(error, undefined)
    this.callbacks.clear()
    this.queues.clear()
    const sockets = [this.sendSocket, this.recvSocket]
    this.sendSocket = undefined
    this.recvSocket = undefined
    for (const socket of sockets) {
      if (!socket) continue
      try {
        socket.close()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error
      }
    }
  }

  private socketError(error: Error) {
    const pending = this.callbacks.size > 0 || this.queues.size > 0
    this.terminate(error)
    if (!pending || this.listenerCount('error')) this.emit('error', error)
  }

  private receive(payload: Buffer, rinfo: dgram.RemoteInfo) {
    const expected = this.gatewayIp ?? this.seenGatewayIp
    if (expected && expected !== rinfo.address) return
    const value = parseJsonBuffer(payload)
    if (!value || !MESSAGE_TYPES.has(String(value.msgType)) || typeof value.mac !== 'string') {
      this.emit('error', new Error('Invalid Motion Blinds datagram'))
      return
    }
    if (value.msgID !== undefined && typeof value.msgID !== 'string') {
      this.emit('error', new Error('Invalid acknowledgement message ID'))
      return
    }
    if (
      value.msgType === 'GetDeviceListAck' &&
      (!Array.isArray(value.data) ||
        value.data.some(
          (device) =>
            !device || typeof device.mac !== 'string' || typeof device.deviceType !== 'string'
        ))
    ) {
      this.emit('error', new Error('Invalid device list'))
      return
    }
    if (
      (value.msgType === 'Heartbeat' || value.msgType === 'GetDeviceListAck') &&
      (typeof value.token !== 'string' || Buffer.byteLength(value.token) !== 16)
    ) {
      this.emit('error', new Error('Invalid gateway token'))
      return
    }
    if (
      value.msgType !== 'GetDeviceListAck' &&
      !value.actionResult &&
      (!value.data || typeof value.data !== 'object' || Array.isArray(value.data))
    ) {
      this.emit('error', new Error('Invalid device status'))
      return
    }
    this.seenGatewayIp = rinfo.address
    const message = value as ReceivedMessage
    if (message.msgType === 'Heartbeat' || message.msgType === 'GetDeviceListAck')
      this.token = message.token
    if (message.msgType === 'Heartbeat') this.emit('heartbeat', message, rinfo)
    else if (message.msgType === 'Report') this.emit('report', message, rinfo)
    else this.callbacks.get(GetWaitHandle(message.msgType, message))?.(undefined, message)
  }

  async readDevice(mac: string, deviceType: DeviceType): Promise<ReadDeviceAck> {
    if (typeof mac !== 'string' || !mac || typeof deviceType !== 'string' || !deviceType)
      throw new TypeError('mac and deviceType must be non-empty strings')
    return this._sendReceive(
      { msgType: 'ReadDevice', mac, deviceType },
      `ReadDeviceAck${mac.toLowerCase()}`
    ) as Promise<ReadDeviceAck>
  }

  async readAllDevices() {
    const devices = await this.getDeviceList()
    return Promise.all(
      devices.data
        .filter(
          (d) => d.deviceType !== DEVICE_TYPE_GATEWAY && d.deviceType !== DEVICE_TYPE_GATEWAY_LEGACY
        )
        .map((d) => this.readDevice(d.mac, d.deviceType))
    )
  }

  async writeDevice(
    mac: string,
    deviceType: DeviceType,
    data: WriteDeviceData,
    accessToken?: string
  ): Promise<WriteDeviceAck> {
    if (typeof mac !== 'string' || !mac || typeof deviceType !== 'string' || !deviceType)
      throw new TypeError('mac and deviceType must be non-empty strings')
    if (!data || typeof data !== 'object') throw new TypeError('data must be an object')
    if (accessToken !== undefined && !/^[0-9a-f]{32}$/i.test(accessToken))
      throw new RangeError('accessToken must be 32 hexadecimal characters')
    for (const [field, maximum] of [
      ['targetPosition', 100],
      ['targetAngle', 180],
      ['targetPosition_T', 100],
      ['targetPosition_B', 100],
    ] as const) {
      const value = data[field]
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > maximum)) {
        return Promise.reject(new RangeError(`invalid ${field}`))
      }
    }

    // Ensure we have (or can create) an AccessToken
    if (!accessToken) {
      if (!this.key) return Promise.reject(new Error(`missing key or accessToken`))
      if (!this.token)
        return Promise.reject(new Error(`missing token or accessToken (call getDeviceList)`))
      accessToken = MotionGateway.AccessToken(this.key, this.token)
    }

    const writeDevice = {
      msgType: 'WriteDevice',
      mac,
      deviceType,
      data,
      AccessToken: accessToken,
    }
    return this._sendReceive(
      writeDevice,
      `WriteDeviceAck${mac.toLowerCase()}`
    ) as Promise<WriteDeviceAck>
  }

  getDeviceList(): Promise<GetDeviceListAck> {
    const req = { msgType: 'GetDeviceList' }
    return this._sendReceive(req, 'GetDeviceListAck') as Promise<GetDeviceListAck>
  }

  generateMessageID(): string {
    this.lastMessageTime = Math.max(Date.now(), this.lastMessageTime + 1)
    const date = new Date(this.lastMessageTime)
    const part = (value: number, width = 2) => String(value).padStart(width, '0')
    return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}${part(date.getMilliseconds(), 3)}`
  }

  static AccessToken(key: string, token: string) {
    if (Buffer.byteLength(key) !== 16 || Buffer.byteLength(token) !== 16)
      throw new RangeError('key and token must each be 16 UTF-8 bytes')
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null)
    cipher.setAutoPadding(false)
    return (
      cipher.update(token).toString('hex').toUpperCase() +
      cipher.final().toString('hex').toUpperCase()
    )
  }

  /// @returns [voltage, percent]
  static BatteryInfo(batteryLevel: number): BatteryInfo {
    if (!Number.isFinite(batteryLevel) || batteryLevel < 0)
      throw new RangeError('batteryLevel must be non-negative and finite')
    const voltage = batteryLevel / 100.0
    let percent = 0.0

    if (voltage > 0.0 && voltage <= 9.4) {
      // 2 cel battery pack (8.4V)
      percent = (voltage - 6.2) / (8.4 - 6.2)
    } else if (voltage > 9.4 && voltage <= 13.6) {
      // 3 cel battery pack (12.6V)
      percent = (voltage - 10.4) / (12.6 - 10.4)
    } else if (voltage > 13.6) {
      // 4 cel battery pack (16.8V)
      percent = (voltage - 14.6) / (16.8 - 14.6)
    }
    return [voltage, Clamp(percent, 0.0, 1.0)]
  }

  private async _sendReceive(
    message: Record<string, unknown>,
    waitHandle: string
  ): Promise<Acknowledgement> {
    if (!this.sendSocket) this.start()
    const generation = this.generation
    const previous = this.queues.get(waitHandle) ?? Promise.resolve()
    const result = previous.then(() => {
      if (generation !== this.generation || !this.sendSocket) throw new Error('Gateway stopped')
      return this.performRequest(message, waitHandle)
    })
    const tail = result.then(
      () => {},
      () => {}
    )
    this.queues.set(waitHandle, tail)
    void tail.then(() => {
      if (this.queues.get(waitHandle) === tail) this.queues.delete(waitHandle)
    })
    return result
  }

  private performRequest(
    message: Record<string, unknown>,
    waitHandle: string
  ): Promise<Acknowledgement> {
    return new Promise((resolve, reject) => {
      const socket = this.sendSocket!
      const deadline = performance.now() + this.maxTimeoutSec * 1000
      const ids = new Set<string>()
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      let attempt = 0
      const finish: SendCallback = (error, response) => {
        if (settled) return
        if (response && 'msgID' in response && response.msgID && !ids.has(response.msgID)) return
        settled = true
        clearTimeout(timer)
        this.callbacks.delete(waitHandle)
        if (error) reject(error)
        else if (
          response &&
          (response.msgType === 'WriteDeviceAck' || response.msgType === 'ReadDeviceAck') &&
          response.actionResult
        )
          reject(new Error('Gateway rejected request'))
        else if (response) resolve(response)
        else reject(new Error('Missing acknowledgement'))
      }
      this.callbacks.set(waitHandle, finish)
      const send = () => {
        if (settled) return
        const remaining = deadline - performance.now()
        if (remaining <= 0) return finish(new Error('Gateway request timed out'), undefined)
        const msgID = this.generateMessageID()
        ids.add(msgID)
        try {
          const payload = JSON.stringify({ ...message, msgID })
          socket.send(
            payload,
            UDP_PORT_SEND,
            this.gatewayIp ?? this.seenGatewayIp ?? MULTICAST_IP,
            (error) => {
              if (error) finish(error, undefined)
            }
          )
        } catch (error) {
          finish(error as Error, undefined)
        }
        if (settled) return
        const delay = Math.min(remaining, RETRY_MS[attempt] ?? RETRY_MS[RETRY_MS.length - 1])
        timer = setTimeout(
          () => {
            if (attempt++ < MAX_RETRIES && performance.now() < deadline) send()
            else finish(new Error('Gateway request timed out'), undefined)
          },
          Math.max(1, delay)
        )
      }
      send()
    })
  }
}

function parseJsonBuffer(buffer: Buffer): Record<string, unknown> | undefined {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch (err) {
    return undefined
  }
}
