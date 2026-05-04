# CLAUDE.md

Guidance for Claude (and other AI assistants) working in this repository. Optimised for accuracy first, brevity second. Keep this file up to date when major refactors land.

> This file is part of a **public** repository. Do not paste secrets, raw cloud credentials, personal data or speculative reverse-engineering details here. Stay at architectural / behavioural level.

---

## Project at a glance

- **Name:** `iobroker.mammotion`
- **Purpose:** ioBroker adapter that connects Mammotion robotic mowers (Luba / Yuka / Spino / RTK / CM900) to the Mammotion cloud and exposes telemetry plus control as ioBroker objects.
- **Status:** community continuation fork. See `README.md` "Fork notice".
- **Language / runtime:** TypeScript, Node.js ≥ 20, compiled with `@iobroker/adapter-dev` (`build-adapter ts`).
- **Package manager:** npm.
- **License:** MIT.

## Repository layout

```
.
├── admin/                  # ioBroker admin UI assets
│   ├── jsonConfig.json     # instance settings form (email, password, deviceUuid, ...)
│   ├── i18n/               # 11 locales used by the UI
│   └── mammotion.png       # adapter icon
├── build/                  # compiled JS output (generated, ignored in src reviews)
├── scripts/
│   └── sync-product-keys.mjs   # regenerates src/lib/product-keys.ts from upstream PyMammotion
├── src/
│   ├── lib/
│   │   ├── adapter-config.d.ts # AdapterConfig augmentation for ioBroker types
│   │   └── product-keys.ts     # AUTO-GENERATED: product-key → model groups
│   ├── main.ts             # the adapter (single class, ~5.7k lines)
│   └── main.test.ts        # unit-test placeholder (expand when adding tests)
├── test/                   # mocha integration + package validation tests
├── .github/workflows/      # CI: test-and-release, sync-product-keys, automerge-dependabot
├── io-package.json         # ioBroker manifest (version, news, native config defaults)
├── package.json            # npm metadata + scripts
└── tsconfig.json
```

## Build, lint, test

```bash
npm install
npm run build       # tsc -> build/main.js
npm run watch       # rebuild on change
npm run check       # tsc --noEmit (no emit, type check only)
npm run lint        # eslint
npm run test:ts     # mocha for src/**/*.test.ts
npm run test:package
npm test            # = test:ts + test:package
npm run dev-server  # iobroker dev-server on http://localhost:8081
```

When changing `src/lib/product-keys.ts`, prefer regeneration:

```bash
npm run sync:product-keys
```

## Architecture overview (high-level)

The adapter is a single TypeScript class extending `@iobroker/adapter-core`'s `Adapter` and runs as an ioBroker `daemon`. It connects to three cloud channels:

1. **Modern Mammotion HTTP API** (Bearer JWT) – login, device list, command invoke for owner accounts.
2. **JWT MQTT broker** – real-time telemetry + command response for owner accounts.
3. **Legacy / Aliyun IoT** – authenticates with an `iotToken`, used for shared devices that the modern API does not authorise. Provides a parallel MQTT push channel (with virtual-device topic routing) and a REST polling fallback.

The user-facing object tree, commands and behaviour are identical across channels. `info.connection` and `info.mqttConnected` reflect the active state.

## Internal structure of `src/main.ts`

The file is large but follows a stable, predictable pattern. Sections, in order:

