# motionblinds

[![CI](https://github.com/jhurliman/node-motionblinds/actions/workflows/ci.yml/badge.svg)](https://github.com/jhurliman/node-motionblinds/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/motionblinds.svg)](https://www.npmjs.com/package/motionblinds)

Discover, inspect, and control **MOTION Blinds gateways over local UDP**. The
library implements the Coulisse gateway protocol used by MOTION and derivative
products such as OmniaBlinds: device discovery, status reads, position commands,
and unsolicited heartbeat/report events.

Version 3 provides CommonJS and ES modules, generated TypeScript declarations,
and no runtime dependencies. Requests to the same device are serialized, replies
with message IDs are correlated, and stopping a gateway rejects pending work and
clears its timers. No cloud login is involved in this local protocol.

## Install

```sh
npm install motionblinds
```

Requires Node.js 22+ and a compatible gateway reachable on your local network.
The implementation follows the bundled [vendor protocol manual](docs/1612301946445-coulisse-manual_developer_api_cm-20_cmd-01_045.pdf).
Hardware and firmware support must be checked on the devices you use.

## Read the device list

Save as `example.cjs` and run `node example.cjs`. This example does not move blinds:

```js
const { MotionGateway } = require('motionblinds');

async function main() {
  const gateway = new MotionGateway({ gatewayIp: process.env.MOTION_GATEWAY_IP });
  gateway.on('error', error => console.error(error.message));
  try {
    const response = await gateway.getDeviceList();
    console.log(response.data);
  } finally {
    gateway.stop();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
```

Set `MOTION_GATEWAY_IP` to select a particular gateway. Without it, discovery is
multicast and the first accepted gateway address is retained for that instance.
Use one instance per gateway when you have several.

For ES modules, save your file with an `.mjs` extension (or set `"type": "module"`
in your project) and use:

```js
import { MotionGateway } from 'motionblinds';
```

A default ESM import is also available in version 3. CommonJS uses the named
`MotionGateway` property. This distinction avoids the import/setup problem
reported in [#10](https://github.com/jhurliman/node-motionblinds/issues/10).

## Status and events

| Method/event | Purpose |
| --- | --- |
| `getDeviceList()` | Get the gateway's complete returned device array and refresh its token |
| `readDevice(mac, deviceType)` | Read one device's current status |
| `readAllDevices()` | Discover, then read every returned device except known gateway types |
| `writeDevice(mac, deviceType, data, accessToken?)` | Send a control command; requires a key/token or explicit access token |
| `start()` | Open sockets for passive event listening; requests call it automatically |
| `stop()` | Close sockets, clear timers, and reject pending requests; safe to repeat |
| `heartbeat` | Gateway heartbeat and its UDP source information |
| `report` | Device status report and its UDP source information |
| `error` | Socket or malformed-datagram error |

`readAllDevices()` returns an array of acknowledgments. Single-motor and
multi-motor devices have different status shapes; TypeScript represents them as
a union. Narrow by the fields you need before reading a position or battery
value. `MotionGateway.BatteryInfo(level)` returns `[voltage, fraction]`, where the
estimated battery fraction is clamped to 0–1.

## Send a position command

Obtain the gateway key through the MOTION app. The vendor manual describes
opening Settings → About MOTION and tapping five times to reveal it; app versions
may differ. The key and gateway token must each be exactly 16 UTF-8 bytes.

This example moves only the device explicitly named by the environment variable:

```js
const { MotionGateway } = require('motionblinds');

async function main() {
  const { MOTION_GATEWAY_IP, MOTION_DEVICE_MAC, MOTION_KEY } = process.env;
  if (!MOTION_GATEWAY_IP || !MOTION_DEVICE_MAC || !MOTION_KEY) {
    throw new Error('Set MOTION_GATEWAY_IP, MOTION_DEVICE_MAC, and MOTION_KEY');
  }
  const gateway = new MotionGateway({ gatewayIp: MOTION_GATEWAY_IP, key: MOTION_KEY });
  gateway.on('error', error => console.error(error.message));
  try {
    await gateway.getDeviceList(); // Obtain the current gateway token.
    await gateway.writeDevice(MOTION_DEVICE_MAC, MotionGateway.Blind, {
      targetPosition: 50,
    });
  } finally {
    gateway.stop();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
```

Position fields accept 0–100; angles accept 0–180. Top-down/bottom-up payloads can
use `targetPosition_T`, `targetPosition_B`, `operation_T`, and `operation_B`.
`Operation` includes `CloseDown`, `OpenUp`, `Stop`, and `StatusQuery`. A successful
acknowledgment is not proof that a motor reached its destination; observe reports
or read status afterward. Never include the key, gateway token, or access token
in public diagnostics.

## Network and request options

| Option | Default | Meaning |
| --- | --- | --- |
| `gatewayIp` | Discover | IPv4 address of the gateway to use |
| `multicastInterface` | OS default | Local IPv4 interface used for multicast |
| `listenMulticast` | `true` | Listen on UDP 32101 for unsolicited traffic |
| `timeoutSec` | `3` | Maximum active-request duration; excludes time waiting behind the same request key |
| `key` / `token` | Unset | Credentials used to derive the protocol's AES access token |

Discovery/control sends to UDP 32100. Multicast uses `238.0.0.18`; the receive
socket binds `0.0.0.0:32101` and then joins the group, including on Windows.
`listenMulticast: false` supports unicast-only requests but does not receive
unsolicited reports sent to the multicast port. Firewalls, VLANs, VPNs, and
interface selection can affect delivery.

There are at most five send attempts, with bounded backoff and the configured
deadline. Retries use increasing message IDs. Requests sharing a response key
(discovery, or the same operation/device) wait in FIFO order; different devices
can have requests in flight together. MAC matching is case-insensitive.

Some firmware omits response message IDs, especially discovery replies. In that
case the library can serialize requests but cannot distinguish every delayed
duplicate reply. UDP delivery and command completion are not exactly-once.
A timeout can occur after the gateway accepted a command. Do not layer unlimited
retries on top of failed control commands.

## More than 16 devices

The library does not truncate the returned device array. Tests carry 28 devices
through both a simulated receiver and real UDP loopback. That does not establish
the cause of the hardware-specific report in
[#9](https://github.com/jhurliman/node-motionblinds/issues/9), which remains open.
To diagnose it, compare gateway IP/firmware and the number of entries in each
received device-list datagram. Do not post token-bearing packets unredacted.

## Upgrading from 2.x

Version 3 requires Node.js 22+ and replaces TSDX with the TypeScript compiler and
Node's test runner. The public gateway methods remain. Changed behavior includes
serialized same-key requests, enforced timeouts, rejection of pending work on
stop, errors for rejected commands and invalid numeric inputs, and isolation
from packets sent by other gateways after selection.

Device-list declarations now describe an array rather than a one-item tuple.
Status types include multi-motor payloads. Both gateway type codes documented in
the project are excluded from `readAllDevices()`. See [CHANGELOG.md](CHANGELOG.md).

## Development and validation

```sh
npm ci
npm test
npm run test:types
npm pack --dry-run
```

CI checks Node.js 22, 24, and 26 on Linux, Windows, and macOS. Tests cover the
vendor AES vector, request collisions, stale acknowledgments, retries, shutdown,
Windows binding configuration, and real local UDP transport without hardware.

For a read-only check against a selected gateway:

```sh
MOTION_GATEWAY_IP=192.0.2.10 npm run test:hil
```

Replace the example IP with your gateway's address. This command lists and reads
devices; it does not move them. Hardware movement and firmware-specific behavior
have not been validated by the automated suite.

## License

[MIT](LICENSE).
