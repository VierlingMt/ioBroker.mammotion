# Changelog

All notable changes to **ioBroker.mammotion** are documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The five most recent entries are also mirrored into `io-package.json#common.news`
(translated to 11 languages) so the ioBroker admin UI can show them on update.

## [Unreleased]

_No unreleased changes._

## [0.0.14] – 2026-05-14

### Fixed
- **`status code 429` from the modern cloud no longer kills control commands.**
  Reported case: `Command resume for Luba-VPKC532K failed: Request failed with status code 429`.
  The modern endpoint `POST {iotDomain}/v1/mqtt/rpc/thing/service/invoke` rate-limits the
  account, but the legacy/Aliyun command endpoint uses a separate quota and was already
  available — the fallback in `invokeTaskControlCommandWithFallback` simply did not list 429
  as a fallback trigger. Now both `429` and `5xx` responses (axios status or message match)
  fall through to the legacy path. Routing decisions for transient failures (429, 5xx) are
  not cached in `legacyOnlyDevices`, so the next command still attempts modern first.
- **Re-login retry now covers 429/5xx too.** `isRetryableCommandError` previously only
  considered 401/403 and "invalid device". After the fallback, if the retry path runs, 429
  and 5xx are now classified retryable so the existing re-login + retry chain in
  `executeTaskControlCommand` absorbs a transient failure instead of bubbling it up.

### Changed
- **Staleness recovery yields to active commands.** The 0.0.13 data-staleness watchdog
  (`maybeRecoverFromDataStaleness`) tracks `lastCommandActivityAt` (set at the entry of
  `invokeTaskControlCommandWithFallback`) and skips the heavy session/MQTT refresh if a
  command was sent within the last 30 seconds. Avoids piling additional refresh traffic on
  top of an account that the cloud is already throttling, which would only make 429
  fallout worse.

## [0.0.13] – 2026-05-13

### Added
- **Data-staleness watchdog for legacy/Aliyun REST polling.** Tracks the timestamp of the last
  successful poll that returned data. When no telemetry data lands for more than 5 minutes
  while polling is enabled, the adapter forces a full recovery: tears down the existing
  Aliyun MQTT client (which may still claim to be connected while the broker-side AEP binding
  is silently broken after a keepalive timeout), clears the legacy session cache, re-runs
  `refreshSessionAndDeviceCache`, and re-establishes the Aliyun channel. The first-success
  log line re-arms so the operator can see in the log when telemetry resumes.
- **Empty-cycle warn line.** After 5 consecutive empty poll cycles (~2.5 minutes at the
  default 30 s interval) a one-time `warn` is emitted with the last fetch error
  (`Legacy polling: 5 consecutive empty cycles. Last fetch issue: …`). Previously these
  failures stayed at `debug` and silent failures were invisible in normal log levels.

### Context
- Symptom this addresses: shared/legacy-only account, Aliyun MQTT keepalive timeout, MQTT
  auto-reconnects so the client reports "connected" again, but the AEP virtual-device
  binding is gone — REST polling then keeps firing every 30 s but its calls return errors
  that don't match `isAuthError()`, so `markAuthFailure()` never triggers and `lastUpdate`
  freezes for hours while `info.connection` stays `true`.

## [0.0.12] – 2026-05-08

### Changed
- Legacy/Aliyun REST polling honours the configured `legacyPollIntervalSec` directly when the
  mower is idle, instead of stretching to `4 × interval` (clamped 120..300s). With the default
  30s setting the polling rate is now 30s instead of the previous 120s. Active polling stays
  at half the configured interval (clamped 10..60s).
- Removed the 5-minute polling suspension that fired after any MQTT message landed. For
  shared/legacy-only accounts the Aliyun MQTT push channel rarely delivers full telemetry, so
  the suspension caused long gaps in `info.lastMessageTs` and per-device `telemetry.lastUpdate`
  even when REST polling would have happily delivered fresh data. Polling now runs in parallel
  with MQTT; duplicate updates are absorbed by `setStateChangedAsync`.

### Added
- One-time `info` log on the first successful polling cycle per session
  (`Legacy REST polling: first telemetry update received …`) so operators can confirm that
  REST polling is actually delivering data without enabling debug logging.

## [0.0.11] – 2026-05-08

### Added
- New optional instance setting `aliyunMqttTlsAllowInsecure`. Effective only when
  `aliyunMqttUseTls` is also enabled. Disables broker certificate verification
  (`rejectUnauthorized: false`) for the legacy/Aliyun MQTT client. The connection stays
  TLS-encrypted, but the broker identity is no longer authenticated.
- Intended workaround for hosts whose Node.js installation cannot verify Aliyun's
  certificate chain (typical error: `Aliyun IoT MQTT error: unable to get local issuer
  certificate`). Aliyun sometimes serves the leaf certificate without the matching
  GlobalSign intermediate; older Linux distributions ship a CA bundle that does not include
  the necessary intermediate either.
- Logs a one-time `warn` per session when the setting is active to keep the trade-off
  visible.
- UI checkbox is hidden until the parent `aliyunMqttUseTls` setting is enabled.
- Translated UI labels, hints and news entry in all 11 supported locales.

## [0.0.10] – 2026-05-08

### Added
- New optional instance setting `aliyunMqttUseTls`. When enabled, the legacy/Aliyun MQTT client
  connects via TLS on port 8883 (`securemode=3`) instead of plain TCP on port 1883
  (`securemode=2`). Useful for networks where outbound 1883 is blocked (consumer routers,
  ISPs, corporate firewalls).
