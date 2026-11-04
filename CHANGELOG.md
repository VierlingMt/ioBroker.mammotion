# Changelog

All notable changes to **ioBroker.mammotion** are documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The five most recent entries are also mirrored into `io-package.json#common.news`
(translated to 11 languages) so the ioBroker admin UI can show them on update.

## [Unreleased]

### Added
- **Reason of a cloud 429.** The Aliyun API gateway names the throttle that answered 429 in its response
  headers (`X-Ca-Error-Message`, for example app-key flow control versus user flow control). The adapter
  dropped them. It now logs them with the back-off warning and keeps them in
  `devices.<id>.cloud.lastRateLimitReason`, so it becomes visible whether the limit belongs to the app key,
  the account or the device.

### Changed
- **Status report paced like the official app.** Every successful Aliyun invoke answer carries
  `iotMsgHz` and `iotSameMsgHz`. The official app uses them as period and no-change period of the status
  report request; the adapter asked for a fixed 3 s / 4 s. It now uses the values from the cloud once
  known (currently 10 s / 30 s), so the mower reports no faster than the cloud allows.

### Fixed
- **Map loading on Aliyun mowers no longer triggers the 429.** With the new 429 reason the cause is
  known: the API gateway answers `Throttled by PLUGIN Flow Control` (`T429PR`) to a second invoke within
  about 10 s (live: success, next call 0.4 s later 429; quota 99 % free). The map loader sent every
  0.4 s because it assumed the mower drops its sync after 3 s. The official app sends that sync only
  every 20 s. Map loading on Aliyun mowers now keeps the normal gap (cloud `iotMsgHz` plus 1 s) and
  re-sends the sync every 20 s. A plugin 429 backs off 30 s (doubling up to 30 min) instead of 15 min
  to 6 h, since it is an interval limit, not a used-up quota.
- **Map frames of Aliyun mowers are acknowledged in time.** The mower repeats an unacknowledged frame
  five times, once a second, and then gives up; the 10 s gap made every acknowledgement late, so the
  element list stayed at 1 of 2 frames. Frame acknowledgements now go out 2.5 s after the previous
  invoke, like the app (which acknowledges at once). A rate-limited acknowledgement is not repeated,
  since the mower has given up by then; the element is requested again instead.
- **Commands for shared Aliyun devices work again.** Live diagnosis on a shared Luba 2 AWD (Aliyun product
  key, firmware 1.11): the Mammotion platform lists the device in neither the device list nor the device
  page for the shared account, only the Aliyun bindings do. The Mammotion invoke now answers
  `50104 "The device is offline"` for such devices instead of the former "Invalid device", and the adapter
  did not fall back to Aliyun on that answer, so every command failed. Devices that only the Aliyun
  bindings list are now sent to the Aliyun path directly (logged once at start), and a Mammotion
  `50103/50104` answer falls back to Aliyun for that command. The wake-up request is only used for
  Mammotion-platform devices.
- **Respect the cloud send quota of Aliyun-era mowers.** Firmware below 1.30.25.1 has a cloud send quota;
  after many requests the cloud answers 429 for hours (live: the quota of a Luba 2 AWD on 1.11.1.16 was
  used up after a day of testing). The 429 back-off now starts at 1 minute and doubles per consecutive 429
  up to 1 hour instead of a flat 30 s, which only kept knocking. Background requests of Aliyun-only
  devices keep to an own budget of 400 per 12 hours (PyMammotion uses 600); commands a user triggers are
  not counted. The status report of such devices is refreshed every 5 minutes while working and every
  60 minutes otherwise. Map loading no longer waits out long back-offs.
- **Aliyun-era mowers: no endless report stream, rare REST polling.** Live 04.11.: after a restart only two
  commands went out, 10 s apart, 23 minutes after the last 429, and the second already got 429. Something
  continuous had to be the cause. Two candidates the app does not do while it is closed: the adapter
  ordered the status report with `count = 0`, so the mower reported every 10 s around the clock (each
  refresh re-arms it), and REST property/status polling every 30 s (about 2500 calls a day). For
  Aliyun-only devices the report is now ordered with `count = 3`, and REST polling runs every 5 minutes
  while the Aliyun MQTT push channel is up. The staleness watchdog waits at least 2.5 poll intervals.
