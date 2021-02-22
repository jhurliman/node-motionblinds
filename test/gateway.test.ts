import { MotionGateway } from '../src'

describe('MotionGateway', () => {
  it('Creates AccessTokens', () => {
    const accessToken = MotionGateway.AccessToken('74ae544c-d16e-4c', '37412C478E0FBEAB')
    expect(accessToken).toEqual('8570A96BC18ADB21D1FC155B24ECFD73')
  })

  it('Calculates battery info', () => {
    expect(MotionGateway.BatteryInfo(844)[0]).toEqual(844 / 100)
    expect(MotionGateway.BatteryInfo(844)[1]).toEqual(1)
    expect(MotionGateway.BatteryInfo(1232)[0]).toEqual(1232 / 100)
    expect(MotionGateway.BatteryInfo(1232)[1]).toEqual(0.872727272727273)
  })
})
