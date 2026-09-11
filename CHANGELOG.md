# Changelog

## 3.0.0 — 2026-09-10

- Document the lack of live account/hardware testing and invite an active user to take over maintenance.
- Require Node.js 22+; replace TSDX/Husky/Jest with direct TypeScript builds and Node tests.
- Ship CommonJS, ESM (named and default gateway imports), declarations, source maps, and explicit package contents.
- Serialize same-device/discovery requests, correlate acknowledged message IDs, enforce active-request deadlines, and clear/reject pending work on stop.
- Make socket start/stop idempotent and ignore stale events from closed sockets.
- Bind the receiver to the wildcard address before joining multicast, following @VBen's fix in #13; apply the requested multicast interface to the sender too.
- Accept acknowledgments on either socket, retain full device arrays, and skip both known gateway type codes when reading all devices.
- Validate write ranges and access-token inputs, reject gateway error acknowledgments, and generate valid increasing timestamps across date boundaries.
- Correct array and multi-motor status declarations; add cross-platform CI and UDP loopback tests.
- Rewrite README and replace the automatic all-blinds movement test with an explicitly selected read-only hardware check.

Thanks to @VBen for #13 and for proposing removal of TSDX in #11. This build uses the TypeScript compiler directly rather than adding another build wrapper.

Issue #9 still needs a hardware-specific reproduction; the 28-device transport tests do not establish its root cause.