- **Map transfers follow the app: quick burst, fresh sync, every frame acknowledged.** Live (03./04.11.,
  local test session): with the same account the app loaded the map in ~20 s (~7 messages/s, no 429), while
  the adapter never got past the element list overnight ("element list incomplete (1/2)" every round) and
  still ran into 429. Two causes:
  - the mower answers map requests only while the app counts as "synchronised", which lasts a few seconds;
    sending one message per 10 s lost the sync before the next frame. Map transfers now run as a burst
    (400 ms gap), re-send the sync before a request when it is older than 3 s, and acknowledge every frame
    including the last one;
  - the old zone discovery requested every element without ever acknowledging a frame, so the mower kept
    repeating its frames about once a second (seen as endless "no zone names / no HashListAck" in the log).
    It is removed. Zones now come from the map loader (mowing areas of the map), the zone names from one
    `NavMapNameMsg` (nav 58) request as in the app. `commands.requestAreaNames` starts exactly that.
  The per-round limit of 15 messages is replaced by a safety cap of 400 per run; on a 429 the load pauses
  and continues later.
- **Map loading in small rounds, resumable across restarts.** Live findings of 03.11. (local test
  session): the cloud allows only a handful of messages before a 429, the ban lifts after about 15
  minutes, and an incomplete element list (1 of 2 frames) made the loader work with 20 of 29 elements and
  never fetch the rest. Now:
  - the element list is only used when complete (longer frame timeout, one repeated acknowledgement);
  - the last frame of a list or element is no longer acknowledged (its data is already there), which
    halves the messages for single-frame elements;
  - Aliyun-era mowers load at most 15 messages per round, then pause 30 minutes and continue
    (`map.status` = `paused: x/n elements loaded …`); the loaded elements are kept in `map.progressJson`
    and survive adapter restarts.
- **Cloud quota states.** `cloud.msgSurplus`, `cloud.msgTotal`, `cloud.msgResetInSec`, `cloud.quotaJson`
  (counters the Aliyun invoke answer carries) and `cloud.lastRateLimitAt`, to learn how the quota behaves.
- **Aliyun-era mowers: send slowly from the start, sit out bans.** Live: once a 429 came, every request
  failed for hours, single requests 10 minutes apart included, so slowing down after the first 429 is too
  late. Aliyun-only devices now get at most one message every 10 s at all times, a 429 back-off of 15
  minutes doubling up to 6 hours, and no automatic map load while a back-off runs.
- **Map loading copes with the cloud quota.** Live: the element list (29 elements) arrived, then the cloud
  answered 429 after about 25 messages. After the first 429 the map load now continues slowly (one message
  every 10 s), waits out back-offs of up to 5 minutes, keeps the elements loaded so far and continues with
  the remaining ones on the next attempt (manual or automatic every 30 minutes) instead of starting over.
  The partial map is written every 5 elements; `map.status` reads `paused: x/n elements loaded …`. For
  Aliyun-only mowers the sync message is sent once at the start and again only when the mower stops
  answering, to save quota.
- **No zone re-discovery on every start.** The adapter asked the mower for all zones on every start
  (one cloud request per map element), which used up a large part of the send quota during restarts.
  It now only asks when no zones are known; `commands.requestAreaNames` still refreshes them on demand.
- **No more 429 bursts.** Invokes to the same device are now queued with at least 1.5 s between them (the
  Aliyun invoke answered 429 to a second call 0.35 s after the first). Map loading waits out a 429
  back-off and continues instead of failing.
- **JWT MQTT is only used for Mammotion-platform devices** (the device page), as in the app. Subscribing an
  Aliyun device's topics on the Mammotion broker made it close the connection, which was the real cause of
  the "keeps disconnecting" loop on shared accounts. Without such devices the adapter uses the Aliyun MQTT
  channel only.
- **JWT MQTT no longer drops every few seconds.** The adapter subscribed nine topics per device on the
  Mammotion broker; the app subscribes exactly three (`/sys/<pk>/<dn>/thing/event/+/post`,
  `/sys/proto/<pk>/<dn>/thing/event/+/post`, `/sys/<pk>/<dn>/app/down/thing/status`). The broker
  closes the connection on any other topic, which caused the "keeps disconnecting" loop, the 30-minute
  suspension and the fallback to the Aliyun channel. Mowers that moved to the Mammotion platform
  (newer firmware) are reported "offline" by Aliyun although they are online, so every command failed.
  The adapter now subscribes only the app's three topics on the Mammotion broker.

