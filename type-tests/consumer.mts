import MotionGateway, { MotionGateway as NamedGateway, DEVICE_TYPE_BLIND } from '../dist/index.mjs'
const gateway: NamedGateway = new MotionGateway({ gatewayIp: '127.0.0.1', listenMulticast: false })
async function check() {
  const devices = await gateway.getDeviceList()
  const count: number = devices.data.length
  await gateway.writeDevice('device', DEVICE_TYPE_BLIND, { targetPosition: 0 }, 'a'.repeat(32))
  gateway.stop()
}
