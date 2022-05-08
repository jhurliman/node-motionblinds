import * as dgram from 'dgram'
import * as crypto from 'crypto'
import { EventEmitter } from 'events'

export const MULTICAST_IP = '238.0.0.18'
export const UDP_PORT_SEND = 32100
export const UDP_PORT_RECEIVE = 32101
export const PROTOCOL_VERSION = '0.9'

export const DEVICE_TYPE_GATEWAY = '02000002' // Gateway
export const DEVICE_TYPE_BLIND = '10000000' // Standard Blind
export const DEVICE_TYPE_TDBU = '10000001' // Top Down Bottom Up
export const DEVICE_TYPE_DR = '10000002' // Double Roller

export const DEVICE_TYPES = {
  [DEVICE_TYPE_GATEWAY]: 'Gateway',
  [DEVICE_TYPE_BLIND]: 'Blind',
  [DEVICE_TYPE_TDBU]: 'Top Down Bottom Up',
  [DEVICE_TYPE_DR]: 'Double Roller',
}

export type DeviceType =
  | typeof DEVICE_TYPE_GATEWAY
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
  data: [{ mac: string; deviceType: DeviceType }]
}

export type ReadDeviceAck = {
  msgType: 'ReadDeviceAck'
  mac: string
  deviceType: DeviceType
  data: DeviceStatus
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

export type WriteDeviceAck = {
  msgType: 'WriteDeviceAck'
  mac: string
  deviceType: DeviceType
  msgID?: string
  actionResult?: string
  data: {
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
  data: DeviceStatus
}

export type BatteryInfo = [number, number] // [voltage, percent]

export type MotionGatewayOpts = {
  key?: string
  token?: string
  gatewayIp?: string
  timeoutSec?: number
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
      return `${msgType}${msg.mac}`
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
  seenGatewayIp?: string
  maxTimeoutSec: number
  sendSocket?: dgram.Socket
  recvSocket?: dgram.Socket
  callbacks = new Map<string, SendCallback>()

  private lastMessageId: bigint | undefined

  constructor({ key, token, gatewayIp, timeoutSec }: MotionGatewayOpts = {}) {
    super()
    this.key = key
    this.token = token
    this.gatewayIp = gatewayIp
    this.maxTimeoutSec = timeoutSec ?? 3
  }

  start() {
    this.sendSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

    this.sendSocket.on('error', err => {
      if (this.callbacks.size) {
        this.callbacks.forEach((callback, _) => callback(err, undefined))
      } else {
        this.emit('error', err)
      }
    })

    this.sendSocket.on('message', (payload, rinfo) => {
      const msg = parseJsonBuffer(payload) as Partial<ReceivedMessage> | undefined
      if (!msg || typeof msg.msgType !== 'string') {
        this.emit('error', new Error(`Failed to JSON parse ${payload.byteLength} byte message`))
        return
      }
      if (!MESSAGE_TYPES.has(msg.msgType)) {
        this.emit('error', new Error(`Unknown message type ${msg.msgType}`))
        return
      }

      this.seenGatewayIp = rinfo.address

      if (msg.msgType === 'GetDeviceListAck' && typeof msg.token === 'string') {
        this.token = msg.token
      }
      const ack = msg as Acknowledgement
      const waitHandle = GetWaitHandle(msg.msgType, ack)
      this.callbacks.get(waitHandle)?.(undefined, ack)
    })

    const recvSocket = (this.recvSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true }))

    recvSocket.on('listening', () => {
      try {
        recvSocket.setBroadcast(true)
        recvSocket.setMulticastTTL(128)
        recvSocket.addMembership(MULTICAST_IP)
      } catch (err) {
        this.emit('error', err)
        this.stop()
      }
    })

    recvSocket.on('error', err => {
      this.emit('error', err)
    })

    recvSocket.on('message', (payload, rinfo) => {
      const msg = parseJsonBuffer(payload) as Partial<ReceivedMessage> | undefined
      if (!msg || typeof msg.msgType !== 'string') {
        this.emit('error', new Error(`Failed to JSON parse ${payload.byteLength} byte message`))
        return
      }
      if (!MESSAGE_TYPES.has(msg.msgType)) {
        this.emit('error', new Error(`Unknown message type "${msg.msgType}"`))
        return
      }

      this.seenGatewayIp = rinfo.address

      if (msg.msgType === 'Heartbeat') {
        this.token = msg.token
        this.emit('heartbeat', msg as Heartbeat, rinfo)
      } else if (msg.msgType === 'Report') {
        this.emit('report', msg as Report, rinfo)
      } else if (msg.msgType === 'GetDeviceListAck') {
        this.token = msg.token
      }
    })

    recvSocket.bind(UDP_PORT_RECEIVE, MULTICAST_IP)
  }

  stop() {
    if (this.recvSocket) {
      this.recvSocket.close()
      this.recvSocket = undefined
    }
    if (this.sendSocket) {
      this.sendSocket.close()
      this.sendSocket = undefined
    }
  }

  readDevice(mac: string, deviceType: DeviceType): Promise<ReadDeviceAck> {
    return this._sendReceive(
      { msgType: 'ReadDevice', mac, deviceType },
      `ReadDeviceAck${mac}`
    ) as Promise<ReadDeviceAck>
  }

  async readAllDevices() {
    const devices = await this.getDeviceList()
    return Promise.all(
      devices.data
        .filter(d => d.deviceType !== DEVICE_TYPE_GATEWAY)
        .map(d => this.readDevice(d.mac, d.deviceType))
    )
  }

  writeDevice(
    mac: string,
    deviceType: DeviceType,
    data: WriteDeviceData,
    accessToken?: string
  ): Promise<WriteDeviceAck> {
    // Sanity check input data
    if (data.targetPosition && (data.targetPosition < 0 || data.targetPosition > 100))
      return Promise.reject(`invalid targetPosition ${data.targetPosition}`)
    if (data.targetAngle && (data.targetAngle < 0 || data.targetAngle > 180))
      return Promise.reject(`invalid targetAngle ${data.targetAngle}`)
    if (data.targetPosition_T && (data.targetPosition_T < 0 || data.targetPosition_T > 100))
      return Promise.reject(`invalid targetPosition_T ${data.targetPosition_T}`)
    if (data.targetPosition_B && (data.targetPosition_B < 0 || data.targetPosition_B > 100))
      return Promise.reject(`invalid targetPosition_B ${data.targetPosition_B}`)

    // Ensure we have (or can create) an AccessToken
    if (!accessToken) {
      if (!this.key) return Promise.reject(`missing key or accessToken`)
      if (!this.token) return Promise.reject(`missing token or accessToken (call getDeviceList)`)
      accessToken = MotionGateway.AccessToken(this.key, this.token)
    }

    const writeDevice = {
      msgType: 'WriteDevice',
      mac,
      deviceType,
      data,
      AccessToken: accessToken,
    }
    return this._sendReceive(writeDevice, `WriteDeviceAck${mac}`) as Promise<WriteDeviceAck>
  }

  getDeviceList(): Promise<GetDeviceListAck> {
    const req = { msgType: 'GetDeviceList' }
    return this._sendReceive(req, 'GetDeviceListAck') as Promise<GetDeviceListAck>
  }

  generateMessageID(): string {
    // ex: 20200321134209916
    const date = new Date()
    const yyyy = date.getFullYear()
    const MM = (date.getMonth() + 1).toString().padStart(2, '0')
    const dd = date
      .getDate()
      .toString()
      .padStart(2, '0')
    const hh = date
      .getHours()
      .toString()
      .padStart(2, '0')
    const mm = date
      .getMinutes()
      .toString()
      .padStart(2, '0')
    const ss = date
      .getSeconds()
      .toString()
      .padStart(2, '0')
    const sss = date
      .getMilliseconds()
      .toString()
      .padStart(3, '0')
    let messageIdStr = `${yyyy}${MM}${dd}${hh}${mm}${ss}${sss}`

    // Ensure this messageId is greater than the last sent one
    let messageId = BigInt(messageIdStr)
    if (this.lastMessageId != undefined) {
      if (messageId <= this.lastMessageId) {
        messageId = this.lastMessageId + BigInt(1)
        messageIdStr = messageId.toString()
      }
    }
    this.lastMessageId = messageId

    return messageIdStr
  }

  static AccessToken(key: string, token: string) {
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null)
    cipher.setAutoPadding(false)
    return (
      cipher
        .update(token)
        .toString('hex')
        .toUpperCase() +
      cipher
        .final()
        .toString('hex')
        .toUpperCase()
    )
  }

  /// @returns [voltage, percent]
  static BatteryInfo(batteryLevel: number): BatteryInfo {
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

  private _sendReceive(
    message: Record<string, unknown>,
    waitHandle: string,
    retry = 0
  ): Promise<Acknowledgement | undefined> {
    if (!this.sendSocket) this.start()

    message.msgID = this.generateMessageID()
    const payload = JSON.stringify(message)

    return new Promise<Acknowledgement | undefined>((resolve, reject) => {
      const sendSocket = this.sendSocket
      if (!sendSocket) return reject(new Error(`not connected`))

      const timeoutMs =
        RETRY_MS[retry] ?? RETRY_MS[RETRY_MS.length - 1] + Math.trunc(Math.random() * 100)

      const timer = setTimeout(() => {
        if (retry < MAX_RETRIES) {
          console.log(`retrying: ${payload}`)
          this._sendReceive(message, waitHandle, retry + 1).then(resolve, reject)
        } else {
          this.callbacks.delete(waitHandle)
          reject(new Error(`timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      const prevCallback = this.callbacks.get(waitHandle)
      if (prevCallback) prevCallback(new Error(`replaced`), undefined)

      this.callbacks.set(waitHandle, (err, response) => {
        clearTimeout(timer)
        this.callbacks.delete(waitHandle)
        if (err) return reject(err)
        resolve(response)
      })

      const destIp = this.gatewayIp ?? this.seenGatewayIp ?? MULTICAST_IP
      sendSocket.send(payload, UDP_PORT_SEND, destIp, (err, _) => {
        if (err) {
          clearTimeout(timer)
          this.callbacks.delete(waitHandle)
          reject(err)
        }
      })
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
