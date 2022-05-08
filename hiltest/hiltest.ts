import { env } from 'process'

import {
  BlindType,
  DEVICE_TYPES,
  DEVICE_TYPE_GATEWAY,
  LimitsState,
  MotionGateway,
  Operation,
  PROTOCOL_VERSION,
  VoltageMode,
  WirelessMode,
} from '../src'

jest.setTimeout(30 * 1000)

describe('MotionGateway', () => {
  it('Fetches the device list', async () => {
    const gw = new MotionGateway()
    const res = await gw.getDeviceList()
    expect(res.ProtocolVersion).toEqual(PROTOCOL_VERSION)
    expect(res.deviceType).toEqual(DEVICE_TYPE_GATEWAY)
    expect(res.mac).toHaveLength(12)
    expect(res.msgType).toEqual('GetDeviceListAck')
    expect(res.token).toHaveLength(16)
    for (const device of res.data) {
      expect(device.deviceType).toBeTruthy()
      expect(device.mac).toBeTruthy()
    }
    gw.stop()
  })

  it('Reads devices', async () => {
    const gw = new MotionGateway()
    const devices = await gw.readAllDevices()
    expect(devices).not.toHaveLength(0)
    gw.stop()
  })

  it('Opens and closes blinds', async () => {
    const key = env.MOTION_KEY
    if (!key) {
      fail(`MOTION_KEY environment variable must be set`)
      return
    }

    const gw = new MotionGateway({ key })
    gw.on('error', fail)
    gw.start()
    const devices = await gw.readAllDevices()
    const allBlinds = devices.filter(d => d.deviceType === MotionGateway.Blind)
    expect(allBlinds).not.toHaveLength(0)

    // Close all blinds
    for (const blinds of allBlinds) {
      const res = await gw.writeDevice(blinds.mac, blinds.deviceType, {
        operation: MotionGateway.Operation.CloseDown,
      })
      expect(res.actionResult).toBeUndefined()
      expect(res.mac).toEqual(blinds.mac)
    }

    // Wait for blinds to start closing, if they are not already closed
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Stop all blinds
    for (const blinds of allBlinds) {
      const res = await gw.writeDevice(blinds.mac, blinds.deviceType, {
        operation: MotionGateway.Operation.Stop,
      })
      expect(res.actionResult).toBeUndefined()
      expect(res.mac).toEqual(blinds.mac)
    }

    // Open all blinds
    for (const blinds of allBlinds) {
      const res = await gw.writeDevice(blinds.mac, blinds.deviceType, {
        operation: MotionGateway.Operation.OpenUp,
      })
      expect(res.actionResult).toBeUndefined()
      expect(res.mac).toEqual(blinds.mac)
    }

    // Wait for blinds to start opening
    await new Promise(resolve => setTimeout(resolve, 1000))

    let logMessage = `gatewayIp=${gw.seenGatewayIp}`

    const allDevices = await gw.readAllDevices()
    for (const dev of allDevices) {
      const [batteryVoltage, batteryPercent] = MotionGateway.BatteryInfo(dev.data.batteryLevel)
      logMessage += `\n[${dev.mac} ${DEVICE_TYPES[dev.deviceType]}] type=${
        BlindType[dev.data.type]
      } operation=${Operation[dev.data.operation]} currentPosition=${
        dev.data.currentPosition
      } currentAngle=${dev.data.currentAngle} currentState=${
        LimitsState[dev.data.currentState]
      } voltageMode=${VoltageMode[dev.data.voltageMode]} batteryLevel=${
        dev.data.batteryLevel
      } batteryVoltage=${batteryVoltage} batteryPercent=${batteryPercent} wirelessMode=${
        WirelessMode[dev.data.wirelessMode]
      } RSSI=${dev.data.RSSI}`
    }

    gw.stop()
    console.log(logMessage)
  })
})