1. **Constants / enum maps** – device type names, work-mode names, route mode maps, model-aware limits.
2. **`Mammotion` class fields** – session, MQTT clients, timers, in-flight maps, deduplication caches.
3. **Lifecycle** – `onReady`, `onUnload`, connection-state helpers.
4. **`onStateChange` dispatcher** – matches `commands.*` / `zones.*.start` regex paths and routes to handlers.
5. **Command handlers** – `handleDeviceCommand`, `handleTaskSettingsCommand`, `handleRouteCommand`, `handleNonWorkHoursCommand`, `handleBladeControlCommand`, `handleStartZones`, `handleStartAllZones`, `handleStartSingleZone`, `handlePayloadCommand`, `handleRequestAreaNames`.
6. **Read helpers** – `readTaskSettings`, `readRouteSettings`, `readBaseRouteSettings`, `readNonWorkHoursSettings`, `readBladeControlSettings`.
7. **HTTP API** – `createSession`, `login`, `fetchDeviceList`, `fetchDeviceRecords`, `fetchMqttCredentias`, `refreshSessionAndDeviceCache`, `ensureValidSession`, `extractIotDomain`, `extractAreaCodeFromToken`.
8. **MQTT** – `connectMqtt`, `handleMqttMessage`, plus the Aliyun counterpart `connectAliyunMqtt`, `callAepHandle`, `ensureAliyunMqttRunning`.
9. **Modern command invocation** – `invokeTaskControlCommandModern`, `invokeTaskControlCommandWithFallback`, `executeTaskControlCommand`, `executeTaskSettingsCommand`, `executeEncodedContentCommand`.
10. **Legacy / Aliyun** – `fetchLegacyDeviceRecords`, `invokeTaskControlCommandLegacy`, `ensureLegacySession`, `createLegacySession`, `fetchLegacyBindings`, `pollLegacyTelemetry`, `applyLegacyTelemetry`, `applyLegacyStatusTelemetry`, `applyLegacySnapshot`, `callLegacyApi`, `signLegacyGatewayRequest`.
11. **Polling controller** – `startLegacyPolling`, `stopLegacyPolling`, `runLegacyPollingCycle`, `scheduleLegacyPolling`, `getLegacyNextPollDelayMs`, `enableFastLegacyPollingWindow`, `shouldUseActiveLegacyPolling`.
12. **Reconnect / watchdog** – `startReconnectTimer`, `reconnectIfAllowed`, `markAuthFailure`.
13. **Payload builders** – `buildTaskControlContent`, `buildTaskSettingsContent`, `buildSetBladeHeightContent`, `buildSetMowSpeedContent`, `buildRequestIotSyncContent`, `buildRoutePlanningContent`, `buildNonWorkHoursContent`, `buildBladeControlContent`, `buildRouteReservedString`, `buildLubaMessage`, `buildNavTaskControlCommand`, `buildAreaNameListContent`, `buildNavGetCommDataContent`, `buildAreaListWithUniqueNames`.
14. **Zone/area discovery** – `sendAreaNameListRequest`, `requestAreaNamesForHashes`, `requestAreaNamesForAllDevices`, `requestAreaNamesForMissingDevices`, `updateZoneStates`, `cleanupObsoleteZones`, `rememberAreaNames`, retry timer state machine (`startAreaNameRetry`, `runAreaNameRetry`, `scheduleAreaNameRetry`).
15. **Protobuf helpers** – varint and length-delimited encoders/decoders, `encodeFieldVarint/Bytes/RawBytes/String/Fixed64/Float32`, `decodeProtoFields`, `tryParseAreaHashNames`, `tryParseNavGetHashListAck`, `parseMctlSysProto`, `resolveCommDataAck`.
16. **Object factory** – `ensureBaseStates`, `ensureDeviceStateObjects`, `applyDeviceCommandLimits`, `createCommandState`, `createWritable*State`, `createReadonlyState`, `applyCleanCommandUiProfile`.
17. **Utilities** – `extractAxiosError`, `safeJsonParse`, `resolveDeviceTypeName`, `generateHardwareString`, `hydrateContextFromTelemetry`, `resolveDeviceKey`, `sanitizeObjectId`, `randomUuid`.

When editing, search by method name with `grep -n 'private \w*(' src/main.ts` to jump.

## Conventions

