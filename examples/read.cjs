'use strict';
const { MotionGateway } = require('../dist');
async function main() {
  if (!process.env.MOTION_GATEWAY_IP) throw new Error('Set MOTION_GATEWAY_IP to the gateway to inspect');
  const gateway = new MotionGateway({ gatewayIp: process.env.MOTION_GATEWAY_IP });
  gateway.on('error', error => console.error(error.message));
  try {
    const list = await gateway.getDeviceList();
    console.log('Devices:', list.data);
    console.log('Status:', await gateway.readAllDevices());
  } finally { gateway.stop(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
