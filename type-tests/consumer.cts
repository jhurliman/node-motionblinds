import { MotionGateway, DEVICE_TYPE_BLIND } from '../dist/index.js'
const gateway = new MotionGateway()
const token: string = MotionGateway.AccessToken('0123456789abcdef', 'fedcba9876543210')
async function check() {
  const device = await gateway.readDevice('device', DEVICE_TYPE_BLIND)
  gateway.stop()
}
