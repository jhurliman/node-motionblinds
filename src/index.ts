import * as dgram from 'dgram'
import * as crypto from 'crypto'
import { EventEmitter } from 'events'

const MULTICAST_IP = '238.0.0.18'
const UDP_PORT_SEND = 32100
const UDP_PORT_RECEIVE = 32101

const DEVICE_TYPE_GATEWAY = '02000002' // Gateway
const DEVICE_TYPE_BLIND = '10000000' // Standard Blind
const DEVICE_TYPE_TDBU = '10000001' // Top Down Bottom Up
const DEVICE_TYPE_DR = '10000002' // Double Roller

type DeviceType =
  | typeof DEVICE_TYPE_GATEWAY
  | typeof DEVICE_TYPE_BLIND
  | typeof DEVICE_TYPE_TDBU
  | typeof DEVICE_TYPE_DR

enum BlindType {
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

enum CurrentState {
  Working = 1,
  Pairing = 2,
  Updating = 3,
}

enum Operation {
  CloseDown = 0,
  OpenUp = 1,
  Stop = 2,
  StatusQuery = 5,
}

enum VoltageMode {
  AC = 0,
  DC = 1,
}

enum LimitsState {
  NoLimits = 0,
  TopLimitDetected = 1,
  BottomLimitDetected = 2,
  LimitsDetected = 3,
  ThirdLimitDetected = 4,
}

enum WirelessMode {
  UniDirectional = 0,
  BiDirectional = 1,
  BiDirectionalMechanicalLimits = 2,
  Other = 3,
}

type DeviceStatus = {
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

type GetDeviceListAck = {
  msgType: 'GetDeviceListAck'
  mac: string
  deviceType: DeviceType
  ProtocolVersion: string
  token: string
  data: [{ mac: string; deviceType: DeviceType }]
}

type ReadDeviceAck = {
  msgType: 'ReadDeviceAck'
  mac: string
  deviceType: DeviceType
  data: DeviceStatus
}

type WriteDeviceData = {
  operation?: Operation
  targetPosition?: number // [0-100]
  targetAngle?: number // [0-180]
  operation_T?: Operation
  operation_B?: Operation
  targetPosition_T?: number // [0-100]
  targetPosition_B?: number // [0-100]
}

type WriteDeviceAck = {
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

type Heartbeat = {
  msgType: 'Heartbeat'
  mac: string
  deviceType: DeviceType
  data: {
    currentState: CurrentState
    numberOfDevices: number
    RSSI: number
  }
}

type Report = {
  msgType: 'Report'
  mac: string
  deviceType: DeviceType
  data: DeviceStatus
}

type SendCallback = (err: Error | undefined, res: any) => void

type BatteryInfo = [number, number] // [voltage, percent]

function GetWaitHandle(msgType: string, msg: any) {
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

export declare interface MotionGateway {
  on(event: 'heartbeat', listener: (heartbeat: Heartbeat) => void): this
  on(event: 'report', listener: (report: Report) => void): this
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
  timeout: number
  sendSocket?: dgram.Socket
  recvSocket?: dgram.Socket
  msgID = 0
  callbacks = new Map<string, SendCallback>()

  constructor(key?: string, timeout: number = 3.0) {
    super()
    this.key = key
    this.timeout = timeout
  }

  start() {
    this.sendSocket = dgram.createSocket('udp4')

    this.sendSocket.on('error', err => {
      if (this.callbacks.size) {
        this.callbacks.forEach((callback, _) => callback(err, undefined))
      } else {
        this.emit('error', err)
      }
    })

    this.sendSocket.on('message', (payload, _) => {
      const msg = JSON.parse(payload.toString('utf8'))
      if (msg.msgType === 'GetDeviceListAck') {
        this.token = (msg as GetDeviceListAck).token
      }
      const waitHandle = GetWaitHandle(msg.msgType, msg)
      const callback = this.callbacks.get(waitHandle)
      if (callback) callback(undefined, msg)
    })

    const recvSocket = (this.recvSocket = dgram.createSocket('udp4'))

    recvSocket.on('listening', () => {
      recvSocket.setBroadcast(true)
      recvSocket.setMulticastTTL(128)
      recvSocket.addMembership(MULTICAST_IP)
    })

    recvSocket.on('error', err => {
      this.emit('error', err)
    })

    recvSocket.on('message', (payload, _) => {
      const msg = JSON.parse(payload.toString('utf8'))
      if (msg.msgType === 'Heartbeat') {
        this.emit('heartbeat', msg as Heartbeat)
      } else if (msg.msgType === 'Report') {
        this.emit('report', msg as Report)
      } else if (msg.msgType === 'GetDeviceListAck') {
        this.token = (msg as GetDeviceListAck).token
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
    return this._sendReceive({ msgType: 'ReadDevice', mac, deviceType }, `ReadDeviceAck${mac}`)
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

    return this._sendReceive(
      {
        msgType: 'WriteDevice',
        mac,
        deviceType,
        data,
        AccessToken: accessToken,
      },
      `WriteDeviceAck${mac}`
    )
  }

  getDeviceList(): Promise<GetDeviceListAck> {
    return this._sendReceive({ msgType: 'GetDeviceList' }, 'GetDeviceListAck')
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

  private _sendReceive(message: any, waitHandle: string) {
    if (!this.sendSocket) this.start()

    const msgID = ++this.msgID
    message.msgID = msgID
    const payload = JSON.stringify(message)

    return new Promise<any>((resolve, reject) => {
      const sendSocket = this.sendSocket
      if (!sendSocket) return reject(new Error(`not connected`))

      const timer = setTimeout(() => {
        this.callbacks.delete(waitHandle)
        reject(new Error(`timed out after ${this.timeout} seconds`))
      }, this.timeout * 1000)

      const prevCallback = this.callbacks.get(waitHandle)
      if (prevCallback) prevCallback(new Error(`replaced`), undefined)

      this.callbacks.set(waitHandle, (err, response) => {
        clearTimeout(timer)
        this.callbacks.delete(waitHandle)
        if (err) return reject(err)
        resolve(response)
      })

      sendSocket.send(payload, UDP_PORT_SEND, MULTICAST_IP, (err, _) => {
        if (err) {
          clearTimeout(timer)
          this.callbacks.delete(waitHandle)
          reject(err)
        }
      })
    })
  }
}