- **Single class.** Helpers live as private methods on the adapter; we have not yet extracted modules. If you split files, keep `main.ts` as the entry that ioBroker loads (`build/main.js`) and re-export.
- **No third-party protobuf library** – encoders/decoders are hand-written. They handle only the wire types the device uses (varint, length-delimited bytes, fixed64, float32). Don't add `protobufjs`; keep the dependency surface small.
- **`setObjectNotExistsAsync` for new objects, `setStateChangedAsync`/`setStateAsync` for values.** Reserve `extendObjectAsync` for channels.
- **Trigger states** are booleans: write `true` to fire, the handler resets to `false` on completion (success or error). Keep this contract.
- **Debounced auto-apply** uses `Map<string, NodeJS.Timeout>` + `clearTimeout`. Reuse `clearAutoApplyTimers` rather than reinventing.
- **Logging:**
  - `info` for normal cloud transitions (login, MQTT connect, command result).
  - `warn` for retryable / falling-back errors.
  - `error` for fatal init failures only.
  - `debug` for protocol traces (tag prefix in brackets, e.g. `[MQTT]`, `[ZONE]`, `[AREA-REQ]`).
- **English log messages.** Comments may stay in English too; user-visible strings in `admin/i18n/` already cover localisation.
- **No emojis** in code or commit messages.

## Object-tree contract

See `README.md` "Object tree" for the user-facing layout. When you add new states:

1. Add an `setObjectNotExistsAsync` call in `ensureDeviceStateObjects` (or `ensureBaseStates`).
2. Initialise the value with `setStateAsync` if the state has a useful default.
3. If renaming an existing state, add a migration block (see how `routeAreasCsv` → `routeAreaIds` or `routeTowardIncludedAngelDeg` → `routeTowardIncludedAngleDeg` are handled).
4. Mark advanced/internal states as `expert` (use `applyCleanCommandUiProfile`).

## Known issues / open work

- **Shared-account log noise.** JWT MQTT churns every ~5 s on shared accounts and re-fires the area-name request, which falls back to legacy and emits a `warn`. Fix candidates:
  - Detect "this account only sees shared devices" once per session and skip JWT MQTT for that case.
  - Throttle `requestAreaNamesForMissingDevices` to fire at most once per N seconds across reconnects.
  - Demote the modern-fallback `warn` to `debug` once the device is known to require legacy fallback.
- **Telemetry coverage.** Many MQTT events are not yet decoded into states. When debugging, enable `storeDebugPayloads` to keep raw payloads accessible.
- **`legacyTelemetryTransport: 'mqtt'`** is reserved – polling is the only working transport.
- **Hand-written protobuf.** If new device types start using fields outside our decoder coverage, extend the helpers in section 15 of `main.ts`. Test by enabling debug logs and inspecting `telemetry.lastProtoContent`.

## CI / release

- `test-and-release.yml` runs build/lint/test on Node 20 + 22 and publishes to npm on tag pushes (trusted publishing – no secrets in repo).
- `sync-product-keys.yml` runs weekly; it regenerates `src/lib/product-keys.ts` and opens a PR if upstream PyMammotion gained new keys.
- `automerge-dependabot.yml` auto-merges Dependabot PRs once CI passes.
- The release script is `@alcalzone/release-script` (`npm run release`). It updates `io-package.json` `news`, `CHANGELOG.md`, and tags the commit.

## Working with this codebase as an assistant

- **Prefer reading before writing.** `main.ts` is large; locate the relevant method first (grep for the method name) instead of re-reading whole sections.
- **Don't refactor opportunistically.** Bug fixes and feature additions are welcome; sweeping refactors should be discussed first.
- **Don't leak secrets.** No tokens or test credentials in the repo, in commit messages, or in PR descriptions.
- **Don't expose user identifiable data.** Logs, screenshots and example payloads must be sanitised.
- **Cite line numbers when helpful** (file:line) – they make review faster.
- **One feature per commit.** Use Conventional-Commit-ish prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `release:`).
- **Update `CHANGELOG.md`** in the `[Unreleased]` section as part of every functional change. The release script will move it into a versioned section.
- **Update `io-package.json#common.news`** only when bumping the version, and do not exceed 12 entries (the admin UI truncates older ones).

## Pointers

- Mammotion device matrix and product keys: upstream [PyMammotion](https://github.com/mikey0000/PyMammotion) – the source of truth for protocol details we reuse.
- ioBroker adapter docs: <https://www.iobroker.net/#en/documentation/dev/adapterdev.md>
- ioBroker JSON config schema: <https://github.com/ioBroker/adapter-react-v5/blob/main/schemas/jsonConfig.json>
