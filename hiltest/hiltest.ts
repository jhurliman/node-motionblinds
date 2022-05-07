import { env } from 'process'

import { DEVICE_TYPE_GATEWAY, MotionGateway, PROTOCOL_VERSION } from '../src'

jest.setTimeout(30 * 1000);

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

    // Wait three seconds
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Stop all blinds
    for (const blinds of allBlinds) {
      const res = await gw.writeDevice(blinds.mac, blinds.deviceType, {
        operation: MotionGateway.Operation.Stop,
      })
      expect(res.actionResult).toBeUndefined()
      expect(res.mac).toEqual(blinds.mac)
    }

    // Wait three seconds
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Open all blinds
    for (const blinds of allBlinds) {
      const res = await gw.writeDevice(blinds.mac, blinds.deviceType, {
        operation: MotionGateway.Operation.OpenUp,
      })
      expect(res.actionResult).toBeUndefined()
      expect(res.mac).toEqual(blinds.mac)
    }

    gw.stop()
  })
})