### Added
- **Status report is now decoded.** The adapter has always subscribed to the mower's status report
  (`MctlSys.todev_report_cfg`, sys field 38) but ignored the answer (`toapp_report_data`, sys field 39).
  It is now decoded into new read-only states: charging state, lock state, headlamp, battery heating,
  RTK fix status and satellites, local map position, current zone, job progress / mowed area / job time,
  connectivity, maintenance counters (mileage, work time, battery cycles, blade hours) and the RTK base
  station version. See README "Object tree" for the full list.
- **Error codes.** `errors.code`, `errors.time` and `errors.listJson` hold the ten most recent error codes
  the mower pushes in its update buffer (sys field 27, type 2), as positive numbers, newest first.
  `device_warning_event` and the notification events (`device_notification_event`,
  `device_warning_code_event`, `device_information_event`) fill `errors.lastWarning*` and
  `errors.lastNotification*`. Only the numbers are exposed; the adapter ships no error texts.
- **Map anchor.** `map.baseLatitude/baseLongitude/baseYawDeg` (origin and rotation of the local map) and
  `map.dockX/dockY` (charging station) from the update buffer (type 1), or from the RTK info for models
  without a base station. Groundwork for drawing zones on a map.
- **Periodic report refresh.** The report only flows for a short time after each request, so the adapter
  re-requests it every 2 minutes while the mower is working, returning or paused, and every 10 minutes
  otherwise, only while `telemetry.connected` is true.
- **Map as GeoJSON.** New button `commands.requestMap` loads all map elements (hash list, then the points
  of every element; every data frame is acknowledged, as the mower expects) and writes `map.geojson`:
  zones with their names, obstacles, no-go areas, paths, virtual walls and the charging station, in WGS84.
  Loads automatically when `telemetry.mapHash` changes (at most every 30 minutes). Progress in `map.status`.
  Zone classification is paused while the map loads, so both do not query the mower at the same time.
- **Wake a sleeping mower.** While charging, mowers go to sleep (work mode 48, now named `SLEEPING`) and
  drop their cloud connection; every command then fails with "The device is offline" although the app
  can still reach the mower. The app wakes it over REST when it is opened. The adapter now does the same
  for commands a user triggers (`commands.*`, `zones.*.start`): on an offline error it calls
  `device-server/v1/device/wakeup` (at most once a minute, waiting up to 60 s for the answer, which the
  cloud only sends after a while) and retries the command for up to 90 seconds.
  Background requests (status report refresh, automatic map load) never wake the mower.
- The automatic map load waits 20 seconds after the report that triggered it and retries after 2 minutes
  when the mower went offline again, instead of waiting 30 minutes.
- Decoder logic lives in `src/lib/mower-protocol.ts` with unit tests on hand-built protobuf frames.

### Notes
- `jobTotalMin` / `jobRemainingMin` split the packed `work.progress` field (low/high 16 bits). This
  interpretation is not yet verified on a live device; `jobProgressRaw` keeps the raw value.
- Map loading uses receiver 17 (navigation) first on newer models and falls back to receiver 1, and sends
  `todev_ble_sync = 3` before the transfers. Both follow the app's behaviour but are not yet verified live.
- `headingRaw` is the raw heading divided by 10000; the unit (degrees or radians) still has to be
  confirmed live.

## [0.0.17] – 2026-09-06

### Fixed
- **Adapter went silent after a failed device-list refresh.** When a device-list refresh (daily restart,
  staleness recovery, command retry) hit a transient cloud failure such as a short internet outage, the
  legacy bindings request failed, the merged device list came back empty and `syncDevices` replaced the
  cache with that empty list. With no cached devices the adapter stopped legacy polling, `info.deviceCount`
  dropped to 0 and `info.connection` stayed `true`, so the reconnect watchdog never fired. The adapter then
  produced no telemetry and no log line until the next scheduled restart (observed: 14 hours of silence while
  the mower was working normally).

  `refreshSessionAndDeviceCache` now records which requests failed and only trusts an empty result when every
  request succeeded. If a request failed and devices are cached, the cache is kept, polling continues and
  `info.lastError` names the failed requests. If a request failed and nothing is cached, the refresh throws so
  the existing error path (`markAuthFailure` -> `reconnectIfAllowed`) retries instead of settling on
  "0 devices". A genuinely empty account still syncs to zero devices as before. The decision logic lives in
  `src/lib/device-list.ts` and is unit-tested.

