"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var mower_report_exports = {};
__export(mower_report_exports, {
  REPORT_STATE_DEFS: () => REPORT_STATE_DEFS,
  decodeDeviceEvent: () => decodeDeviceEvent,
  decodeFields: () => decodeFields,
  decodeLubaReports: () => decodeLubaReports,
  decodeReportInfoData: () => decodeReportInfoData,
  decodeSysReports: () => decodeSysReports,
  decodeSystemUpdateBuf: () => decodeSystemUpdateBuf,
  getBool: () => getBool,
  getDouble: () => getDouble,
  getFloat: () => getFloat,
  getInt32: () => getInt32,
  getInt64: () => getInt64,
  getMessage: () => getMessage,
  getMessages: () => getMessages,
  getRepeatedInt64: () => getRepeatedInt64,
  getUint32: () => getUint32,
  readVarint: () => readVarint,
  toMillis: () => toMillis
});
module.exports = __toCommonJS(mower_report_exports);
function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= BigInt(byte & 127) << shift;
    shift += 7n;
    if (!(byte & 128)) {
      return [result, pos];
    }
  }
  throw new RangeError("Truncated varint");
}
function decodeFields(buf) {
  const fields = /* @__PURE__ */ new Map();
  let pos = 0;
  try {
    while (pos < buf.length) {
      const [tag, afterTag] = readVarint(buf, pos);
      pos = afterTag;
      const fieldNumber = Number(tag >> 3n);
      const wireType = Number(tag & 7n);
      if (fieldNumber === 0) {
        break;
      }
      let value;
      if (wireType === 0) {
        [value, pos] = readVarint(buf, pos);
      } else if (wireType === 1) {
        value = buf.readBigUInt64LE(pos);
        pos += 8;
      } else if (wireType === 2) {
        const [len, afterLen] = readVarint(buf, pos);
        const end = afterLen + Number(len);
        if (end > buf.length) {
          break;
        }
        value = buf.subarray(afterLen, end);
        pos = end;
      } else if (wireType === 5) {
        value = BigInt(buf.readUInt32LE(pos));
        pos += 4;
      } else {
        break;
      }
      const list = fields.get(fieldNumber);
      if (list) {
        list.push(value);
      } else {
        fields.set(fieldNumber, [value]);
      }
    }
  } catch {
  }
  return fields;
}
function lastScalar(fields, field) {
  const values = fields.get(field);
  if (!values) {
    return void 0;
  }
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (typeof v === "bigint") {
      return v;
    }
  }
  return void 0;
}
function getInt32(fields, field) {
  const v = lastScalar(fields, field);
  return v === void 0 ? void 0 : Number(BigInt.asIntN(32, v));
}
function getUint32(fields, field) {
  const v = lastScalar(fields, field);
  return v === void 0 ? void 0 : Number(BigInt.asUintN(32, v));
}
function getInt64(fields, field) {
  const v = lastScalar(fields, field);
  return v === void 0 ? void 0 : BigInt.asIntN(64, v);
}
function getBool(fields, field) {
  const v = lastScalar(fields, field);
  return v === void 0 ? void 0 : v !== 0n;
}
function getDouble(fields, field) {
  const v = lastScalar(fields, field);
  if (v === void 0) {
    return void 0;
  }
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt.asUintN(64, v));
  return b.readDoubleLE(0);
}
function getFloat(fields, field) {
  const v = lastScalar(fields, field);
  if (v === void 0) {
    return void 0;
  }
  const b = Buffer.alloc(4);
  b.writeUInt32LE(Number(BigInt.asUintN(32, v)));
  return b.readFloatLE(0);
}
function getMessage(fields, field) {
  const values = fields.get(field);
  const buf = values == null ? void 0 : values.find((v) => v instanceof Buffer);
  return buf ? decodeFields(buf) : void 0;
}
function getMessages(fields, field) {
  var _a;
  return ((_a = fields.get(field)) != null ? _a : []).filter((v) => v instanceof Buffer).map((b) => decodeFields(b));
}
function getRepeatedInt64(fields, field) {
  var _a;
  const out = [];
  for (const v of (_a = fields.get(field)) != null ? _a : []) {
    if (typeof v === "bigint") {
      out.push(BigInt.asIntN(64, v));
      continue;
    }
    let pos = 0;
    try {
      while (pos < v.length) {
        const [n, next] = readVarint(v, pos);
        out.push(BigInt.asIntN(64, n));
        pos = next;
      }
    } catch {
    }
  }
  return out;
}
const RTK_STATUS_NAMES = {
  0: "NONE",
  1: "SINGLE",
  2: "DGPS",
  4: "FIX",
  5: "FLOAT",
  6: "UNKNOWN"
};
const POSITION_LEVEL_NAMES = {
  0: "FIX",
  1: "SINGLE",
  2: "FLOAT",
  3: "NONE",
  4: "UNKNOWN"
};
const REPORT_STATE_DEFS = [
  // Device status (report_info_data.dev)
  { id: "telemetry.chargeState", name: "Charging state (0 = not charging)", type: "number", role: "value" },
  { id: "telemetry.lastStatus", name: "Previous work state", type: "number", role: "value" },
  { id: "telemetry.sensorStatus", name: "Sensor status bit field", type: "number", role: "value" },
  { id: "telemetry.selfCheckStatus", name: "Self-check status", type: "number", role: "value" },
  { id: "telemetry.lockState", name: "Device lock state", type: "number", role: "value" },
  { id: "telemetry.headlampOn", name: "Headlamp on", type: "boolean", role: "indicator" },
  { id: "telemetry.batteryHeating", name: "Battery heating active", type: "boolean", role: "indicator" },
  // Positioning quality (report_info_data.rtk)
  { id: "telemetry.rtkStatus", name: "RTK fix status", type: "number", role: "value", states: RTK_STATUS_NAMES },
  { id: "telemetry.rtkStatusText", name: "RTK fix status (text)", type: "string", role: "text" },
  {
    id: "telemetry.positionLevel",
    name: "Position level",
    type: "number",
    role: "value",
    states: POSITION_LEVEL_NAMES
  },
  { id: "telemetry.gpsSatellites", name: "GNSS satellites (L1)", type: "number", role: "value" },
  { id: "telemetry.gpsSatellitesL2", name: "GNSS satellites (L2)", type: "number", role: "value" },
  { id: "telemetry.coViewSatellites", name: "Satellites shared with base station", type: "number", role: "value" },
  // Position on the device map (report_info_data.locations[0])
  { id: "telemetry.posX", name: "Map position x (local)", type: "number", role: "value", unit: "m" },
  { id: "telemetry.posY", name: "Map position y (local)", type: "number", role: "value", unit: "m" },
  { id: "telemetry.headingRaw", name: "Heading (raw value / 10000)", type: "number", role: "value" },
  { id: "telemetry.positionType", name: "Position type", type: "number", role: "value" },
  { id: "telemetry.currentZoneHash", name: "Hash of the zone the mower is in", type: "string", role: "text" },
  { id: "telemetry.mapHash", name: "Map checksum (changes when the map changes)", type: "string", role: "text" },
  // Current job (report_info_data.work)
  { id: "telemetry.mowProgressPct", name: "Job progress", type: "number", role: "value", unit: "%" },
  { id: "telemetry.mowedArea", name: "Area mowed in current job", type: "number", role: "value", unit: "m\xB2" },
  { id: "telemetry.jobTotalMin", name: "Job total time (unverified)", type: "number", role: "value", unit: "min" },
  {
    id: "telemetry.jobRemainingMin",
    name: "Job remaining time (unverified)",
    type: "number",
    role: "value",
    unit: "min"
  },
  { id: "telemetry.jobProgressRaw", name: "Job progress raw value", type: "number", role: "value" },
  {
    id: "telemetry.jobKnifeHeightMm",
    name: "Cutting height of current job",
    type: "number",
    role: "value",
    unit: "mm"
  },
  { id: "telemetry.jobBreakpointReason", name: "Reason the job was interrupted", type: "number", role: "value" },
  { id: "telemetry.navRunMode", name: "Navigation run mode", type: "number", role: "value" },
  // Connectivity (report_info_data.connect)
  { id: "telemetry.connectType", name: "Connection type", type: "number", role: "value" },
  { id: "telemetry.bleRssi", name: "Bluetooth RSSI", type: "number", role: "value", unit: "dBm" },
  { id: "telemetry.mobileRssi", name: "Mobile network RSSI", type: "number", role: "value", unit: "dBm" },
  // Maintenance (report_info_data.maintain)
  { id: "maintenance.mileageM", name: "Total mileage", type: "number", role: "value", unit: "m" },
  { id: "maintenance.workTimeSec", name: "Total work time", type: "number", role: "value", unit: "s" },
  { id: "maintenance.batteryCycles", name: "Battery charge cycles", type: "number", role: "value" },
  {
    id: "maintenance.bladeUsedHours",
    name: "Blade usage since last reset",
    type: "number",
    role: "value",
    unit: "h"
  },
  {
    id: "maintenance.bladeWarnHours",
    name: "Blade replacement warning threshold",
    type: "number",
    role: "value",
    unit: "h"
  },
  // RTK base station (report_info_data.basestation_info)
  { id: "basestation.version", name: "Base station firmware", type: "string", role: "text" },
  { id: "basestation.status", name: "Base station status", type: "number", role: "value" },
  // Errors (systemUpdateBuf type 2 and warning events)
  { id: "errors.code", name: "Most recent error code (0 = none)", type: "number", role: "value" },
  { id: "errors.time", name: "Time of the most recent error", type: "number", role: "value.time" },
  { id: "errors.listJson", name: "Recent errors (JSON, newest first)", type: "string", role: "json" },
  { id: "errors.lastWarningCode", name: "Last warning event code", type: "number", role: "value" },
  { id: "errors.lastWarningTime", name: "Time of the last warning event", type: "number", role: "value.time" },
  { id: "errors.lastNotificationCode", name: "Last notification event code", type: "string", role: "text" },
  { id: "errors.lastNotificationType", name: "Last notification event type", type: "string", role: "text" },
  {
    id: "errors.lastNotificationTime",
    name: "Time of the last notification event",
    type: "number",
    role: "value.time"
  },
  // Map anchor (systemUpdateBuf type 1)
  {
    id: "map.baseLatitude",
    name: "RTK base latitude (map origin)",
    type: "number",
    role: "value.gps.latitude",
    unit: "\xB0"
  },
  {
    id: "map.baseLongitude",
    name: "RTK base longitude (map origin)",
    type: "number",
    role: "value.gps.longitude",
    unit: "\xB0"
  },
  { id: "map.baseYawDeg", name: "Rotation of the map axes", type: "number", role: "value", unit: "\xB0" },
  { id: "map.dockX", name: "Charging station x (local)", type: "number", role: "value", unit: "m" },
  { id: "map.dockY", name: "Charging station y (local)", type: "number", role: "value", unit: "m" },
  { id: "map.dockHeadingRaw", name: "Charging station heading (raw)", type: "number", role: "value" }
];
const SYS_FIELD_REPORT_DATA = 39;
const SYS_FIELD_UPDATE_BUF = 27;
const RAD_TO_DEG = 180 / Math.PI;
function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
function push(out, id, value) {
  if (value === void 0 || typeof value === "number" && !Number.isFinite(value)) {
    return;
  }
  out.push({ id, value });
}
function int32(fields, field) {
  var _a;
  return (_a = getInt32(fields, field)) != null ? _a : 0;
}
function hashString(value) {
  return value === void 0 || value === 0n ? "" : BigInt.asUintN(64, value).toString();
}
function decodeDev(dev, out) {
  var _a, _b;
  const sysStatus = getInt32(dev, 1);
  if (sysStatus !== void 0 && sysStatus > 0) {
    push(out, "telemetry.deviceState", sysStatus);
  }
  const battery = getInt32(dev, 3);
  if (battery !== void 0 && battery > 0 && battery <= 100) {
    push(out, "telemetry.batteryPercent", battery);
  }
  push(out, "telemetry.chargeState", int32(dev, 2));
  push(out, "telemetry.sensorStatus", int32(dev, 4));
  push(out, "telemetry.lastStatus", int32(dev, 5));
  push(out, "telemetry.selfCheckStatus", (_a = getUint32(dev, 12)) != null ? _a : 0);
  push(out, "telemetry.batteryHeating", int32(dev, 14) !== 0);
  push(out, "telemetry.headlampOn", int32(dev, 15) !== 0);
  const lock = getMessage(dev, 11);
  if (lock) {
    push(out, "telemetry.lockState", (_b = getUint32(lock, 1)) != null ? _b : 0);
  }
}
function decodeRtk(rtk, out) {
  var _a;
  const status = int32(rtk, 1);
  push(out, "telemetry.rtkStatus", status);
  push(out, "telemetry.rtkStatusText", (_a = RTK_STATUS_NAMES[status]) != null ? _a : `STATUS_${status}`);
  push(out, "telemetry.positionLevel", int32(rtk, 2));
  push(out, "telemetry.gpsSatellites", int32(rtk, 3));
  push(out, "telemetry.gpsSatellitesL2", int32(rtk, 7));
  push(out, "telemetry.coViewSatellites", int32(rtk, 10));
}
function decodeLocation(loc, out) {
  push(out, "telemetry.posX", round(int32(loc, 1) / 1e4, 3));
  push(out, "telemetry.posY", round(int32(loc, 2) / 1e4, 3));
  push(out, "telemetry.headingRaw", round(int32(loc, 3) / 1e4, 4));
  push(out, "telemetry.positionType", int32(loc, 4));
  push(out, "telemetry.currentZoneHash", hashString(getInt64(loc, 5)));
  const mapHash = hashString(getInt64(loc, 6));
  if (mapHash) {
    push(out, "telemetry.mapHash", mapHash);
  }
}
function decodeWork(work, out) {
  var _a, _b;
  const area = (_a = getUint32(work, 4)) != null ? _a : 0;
  push(out, "telemetry.mowProgressPct", Math.min(100, area >>> 16));
  push(out, "telemetry.mowedArea", area & 65535);
  const progress = (_b = getUint32(work, 3)) != null ? _b : 0;
  push(out, "telemetry.jobProgressRaw", progress);
  push(out, "telemetry.jobTotalMin", progress & 65535);
  push(out, "telemetry.jobRemainingMin", progress >>> 16);
  push(out, "telemetry.jobBreakpointReason", int32(work, 5));
  push(out, "telemetry.navRunMode", int32(work, 16));
  const knife = int32(work, 20);
  if (knife > 0) {
    push(out, "telemetry.jobKnifeHeightMm", knife);
  }
}
function decodeConnect(connect, out) {
  push(out, "telemetry.connectType", int32(connect, 1));
  const ble = int32(connect, 2);
  if (ble !== 0) {
    push(out, "telemetry.bleRssi", ble);
  }
  const wifi = int32(connect, 3);
  if (wifi !== 0) {
    push(out, "telemetry.wifiRssi", wifi);
  }
  const mobile = int32(connect, 5);
  if (mobile !== 0) {
    push(out, "telemetry.mobileRssi", mobile);
  }
}
function decodeMaintain(m, out) {
  const mileage = getInt64(m, 1);
  if (mileage !== void 0 && mileage > 0n) {
    push(out, "maintenance.mileageM", Number(mileage));
  }
  const workTime = int32(m, 2);
  if (workTime > 0) {
    push(out, "maintenance.workTimeSec", workTime);
  }
  push(out, "maintenance.batteryCycles", int32(m, 3));
  const blade = getMessage(m, 4);
  if (blade) {
    push(out, "maintenance.bladeUsedHours", round(int32(blade, 1) / 3600, 1));
    const warn = int32(blade, 2);
    if (warn > 0) {
      push(out, "maintenance.bladeWarnHours", round(warn / 3600, 1));
    }
  }
}
function decodeBasestation(b, out) {
  var _a, _b, _c, _d, _e;
  const major = (_a = getUint32(b, 1)) != null ? _a : 0;
  const minor = (_b = getUint32(b, 2)) != null ? _b : 0;
  const patch = (_c = getUint32(b, 3)) != null ? _c : 0;
  const build = (_d = getUint32(b, 4)) != null ? _d : 0;
  if (major || minor || patch || build) {
    push(out, "basestation.version", `${major}.${minor}.${patch}.${build}`);
  }
  push(out, "basestation.status", (_e = getUint32(b, 5)) != null ? _e : 0);
}
function decodeReportInfoData(report) {
  const out = [];
  const connect = getMessage(report, 1);
  if (connect) {
    decodeConnect(connect, out);
  }
  const dev = getMessage(report, 2);
  if (dev) {
    decodeDev(dev, out);
  }
  const rtk = getMessage(report, 3);
  if (rtk) {
    decodeRtk(rtk, out);
  }
  const [firstLocation] = getMessages(report, 4);
  if (firstLocation) {
    decodeLocation(firstLocation, out);
  }
  const work = getMessage(report, 5);
  if (work) {
    decodeWork(work, out);
  }
  const maintain = getMessage(report, 7);
  if (maintain) {
    decodeMaintain(maintain, out);
  }
  const base = getMessage(report, 11);
  if (base) {
    decodeBasestation(base, out);
  }
  const mqttRtk = rtk ? getMessage(rtk, 13) : void 0;
  if (mqttRtk) {
    const lat = getDouble(mqttRtk, 4);
    const lon = getDouble(mqttRtk, 5);
    if (lat !== void 0 && lon !== void 0 && lat !== 0 && lon !== 0 && lat !== -1 && lon !== -1) {
      push(out, "map.baseLatitude", round(lat, 8));
      push(out, "map.baseLongitude", round(lon, 8));
    }
  }
  return out;
}
function decodeSystemUpdateBuf(data) {
  var _a, _b, _c, _d;
  const out = [];
  const at = (i) => {
    var _a2;
    return (_a2 = data[i]) != null ? _a2 : 0n;
  };
  const kind = Number(at(0));
  if (kind === 1) {
    if (at(5) !== 0n) {
      push(out, "map.baseLatitude", round(Number(at(5)) / 1e8 * RAD_TO_DEG, 8));
      push(out, "map.baseLongitude", round(Number(at(6)) / 1e8 * RAD_TO_DEG, 8));
      if (data.length > 13) {
        push(out, "map.baseYawDeg", round(Number(at(13)) / 1e8 * RAD_TO_DEG, 3));
      }
    }
    if (at(7) !== 0n) {
      push(out, "map.dockX", round(Number(at(7)) / 1e4, 3));
      push(out, "map.dockY", round(Number(at(8)) / 1e4, 3));
      push(out, "map.dockHeadingRaw", Number(at(3)));
    }
  } else if (kind === 2) {
    const errors = [];
    for (let i = 3; i <= 21; i += 2) {
      const code = Math.abs(Number(at(i)));
      if (code === 0) {
        continue;
      }
      errors.push({ code, time: toMillis(Number(at(i + 1))) });
    }
    push(out, "errors.code", (_b = (_a = errors[0]) == null ? void 0 : _a.code) != null ? _b : 0);
    push(out, "errors.time", (_d = (_c = errors[0]) == null ? void 0 : _c.time) != null ? _d : 0);
    push(out, "errors.listJson", JSON.stringify(errors));
  }
  return out;
}
function toMillis(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value < 1e11 ? value * 1e3 : value;
}
function decodeSysReports(sys) {
  const out = [];
  for (const report of getMessages(sys, SYS_FIELD_REPORT_DATA)) {
    out.push(...decodeReportInfoData(report));
  }
  const update = getMessage(sys, SYS_FIELD_UPDATE_BUF);
  if (update) {
    out.push(...decodeSystemUpdateBuf(getRepeatedInt64(update, 1)));
  }
  return out;
}
function decodeLubaReports(protoBase64) {
  const luba = decodeFields(Buffer.from(protoBase64, "base64"));
  const out = [];
  for (const sys of getMessages(luba, 10)) {
    out.push(...decodeSysReports(sys));
  }
  return out;
}
function parseJsonObject(value) {
  if (value && typeof value === "object") {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : void 0;
    } catch {
      return void 0;
    }
  }
  return void 0;
}
const NOTIFICATION_EVENTS = /* @__PURE__ */ new Set([
  "device_notification_event",
  "device_warning_code_event",
  "device_information_event"
]);
function decodeDeviceEvent(params, now) {
  const identifier = typeof (params == null ? void 0 : params.identifier) === "string" ? params.identifier : "";
  const value = parseJsonObject(params == null ? void 0 : params.value);
  if (identifier === "device_warning_event") {
    const code = Number(value == null ? void 0 : value.code);
    if (!Number.isFinite(code)) {
      return null;
    }
    return [
      { id: "errors.lastWarningCode", value: Math.abs(code) },
      { id: "errors.lastWarningTime", value: now }
    ];
  }
  if (NOTIFICATION_EVENTS.has(identifier)) {
    const data = parseJsonObject(value == null ? void 0 : value.data);
    const code = data == null ? void 0 : data.code;
    if (code === void 0 || code === null || code === "") {
      return null;
    }
    const localTime = toMillis(Number(data == null ? void 0 : data.localTime));
    return [
      {
        id: "errors.lastNotificationCode",
        value: typeof code === "object" ? JSON.stringify(code) : String(code)
      },
      { id: "errors.lastNotificationType", value: identifier },
      { id: "errors.lastNotificationTime", value: localTime || now }
    ];
  }
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  REPORT_STATE_DEFS,
  decodeDeviceEvent,
  decodeFields,
  decodeLubaReports,
  decodeReportInfoData,
  decodeSysReports,
  decodeSystemUpdateBuf,
  getBool,
  getDouble,
  getFloat,
  getInt32,
  getInt64,
  getMessage,
  getMessages,
  getRepeatedInt64,
  getUint32,
  readVarint,
  toMillis
});
//# sourceMappingURL=mower-report.js.map
