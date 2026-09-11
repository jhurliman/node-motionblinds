# Releasing motionblinds

The maintainer no longer has the required account or hardware. Releases may proceed after automated checks, with the README and release notes explicitly stating that live compatibility is unverified. Do not describe simulated tests as hardware or service validation. Invite active users to test and take over maintenance.

Run `npm ci`, `npm test`, `npm run test:types`, and `npm pack` before publishing. Publish the client before updating the Homebridge plugin dependency.

## Community hardware validation

With a compatible gateway, run `MOTION_GATEWAY_IP=<gateway-ip> npm run test:hil` to check discovery and status reads without moving blinds. Include OS, Node version, gateway model, and firmware in reports. Motor command tests should target a deliberately selected device; never include API keys in reports.
