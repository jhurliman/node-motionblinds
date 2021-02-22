import { env } from 'process'

import { MotionGateway } from '../src'

describe('MotionGateway', () => {
  it('Fetches the device list', async () => {
    const gw = new MotionGateway()
    const res = await gw.getDeviceList()
    expect(res.ProtocolVersion).toEqual('0.9')
    expect(res.deviceType).toEqual('02000002')
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

  it('Closes blinds', async () => {
    const key = env.MOTION_KEY
    if (!key) {
      fail(`MOTION_KEY environment variable must be set`)
      return
    }

    const gw = new MotionGateway(key)
    const devices = await gw.readAllDevices()
    const blinds = devices.reverse().find(d => d.deviceType === MotionGateway.Blind)
    expect(blinds).not.toBeUndefined()
    if (!blinds) return

    const res = await gw.writeDevice(blinds.mac, blinds.deviceType, {
      operation: MotionGateway.Operation.CloseDown,
    })
    expect(res.actionResult).toBeUndefined()
    expect(res.mac).toEqual(blinds.mac)
    gw.stop()
  })
})