### Changed
- `npm run check` and the build-time type-check work again with TypeScript 6: the root `tsconfig.json` now
  lists `types: ["node", "mocha"]` explicitly (TypeScript 6 stopped including every `@types/*` package
  automatically) and enables `rewriteRelativeImportExtensions` so `*.test.ts` files can import sibling
  modules with a `.ts` extension, which the native type-stripping loader of Node 22+/24 requires.

## [0.0.16] – 2026-06-15

### Added
- **Robust problem detection (`telemetry.healthProblem` / `telemetry.healthReason` / `telemetry.lastRealChange`).**
  `telemetry.connected` and `telemetry.lastUpdate` reflect the adapter<->cloud link only: `lastUpdate`
  is rewritten to `Date.now()` on every poll and `connected` mirrors the cloud's cached online flag, so
  both keep looking "ok" even when the robot is switched off. The new states judge the *real* robot data
  instead: `lastRealChange` records when a real value (deviceState, battery, coordinates) last actually
  changed, and `healthProblem` is raised when the robot is in a non-resting state (e.g. PAUSE) without any
  change for longer than the configurable threshold, or when the cloud reports an explicit fault state
  (OFFLINE/UNCONNECTED/DISABLE/LOCATION_ERROR/OTA_UPGRADE_FAIL). Charging/docked/idle states never trigger it.
  New instance option `healthStaleThresholdMin` (default 60 minutes).

## [0.0.15] – 2026-05-14

### Fixed
- **Hotfix for 0.0.14: 429 retry storm on rate-limited accounts.** User report on 0.0.14
  showed `Command request-iot-sync first attempt failed (Request failed with status code 429), new login + retry`
  repeating every 5-6 seconds.

  Root cause: 0.0.14 added 429 to `isRetryableCommandError` so the existing re-login retry
  could absorb transient throttling. On accounts where the modern API rate-limits AND the
  legacy/Aliyun command endpoint also returns 429 (account-level throttle), every retry
  called `refreshSessionAndDeviceCache` (login + device list + records + bindings = ~3-4
  extra HTTP calls), then re-invoked the command, which 429'd again. Each background
  `requestIotSync` produced one warn line and made the throttling worse.

  Two-part fix:
  1. **Remove 429 from `isRetryableCommandError`.** 5xx stays retryable (transient server
     side), but 429 means "you are sending too fast" - retrying with a session refresh is
     the opposite of what you want. The fallback inside `invokeTaskControlCommandWithFallback`
     already routes the attempt through the legacy channel once; if that also 429s, surface
     the failure and let the natural call cadence give the cloud a chance to recover.
  2. **Per-device 429 circuit breaker.** New `rateLimitBackoffUntil: Map<deviceKey, unix-ms>`
     and `RATE_LIMIT_BACKOFF_MS = 30_000`. Whenever an invoke fails with 429 (either modern
     or legacy path), the breaker arms for 30 s on that device. While armed, every
     subsequent invoke for that device fast-fails locally with
     `Cloud rate-limited (429); backing off for another Xs.` - no HTTP call, no
     `refreshSessionAndDeviceCache`, no log spam beyond a single warn at arm-time. The
     breaker resets on adapter unload.

### Changed
- **`lastCommandActivityAt` is only bumped by user-driven entry points** now -
  `executeTaskControlCommand` and `executeTaskSettingsCommand`. The previous placement
  inside `invokeTaskControlCommandWithFallback` also fired for background syncs
  (`requestIotSync`, area-name requests etc.), which meant the 0.0.13 staleness watchdog
  was effectively disabled whenever a background sync was failing in a loop (the
  30-second active-command window kept getting renewed by the failing syncs themselves).

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
