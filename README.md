# node-motionblinds

node.js library for interfacing with Motion Blinds from Coulisee B.V. including
derivative products such as OmniaBlinds.

### Retrieving Your Key

The Motion Blinds API uses a 16 character key that can be retrieved from the
official "Motion Blinds" app for iOS or Android. Open the app, click the 3 dots
in the top right corner, go to "Settings", go to "About MOTION", then quickly
tap the screen five times. A popup will appear showing your key.

### Usage

See [`hiltest/hiltest.ts`](https://github.com/jhurliman/node-motionblinds/blob/main/hiltest/hiltest.ts)
for examples of reading and writing to blinds.

```javascript
import MotionGateway from 'motionblinds'

(async function main () {
  // Initialize the MotionGateway class. Passing in the optional `key` parameter
  // enables write commands
  const gw = new MotionGateway('<YOUR_MOTION_KEY>')
  // Open read and write sockets for UDP multicast communication with Motion
  // blinds. This will automatically be called when any outgoing message needs
  // to be sent, so it only needs to manually be called if you intend to
  // passively listen for broadcast messages
  // gw.start()

  // Listen for "report" events, broadcast by devices when a state transition
  // has completed
  gw.on('report', (report) => {
    console.dir(report)
  })

  // Sends the `getDeviceList()` command followed by a `readDevice()` for each
  // returned device. This calls `start()` as a side effect of communication.
  // The `token` member will also be set as a side effect of the
  // `getDeviceList()` call, enabling write commands after this completes
  const devices = await gw.readAllDevices()
  for (const device of devices) {
    if (device.deviceType === MotionGateway.Blind) {
      // Send a Close/Down command for each discovered device of type Blind
      await gw.writeDevice(device.mac, device.deviceType, {
        operation: MotionGateway.Operation.CloseDown,
      })
    }
  }

  // Disconnect the send and receive UDP sockets
  gw.stop()
}())
```

### Test

Run `yarn test` to verify basic offline functionality of the library. To run the
hardware-in-the-loop tests against real blinds, use
`MOTION_KEY="<YOUR_MOTION_KEY>" yarn test:hil`

### License

node-motionblinds is licensed under [MIT](https://opensource.org/licenses/MIT).