- The setting defaults to **off** so existing installations keep the original plain-TCP
  behaviour after the update. No automatic migration; users who need TLS opt in via the
  adapter instance settings.
- Translated UI labels and hints for the new setting in all 11 supported locales.

### Changed
- Repeating MQTT `error` events (e.g. continuous `connack timeout`) are now logged at `warn`
  only on first occurrence per client; identical follow-up errors drop to `debug` until
  the next successful connect resets the counter. Both the JWT MQTT and the legacy/Aliyun
  MQTT client benefit from this. `info.lastError` is still updated on every error.

## [0.0.9] – 2026-05-04

### Fixed
- **Reconnect-storm log noise on shared accounts.** Three coordinated changes:
  1. JWT MQTT stability watchdog – when the broker disconnects shortly after each connect (lifetime
     < 10 s) three times within 3 minutes, the JWT MQTT client is closed cleanly and suspended for
     30 minutes; the adapter falls back to the Aliyun channel. `refreshSessionAndDeviceCache` honours
     the suspension and does not recreate the client during the cooldown.
  2. Area-name re-request is throttled to at most once per device per minute, so the request does not
     fire on every JWT MQTT (re)connect.
  3. Devices that respond with "Invalid device" or "Access to this resource requires authentication"
     to the modern command path are remembered for the session. Subsequent commands skip the modern
     attempt entirely; the recurring `warn` line is now a one-time `info` per device, with subsequent
     fallbacks logged at `debug`.
- Reconnect events now log at `debug` (`JWT MQTT reconnected.`) instead of repeating `info  MQTT connected.`.

### Added
- Comprehensive `README.md` rewrite (table of contents, architecture chapter, troubleshooting, known issues).
- `CHANGELOG.md` as the canonical change log; previous entries lived only inside the README.
- `CLAUDE.md` codebase guide for future automated assistance sessions.

### Documented
- Continuation fork notice (community continuation of the upstream repository).

## [0.0.8] – 2026-01

### Fixed
- Uncaught `connack timeout` crash. MQTT event handlers are now wrapped in `try/catch` and a no-op error listener is
  attached before `client.end(true)` to swallow late errors during shutdown or reconnect (`onUnload`, `connectMqtt`,
  `connectAliyunMqtt`).

## [0.0.7] – 2025-12

### Fixed
- Zone discovery race condition: per-device discovery lock (`zoneDiscoveryInFlight`) prevents parallel
  classification runs.
- Unknown hash reclassification handling reduces temporary zone drops during MQTT flapping.
- Fallback zone naming now produces unique and gap-free `Area_<n>` IDs (no more duplicate `Area_2_2`,
  no missing `Area_4`).

### Changed
- Adapter log messages are now consistently in English.

### Added
- Standard GitHub QA workflows: `test-and-release`, `dependabot`, `automerge-dependabot`.

## [0.0.6] – 2025-11

### Added
- Product-key sync from PyMammotion (`npm run sync:product-keys`) and an optional weekly GitHub workflow that
  opens a PR when new product keys/devices appear upstream.
- New state `devices.<id>.productKeyGroup` for transparent model classification.

### Improved
- Product-key based model detection now correctly recognises Yuka Mini and other variants that the API would
  otherwise report as generic Yuka.

## [0.0.5] – 2025-10

### Improved
- Yuka compatibility for route execution (`startZones`, `startAllZones`, single-zone start).

### Changed
- Model-aware command limits, including Yuka / Yuka Mini route-spacing ranges (15–30 cm / 8–12 cm).
- Route reserved-byte mapping aligned with PyMammotion behaviour.
- NAV receiver selection adjusted for route commands (Yuka firmware variants only respond on receiver 17).

## [0.0.4] – 2025-09

### Added
- `commands.payload` and `commands.lastPayload` for JSON-based command execution and traceability.
- `commands.routePayloadJson` retained as legacy alias of `commands.payload`.

### Changed
- Start / route executions now persist the actual payload to `commands.lastPayload`.
- Payload can also trigger task-control actions (`start`, `pause`, `resume`, `stop`, `dock`, `cancelJob`,
  `cancelDock`).
- Cleaner UI profile: advanced and internal states marked as `expert`.
- App-like limits enforced for cut height, route width, mowing laps and obstacle laps.
- Model-aware command limits (Yuka / Yuka Mini spacing and speed ranges).
- Route reserved bytes and NAV receiver selection aligned to PyMammotion behaviour, improving Yuka compatibility.
- Zone execution order driven by `zones.<name>.position` for `startZones` and `startAllZones`.

### Known issue (carried forward)
- Telemetry coverage is not complete yet (MQTT decoding / RTK fields still in progress).

## [0.0.3] – 2025-08

### Fixed
- Polling silently stopped when the device cache became empty – polling watchdog added.
- Shared devices (`owned: 0`) were not detected – legacy bindings are now always merged.
- Modern API errors no longer crash the full device refresh.

### Added
- Zone / area management: `requestAreaNames` button, per-zone `enabled` toggle, per-zone `start` button,
  `startZones` batch button.
- `routePayloadJson` string state for JS-adapter automations (full route payload as JSON).

### Changed
- `routeAreasCsv` renamed to `routeAreaIds`. Existing values are migrated automatically.

## [0.0.2] – 2025-07

### Improved
- Telemetry refresh strategy (adaptive polling + post-command sync).
- Automatic apply for task, route and non-work settings.
- Extended command handling and retry flow.

## [0.0.1] – 2025-06

- Initial release: cloud login, device discovery, basic command channel, JWT MQTT telemetry,
  Aliyun polling fallback.
