![Logo](admin/mammotion.png)

# ioBroker.mammotion

[![NPM version](https://img.shields.io/npm/v/iobroker.mammotion.svg)](https://www.npmjs.com/package/iobroker.mammotion)
[![Downloads](https://img.shields.io/npm/dm/iobroker.mammotion.svg)](https://www.npmjs.com/package/iobroker.mammotion)
![Number of Installations](https://iobroker.live/badges/mammotion-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/mammotion-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.mammotion.png?downloads=true)](https://nodei.co/npm/iobroker.mammotion/)

ioBroker adapter to control and monitor **Mammotion Luba / Yuka / Spino / RTK / CM900** mowers and base stations through the official Mammotion cloud, with a fallback channel for shared and legacy devices.

> **Fork notice (2026-05)** – This repository is a community continuation fork of [DNAngelX/ioBroker.mammotion](https://github.com/DNAngelX/ioBroker.mammotion), with thanks to the original author for the groundwork. The behaviour, control flows and protocol handling are kept compatible; this fork focuses on stability fixes, telemetry coverage and documentation.

---

## Table of contents

- [Features](#features)
- [Supported devices](#supported-devices)
- [Installation](#installation)
- [Account setup](#account-setup)
- [Configuration](#configuration)
- [Object tree](#object-tree)
- [Command behaviour](#command-behaviour)
- [Zone / area workflow](#zone--area-workflow)
- [Custom JSON payloads](#custom-json-payloads)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Known issues](#known-issues)
- [Development](#development)
- [Changelog](#changelog)
- [License](#license)

---

## Features

- Login against the Mammotion identity service (`id.mammotion.com`)
- Automatic device discovery, both **owned** (modern API) and **shared** (legacy / Aliyun bindings)
- Object tree under `mammotion.0.devices.<deviceId>.{telemetry,commands,zones}`
- Task control: **start / pause / resume / stop / dock / cancelJob / cancelDock**
- Zone / area management: discovery, per-zone enable + position, single-zone start, batch start, "start all"
- Route generator: `generateRoute`, `modifyRoute`, `queryRoute` plus inline route execution
- Blade height + speed sync (auto-applied, debounced) and dedicated blade-control command
- Non-work-hours (mute window) configuration
- Telemetry via three transports, transparent to the user:
  - **JWT MQTT** for owner accounts (real-time push)
  - **Legacy/Aliyun IoT MQTT** for shared accounts (real-time push)
  - **Aliyun REST polling** as fallback
- Adaptive polling: faster cadence after commands and while a job is active, idle cadence otherwise; 10-minute polling watchdog auto-restarts a stalled poll loop
- Automatic re-login + retry on session/auth failures (15-minute cooldown)
- `commands.payload` / `commands.routePayloadJson` accept raw JSON for full automation control (JS adapter, Blockly, …)
- Product-key driven model detection (Luba / Yuka / Yuka Mini / Yuka ML / Spino / RTK / CM900); product keys can be re-synced from PyMammotion via `npm run sync:product-keys`
- Localised UI in 11 languages (admin JSON config + adapter `news`)

## Supported devices

The adapter recognises all mowers and base stations currently listed in `pymammotion/utility/device_type.py`. At the time of writing that includes:

`Luba 1`, `Luba 2`, `Luba 2 Mini`, `Luba LA`, `Luba LD`, `Luba MB`, `Luba MD`, `Luba MN`, `Luba VA`, `Luba VP`, `Luba V Pro`, `Yuka`, `Yuka Plus`, `Yuka Mini`, `Yuka ML`, `Yuka MN100`, `Yuka MV`, `Yuka VP`, `Spino` / `Spino S1` / `Spino E1`, `RTK` / `RTK 3A0` / `RTK 3A1` / `RTK 3A2` / `RTK NB`, `CM900`.

Run `npm run sync:product-keys` (or rely on the weekly GitHub Action `.github/workflows/sync-product-keys.yml`) to refresh the list when Mammotion releases new hardware.

## Installation

While the npm release of this fork is not yet on the official ioBroker repository, install directly from GitHub:

1. In the ioBroker admin go to **Adapters → Add custom adapter (octocat icon)**.
2. Paste `https://github.com/VierlingMt/ioBroker.mammotion`.
3. Restart the adapter and open the instance configuration.

For development:

```bash
git clone https://github.com/VierlingMt/ioBroker.mammotion
cd ioBroker.mammotion
npm install
npm run build
npm run dev-server
```

Node.js **20+** is required.

## Account setup

The Mammotion cloud allows **only one active session per account**. If both the mobile app and the adapter use the same credentials they will continuously log each other out. There are two supported configurations:

### ✅ Recommended – dedicated ioBroker account + device sharing

1. Register a second Mammotion account, e.g. `you+iobroker@example.com`.
2. In the Mammotion app (logged in with your **main** account):
   - Open the device → **Settings → Share device**.
   - Enter the new account's email.
3. Log in with the **new** account on a phone once and accept the share invitation.
4. Enter the **new account's** credentials in the adapter configuration.

The adapter detects shared devices automatically. No extra configuration is needed.

> Shared devices use the legacy/Aliyun channel because the modern API only authorises owner sessions for them. This is fully functional – control commands (start, stop, zones, route, …) all work via the fallback path.

### ⚠️ Option B – direct login (not recommended)

If you only own one account and never use the mobile app you can enter your main credentials directly. Be aware that the adapter and the mobile app **will fight over the session** whenever both are active.

## Configuration

| Field | Description |
|---|---|
| `email` | Mammotion account email |
| `password` | Mammotion account password |
| `deviceUuid` | Optional virtual device UUID. Pre-filled with a working default; only change if you understand the implications. |
| `legacyPollIntervalSec` | Base polling interval for Aliyun REST telemetry (10–300 s, default 30 s). Used as-is while the mower is idle, halved while a job is active (clamped 10–60 s). REST polling now runs in parallel with MQTT push so the configured interval is the worst-case staleness even when MQTT push delivers nothing useful. |
| `legacyTelemetryTransport` | Currently `poll` is used. The `mqtt` option is reserved for a future direct-protocol implementation. |
| `storeDebugPayloads` | When enabled, raw MQTT payloads, the last protobuf blob, last route payload, etc. are persisted as states for troubleshooting. Disabled by default. |
| `aliyunMqttUseTls` | Switch the legacy/Aliyun MQTT client from plain TCP (port 1883) to TLS (port 8883, `securemode=3`). Off by default. Enable it if your network blocks outbound 1883 (typical symptom: repeated `Aliyun IoT MQTT error: connack timeout` in the log). Use a quick `Test-NetConnection -Port 1883` / `Test-NetConnection -Port 8883` (or `nc -zv host port`) from the ioBroker host to confirm before flipping. |
| `aliyunMqttTlsAllowInsecure` | Only effective when `aliyunMqttUseTls` is on. Disables broker-certificate verification (`rejectUnauthorized: false`). The connection stays TLS-encrypted, but the broker identity is no longer authenticated. Use as a workaround when your Node.js installation cannot verify Aliyun's certificate chain (typical error: `Aliyun IoT MQTT error: unable to get local issuer certificate`). Off by default. |

## Object tree

```
mammotion.0
├── info
│   ├── connection         (boolean) any cloud channel active
│   ├── mqttConnected      (boolean) JWT or Aliyun MQTT connected
│   ├── deviceCount        (number)
│   ├── lastMessageTs      (number)
│   └── lastError          (string)
├── account
│   ├── expiresAt
│   ├── userId
│   ├── userAccount
│   └── iotDomain
└── devices.<deviceId>
    ├── name, iotId, deviceId, deviceType, deviceTypeText
    ├── series, productSeries, productKey, productKeyGroup
    ├── recordDeviceName, status, raw
    ├── telemetry.*
    │   ├── connected, batteryPercent, bladeHeightMm
    │   ├── deviceState (number, with WORK_MODE_NAMES enum)
    │   ├── latitude, longitude
    │   ├── firmwareVersion, wifiRssi
    │   ├── totalWorkTimeSec, totalMileageM, taskAreaM2
    │   ├── lastTopic, lastPayload, lastEventId, lastProtoContent (debug)
    │   ├── lastUpdate
    │   └── areasJson
    ├── commands.*
    │   ├── start, pause, resume, stop, dock, cancelJob, cancelDock     (button)
    │   ├── applyTaskSettings, applyNonWorkHours, applyBladeControl     (button)
    │   ├── generateRoute, modifyRoute, queryRoute                      (button)
    │   ├── startZones, startAllZones, requestAreaNames                 (button)
    │   ├── targetMowSpeedMs, bladeHeightMm, bladeMaxSpeedMs            (writable)
    │   ├── routeAreaIds, routeJobMode, routeJobVersion, routeJobId     (writable)
    │   ├── routeUltraWave, routeChannelMode, routeChannelWidthCm       (writable)
    │   ├── routeTowardDeg, routeTowardIncludedAngleDeg, routeTowardMode
    │   ├── routeMowingLaps, routeBorderMode, routeObstacleLaps
    │   ├── routeCollectGrassFrequency, routeStartProgress
    │   ├── routeIsMow, routeIsDump, routeIsEdge                        (writable booleans)
    │   ├── nonWorkStart, nonWorkEnd, nonWorkSubCmd
    │   ├── bladePowerOn
    │   ├── payload, routePayloadJson (legacy alias)                    (writable JSON)
    │   ├── lastPayload, lastResult, lastError, lastTimestamp           (read-only)
    │   └── debugLast{ZoneStartJson,RoutePayload,BladePayload,StartPayload}
    └── zones.<zoneName>
        ├── enabled    (boolean writable, batch selection)
        ├── position   (number writable, 1..n execution order)
        ├── start      (boolean trigger, mow this zone only)
        └── hash       (string read-only)
```

## Command behaviour

- All `commands.*` action states are **trigger states**: writing `true` executes once and the state is reset to `false` automatically.
- `bladeHeightMm` and `targetMowSpeedMs` are auto-applied whenever you change them (debounced).
- After `commands.start` the adapter re-pushes task settings once after ~25 seconds (or earlier when a working state is detected) to make sure the device picked them up.
- Route settings (`route*`) and non-work settings auto-apply via `modifyRoute` / `applyNonWorkHours` on change (debounced).
- After every command an extra IoT sync request is fired so telemetry refreshes within seconds rather than minutes.
- Command limits (cut height, route width, lap counts, mow speed) are model-aware. Yuka uses 15–30 cm route width, Yuka Mini 8–12 cm, Luba 20–35 cm.

## Zone / area workflow

### Step 1 – discover zones

Press `commands.requestAreaNames`. The adapter asks the device for its full zone hash list. The response arrives **only via MQTT** and is decoded one hash at a time, so first-time discovery can take **60–90 seconds**.

After classification, zone objects appear under `devices.<id>.zones.<zoneName>/`:

| State | Type | Description |
|---|---|---|
| `enabled` | bool (writable) | Mark zone for batch mowing |
| `position` | number (writable) | Execution order (1..n) for `startZones` / `startAllZones` |
| `start` | bool (writable, trigger) | Immediately mow this single zone |
| `hash` | string (read-only) | Internal zone hash, filled by the device |

### Option A – single zone

Set `devices.<id>.zones.<zoneName>.start = true`. The adapter sends an immediate route command for exactly this zone, using the current global settings (`bladeHeightMm`, `targetMowSpeedMs`, …).

### Option B – batch a selection

1. Set `zones.<zoneName>.enabled = true` for each zone you want to mow.
2. Press `commands.startZones`.

The adapter aggregates all enabled zones into a single `modifyRoute` command. Order is sorted ascending by `zones.<name>.position`.

### Option C – everything we know about

Press `commands.startAllZones`. The adapter takes every zone from `telemetry.areasJson` and starts a route with all of them, ignoring the `enabled` toggles. Order again follows `position`.

### Option D – manual hash entry

Write a comma-separated list of zone hashes into `commands.routeAreaIds` and trigger any of the above buttons – useful when MQTT discovery is unavailable.

## Custom JSON payloads

Write any JSON object to `commands.payload` (or the legacy alias `commands.routePayloadJson`) for full programmatic control. Supported actions:

- Route execution: `action: "startRoute"` or `start: true`
- Route planning only: `action: "generateRoute" | "modifyRoute" | "queryRoute"`
- Task control: `action: "start" | "pause" | "resume" | "stop" | "dock" | "cancelJob" | "cancelDock"`

**Minimal example (JS adapter):**

```javascript
// Mow two specific zones with custom settings
setState('mammotion.0.devices.<deviceId>.commands.payload', JSON.stringify({
    action: 'startRoute',
    areaHashes: ['12345678901234', '98765432109876'],
    cutHeightMm: 65,
    mowSpeedMs: 0.35,
}));

// Stop via payload
setState('mammotion.0.devices.<deviceId>.commands.payload', JSON.stringify({ action: 'stop' }));
```

**All available route fields:**

```javascript
setState('mammotion.0.devices.<deviceId>.commands.payload', JSON.stringify({
    action: 'startRoute',
    areaHashes: ['12345678901234'],     // required, read from zones.<name>.hash

    // Mowing
    cutHeightMm: 65,                    // model-dependent
    mowSpeedMs: 0.35,                   // model-dependent

    // Route
    jobMode: 4,                         // default 4
    channelMode: 0,                     // 0=parallel, 1=crosscheck, 2=segment, 3=adaptive
    channelWidthCm: 25,                 // model-dependent
    towardDeg: 0,                       // -180..180
    borderMode: 1,                      // 0=off, 1=on
    mowingLaps: 1,                      // 0..4
    obstacleLaps: 1,                    // 0..3
    isMow: true,
    isEdge: false,
    isDump: true,
}));
```

The adapter persists the last executed payload to `commands.lastPayload` for traceability.

## Architecture

The adapter is a single TypeScript class (`src/main.ts`) that uses three loosely coupled cloud channels:

| Channel | Used for |
|---|---|
| **Modern Mammotion HTTP API** | Login, device list, command invocation for **owned** devices |
| **JWT MQTT** | Real-time telemetry and command responses for owner accounts |
| **Legacy/Aliyun IoT** | Shared and legacy devices: command invocation, MQTT push, REST polling fallback |

The user-facing behaviour is identical regardless of which channel is active – `info.connection` and `info.mqttConnected` reflect the current state.

Command flow at a glance:

1. The command channel builds the device-specific payload.
2. The modern endpoint is attempted first.
3. On a permission/route error the request transparently falls back to the legacy channel (this is the normal path for shared devices).
4. After every command, an additional sync request and a short fast-polling window are scheduled so telemetry catches up quickly.

Zone discovery:

1. The adapter asks the device for its full zone hash list and any directly-available names.
2. Unknown hashes are classified one at a time, respecting the device's rate limit.
3. Results are written to `zones.<sanitizedName>/`. Obsolete zones are pruned.
4. A bounded retry schedule recovers from transient MQTT flapping.

## Troubleshooting

- **`info.lastError` is your friend.** Every transport failure is mirrored there.
- **`MQTT connected.` followed by `Modern command path returned Invalid device …` repeating every ~5 s** – this used to be the most-reported pain point on shared accounts. From the `Unreleased` line onwards the adapter detects the JWT MQTT reconnect storm, suspends JWT MQTT for 30 minutes, throttles the area-name re-request and remembers legacy-only devices so the warning fires at most once per device per session.
- **Telemetry stale / `lastUpdate` not advancing** – the cloud may simply not be pushing changes. Press a command (e.g. `applyTaskSettings`) to force a fresh IoT sync.
- **Adapter and app keep logging each other out** – use the dedicated-account + share workflow described above.
- **`No devices found (neither modern nor legacy)`** – your account has no devices, the share invitation was not accepted, or the API region differs. Check `account.iotDomain`.
- **Repeated `Aliyun IoT MQTT error: connack timeout`** every ~20 s usually means your network blocks outbound TCP 1883. Test with `Test-NetConnection -ComputerName <broker-host> -Port 1883 -InformationLevel Quiet` (PowerShell) or `nc -zv <host> 1883` (Linux). If 1883 is blocked but 8883 works, enable the `aliyunMqttUseTls` instance setting and restart the adapter.
- **`Aliyun IoT MQTT error: unable to get local issuer certificate`** after enabling `aliyunMqttUseTls` means your Node.js installation cannot complete Aliyun's TLS chain (typically a missing GlobalSign intermediate on older Linux CA bundles). As a workaround, enable `aliyunMqttTlsAllowInsecure` in the instance settings — the connection stays TLS-encrypted, but the broker identity is no longer authenticated.
- **Enable verbose (`debug`) logging** in the adapter instance to see additional traces tagged `[MQTT]`, `[AREA-REQ]`, `[ZONE]`, etc.

## Known issues

- **Telemetry coverage is incomplete.** The most useful fields (battery, state, GPS, work time, mileage, area) are decoded, but several events are still being mapped. Enable `storeDebugPayloads` to capture raw payloads that help with future improvements.
- **`legacyTelemetryTransport: mqtt` is a placeholder.** Polling is the only working transport at the moment.

> **Resolved in `Unreleased`** – the previously documented log noise on shared accounts (`MQTT connected.` / `Modern command path returned Invalid device …` repeating every ~5 s) is fixed via a JWT-MQTT stability watchdog, throttled area-name re-requests and a per-session "legacy-only" device cache. See [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm install        # install deps
npm run build      # tsc -> build/main.js
npm run watch      # dev rebuild
npm run check      # tsc --noEmit
npm run lint       # eslint
npm test           # mocha + package validation
npm run dev-server # iobroker dev-server
```

CI workflows in `.github/workflows/`:

- `test-and-release.yml` – build, lint, test on Node 20/22, npm publish on tag (trusted publishing).
- `sync-product-keys.yml` – weekly check against PyMammotion `device_type.py`; opens a PR if new product keys appear.
- `automerge-dependabot.yml` – auto-merges Dependabot PRs after CI passes.

To rebuild the product-key list manually:

```bash
npm run sync:product-keys
```

## Changelog

The full change history is maintained in [CHANGELOG.md](CHANGELOG.md). The five most recent entries are also mirrored into `io-package.json#common.news` (translated, used by the ioBroker admin UI).

## License

MIT License – see [LICENSE](LICENSE).

Copyright (c) 2026 DNAngel and contributors.
