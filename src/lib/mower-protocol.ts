/**
 * Mower protocol helpers (pure functions, unit-tested):
 *
 * - status report (`MctlSys.toapp_report_data`, sys field 39), system update
 *   buffer (`MctlSys.systemUpdateBuf`, sys field 27) and the JSON
 *   warning/notification events → flat ioBroker state updates;
 * - map geometry (hash list nav 31, element data nav 33) → GeoJSON.
 *
 * Field numbers follow the public mctrl_sys message layout (facts only, no
 * third-party code). State ids are relative to `devices.<deviceKey>`.
 */

// --- protobuf wire-format reader -------------------------------------------
// Hand-written on purpose (no protobufjs, see CLAUDE.md). Supports the wire
// types the device uses: varint (0), fixed64 (1), length-delimited (2), fixed32 (5).

export type ProtoValue = Buffer | bigint;
export type ProtoFields = Map<number, ProtoValue[]>;

/**
 * Reads one varint starting at `pos`. Returns the value and the next position.
 *
 * @param buf
 * @param pos
 */
export function readVarint(buf: Buffer, pos: number): [bigint, number] {
    let result = 0n;
    let shift = 0n;
    while (pos < buf.length) {
        const byte = buf[pos++];
        result |= BigInt(byte & 0x7f) << shift;
        shift += 7n;
        if (!(byte & 0x80)) {
            return [result, pos];
        }
    }
    throw new RangeError('Truncated varint');
}

/**
 * Splits a message into its fields. Repeated fields keep their order.
 * Stops at the first malformed field and returns what was read so far.
 *
 * @param buf
 */
export function decodeFields(buf: Buffer): ProtoFields {
    const fields: ProtoFields = new Map();
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
            let value: ProtoValue;
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
        // Malformed tail: keep what was decoded.
    }
    return fields;
}

function lastScalar(fields: ProtoFields, field: number): bigint | undefined {
    const values = fields.get(field);
    if (!values) {
        return undefined;
    }
    for (let i = values.length - 1; i >= 0; i--) {
        const v = values[i];
        if (typeof v === 'bigint') {
            return v;
        }
    }
    return undefined;
}

/**
 * int32/enum field. Negative int32 values arrive as 10-byte varints.
 *
 * @param fields
 * @param field
 */
export function getInt32(fields: ProtoFields, field: number): number | undefined {
    const v = lastScalar(fields, field);
    return v === undefined ? undefined : Number(BigInt.asIntN(32, v));
}

/**
 * uint32 field.
 *
 * @param fields
 * @param field
 */
export function getUint32(fields: ProtoFields, field: number): number | undefined {
    const v = lastScalar(fields, field);
    return v === undefined ? undefined : Number(BigInt.asUintN(32, v));
}

/**
 * int64 field as signed bigint (hashes, timestamps).
 *
 * @param fields
 * @param field
 */
export function getInt64(fields: ProtoFields, field: number): bigint | undefined {
    const v = lastScalar(fields, field);
    return v === undefined ? undefined : BigInt.asIntN(64, v);
}

/**
 * bool field.
 *
 * @param fields
 * @param field
 */
export function getBool(fields: ProtoFields, field: number): boolean | undefined {
    const v = lastScalar(fields, field);
    return v === undefined ? undefined : v !== 0n;
}

/**
 * double field (wire type 1).
 *
 * @param fields
 * @param field
 */
export function getDouble(fields: ProtoFields, field: number): number | undefined {
    const v = lastScalar(fields, field);
    if (v === undefined) {
        return undefined;
    }
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt.asUintN(64, v));
    return b.readDoubleLE(0);
}

/**
 * float field (wire type 5).
 *
 * @param fields
 * @param field
 */
export function getFloat(fields: ProtoFields, field: number): number | undefined {
    const v = lastScalar(fields, field);
    if (v === undefined) {
        return undefined;
    }
    const b = Buffer.alloc(4);
    b.writeUInt32LE(Number(BigInt.asUintN(32, v)));
    return b.readFloatLE(0);
}

/**
 * First embedded message of a field, already split into fields.
 *
 * @param fields
 * @param field
 */
export function getMessage(fields: ProtoFields, field: number): ProtoFields | undefined {
    const values = fields.get(field);
    const buf = values?.find((v): v is Buffer => v instanceof Buffer);
    return buf ? decodeFields(buf) : undefined;
}

/**
 * All embedded messages of a repeated message field.
 *
 * @param fields
 * @param field
 */
export function getMessages(fields: ProtoFields, field: number): ProtoFields[] {
    return (fields.get(field) ?? []).filter((v): v is Buffer => v instanceof Buffer).map(b => decodeFields(b));
}

/**
 * Repeated varint field (int32/int64/enum). Accepts both encodings: packed
 * (one length-delimited blob) and unpacked (one varint per element).
 * Values are returned as signed 64-bit bigints.
 *
 * @param fields
 * @param field
 */
export function getRepeatedInt64(fields: ProtoFields, field: number): bigint[] {
    const out: bigint[] = [];
    for (const v of fields.get(field) ?? []) {
        if (typeof v === 'bigint') {
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
            // Truncated packed list: keep the complete elements.
        }
    }
    return out;
}

// --- report decoding ----------------------------------------------------------

export type StateValue = number | string | boolean;

export interface StateUpdate {
    /** Relative to `devices.<deviceKey>`, e.g. `telemetry.chargeState`. */
    id: string;
    value: StateValue;
}

export interface ReportStateDef {
    id: string;
    name: string;
    type: 'number' | 'string' | 'boolean';
    role: string;
    unit?: string;
    states?: Record<number, string>;
}

const RTK_STATUS_NAMES: Record<number, string> = {
    0: 'NONE',
    1: 'SINGLE',
    2: 'DGPS',
    4: 'FIX',
    5: 'FLOAT',
    6: 'UNKNOWN',
};

const POSITION_LEVEL_NAMES: Record<number, string> = {
    0: 'FIX',
    1: 'SINGLE',
    2: 'FLOAT',
    3: 'NONE',
    4: 'UNKNOWN',
};

/**
 * All states this module can write. The adapter creates them up front so the
 * object tree is stable even before the first report arrives.
 */
export const REPORT_STATE_DEFS: ReportStateDef[] = [
    // Device status (report_info_data.dev)
    { id: 'telemetry.chargeState', name: 'Charging state (0 = not charging)', type: 'number', role: 'value' },
    { id: 'telemetry.lastStatus', name: 'Previous work state', type: 'number', role: 'value' },
    { id: 'telemetry.sensorStatus', name: 'Sensor status bit field', type: 'number', role: 'value' },
    { id: 'telemetry.selfCheckStatus', name: 'Self-check status', type: 'number', role: 'value' },
    { id: 'telemetry.lockState', name: 'Device lock state', type: 'number', role: 'value' },
    { id: 'telemetry.headlampOn', name: 'Headlamp on', type: 'boolean', role: 'indicator' },
    { id: 'telemetry.batteryHeating', name: 'Battery heating active', type: 'boolean', role: 'indicator' },
    // Positioning quality (report_info_data.rtk)
    { id: 'telemetry.rtkStatus', name: 'RTK fix status', type: 'number', role: 'value', states: RTK_STATUS_NAMES },
    { id: 'telemetry.rtkStatusText', name: 'RTK fix status (text)', type: 'string', role: 'text' },
    {
        id: 'telemetry.positionLevel',
        name: 'Position level',
        type: 'number',
        role: 'value',
        states: POSITION_LEVEL_NAMES,
    },
    { id: 'telemetry.gpsSatellites', name: 'GNSS satellites (L1)', type: 'number', role: 'value' },
    { id: 'telemetry.gpsSatellitesL2', name: 'GNSS satellites (L2)', type: 'number', role: 'value' },
    { id: 'telemetry.coViewSatellites', name: 'Satellites shared with base station', type: 'number', role: 'value' },
    // Position on the device map (report_info_data.locations[0])
    { id: 'telemetry.posX', name: 'Map position x (local)', type: 'number', role: 'value', unit: 'm' },
    { id: 'telemetry.posY', name: 'Map position y (local)', type: 'number', role: 'value', unit: 'm' },
    { id: 'telemetry.headingRaw', name: 'Heading (raw value / 10000)', type: 'number', role: 'value' },
    { id: 'telemetry.positionType', name: 'Position type', type: 'number', role: 'value' },
    { id: 'telemetry.currentZoneHash', name: 'Hash of the zone the mower is in', type: 'string', role: 'text' },
    { id: 'telemetry.mapHash', name: 'Map checksum (changes when the map changes)', type: 'string', role: 'text' },
    // Current job (report_info_data.work)
    { id: 'telemetry.mowProgressPct', name: 'Job progress', type: 'number', role: 'value', unit: '%' },
    { id: 'telemetry.mowedArea', name: 'Area mowed in current job', type: 'number', role: 'value', unit: 'm²' },
    { id: 'telemetry.jobTotalMin', name: 'Job total time (unverified)', type: 'number', role: 'value', unit: 'min' },
    {
        id: 'telemetry.jobRemainingMin',
        name: 'Job remaining time (unverified)',
        type: 'number',
        role: 'value',
        unit: 'min',
    },
    { id: 'telemetry.jobProgressRaw', name: 'Job progress raw value', type: 'number', role: 'value' },
    {
        id: 'telemetry.jobKnifeHeightMm',
        name: 'Cutting height of current job',
        type: 'number',
        role: 'value',
        unit: 'mm',
    },
    { id: 'telemetry.jobBreakpointReason', name: 'Reason the job was interrupted', type: 'number', role: 'value' },
    { id: 'telemetry.navRunMode', name: 'Navigation run mode', type: 'number', role: 'value' },
    // Connectivity (report_info_data.connect)
    { id: 'telemetry.connectType', name: 'Connection type', type: 'number', role: 'value' },
    { id: 'telemetry.bleRssi', name: 'Bluetooth RSSI', type: 'number', role: 'value', unit: 'dBm' },
    { id: 'telemetry.mobileRssi', name: 'Mobile network RSSI', type: 'number', role: 'value', unit: 'dBm' },
    // Maintenance (report_info_data.maintain)
    { id: 'maintenance.mileageM', name: 'Total mileage', type: 'number', role: 'value', unit: 'm' },
    { id: 'maintenance.workTimeSec', name: 'Total work time', type: 'number', role: 'value', unit: 's' },
    { id: 'maintenance.batteryCycles', name: 'Battery charge cycles', type: 'number', role: 'value' },
    {
        id: 'maintenance.bladeUsedHours',
        name: 'Blade usage since last reset',
        type: 'number',
        role: 'value',
        unit: 'h',
    },
    {
        id: 'maintenance.bladeWarnHours',
        name: 'Blade replacement warning threshold',
        type: 'number',
        role: 'value',
        unit: 'h',
    },
    // RTK base station (report_info_data.basestation_info)
    { id: 'basestation.version', name: 'Base station firmware', type: 'string', role: 'text' },
    { id: 'basestation.status', name: 'Base station status', type: 'number', role: 'value' },
    // Errors (systemUpdateBuf type 2 and warning events)
    { id: 'errors.code', name: 'Most recent error code (0 = none)', type: 'number', role: 'value' },
    { id: 'errors.time', name: 'Time of the most recent error', type: 'number', role: 'value.time' },
    { id: 'errors.listJson', name: 'Recent errors (JSON, newest first)', type: 'string', role: 'json' },
    { id: 'errors.lastWarningCode', name: 'Last warning event code', type: 'number', role: 'value' },
    { id: 'errors.lastWarningTime', name: 'Time of the last warning event', type: 'number', role: 'value.time' },
    { id: 'errors.lastNotificationCode', name: 'Last notification event code', type: 'string', role: 'text' },
    { id: 'errors.lastNotificationType', name: 'Last notification event type', type: 'string', role: 'text' },
    {
        id: 'errors.lastNotificationTime',
        name: 'Time of the last notification event',
        type: 'number',
        role: 'value.time',
    },
    // Map anchor (systemUpdateBuf type 1)
    {
        id: 'map.baseLatitude',
        name: 'RTK base latitude (map origin)',
        type: 'number',
        role: 'value.gps.latitude',
        unit: '°',
    },
    {
        id: 'map.baseLongitude',
        name: 'RTK base longitude (map origin)',
        type: 'number',
        role: 'value.gps.longitude',
        unit: '°',
    },
    { id: 'map.baseYawDeg', name: 'Rotation of the map axes', type: 'number', role: 'value', unit: '°' },
    { id: 'map.dockX', name: 'Charging station x (local)', type: 'number', role: 'value', unit: 'm' },
    { id: 'map.dockY', name: 'Charging station y (local)', type: 'number', role: 'value', unit: 'm' },
    { id: 'map.dockHeadingRaw', name: 'Charging station heading (raw)', type: 'number', role: 'value' },
    // Map geometry (filled by commands.requestMap)
    {
        id: 'map.geojson',
        name: 'Map as GeoJSON (zones, obstacles, no-go areas, paths, dock)',
        type: 'string',
        role: 'json',
    },
    { id: 'map.updatedAt', name: 'Time the map was last loaded', type: 'number', role: 'value.time' },
    { id: 'map.elementCount', name: 'Number of map elements loaded', type: 'number', role: 'value' },
    {
        id: 'map.anchorSource',
        name: 'Source of the map origin (basestation / robot / none)',
        type: 'string',
        role: 'text',
    },
    { id: 'map.status', name: 'Map loading status', type: 'string', role: 'text' },
    { id: 'map.loadedMapHash', name: 'Map checksum of the loaded map', type: 'string', role: 'text' },
    {
        id: 'map.progressJson',
        name: 'Unfinished map load (internal, resumes after restart)',
        type: 'string',
        role: 'json',
    },
    // Cloud send quota (Aliyun invoke answer; Aliyun-era mowers)
    { id: 'cloud.msgSurplus', name: 'Cloud messages left (iotMsgSurplus)', type: 'number', role: 'value' },
    { id: 'cloud.msgTotal', name: 'Cloud message allowance (iotMsgTotal)', type: 'number', role: 'value' },
    {
        id: 'cloud.msgResetInSec',
        name: 'Seconds until the allowance resets (iotMsgTotalCD)',
        type: 'number',
        role: 'value',
        unit: 's',
    },
    { id: 'cloud.quotaJson', name: 'All quota fields of the last cloud answer', type: 'string', role: 'json' },
    { id: 'cloud.lastRateLimitAt', name: 'Time of the last 429 answer', type: 'number', role: 'value.time' },
    {
        id: 'cloud.lastRateLimitReason',
        name: 'Reason of the last 429 answer (API gateway headers)',
        type: 'string',
        role: 'text',
    },
];

const SYS_FIELD_REPORT_DATA = 39;
const SYS_FIELD_UPDATE_BUF = 27;

const RAD_TO_DEG = 180 / Math.PI;

function round(value: number, digits: number): number {
    const f = 10 ** digits;
    return Math.round(value * f) / f;
}

function push(out: StateUpdate[], id: string, value: StateValue | undefined): void {
    if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
        return;
    }
    out.push({ id, value });
}

/**
 * proto3 omits zero values: inside a present sub-message a missing scalar is 0.
 *
 * @param fields
 * @param field
 */
function int32(fields: ProtoFields, field: number): number {
    return getInt32(fields, field) ?? 0;
}

function hashString(value: bigint | undefined): string {
    return value === undefined || value === 0n ? '' : BigInt.asUintN(64, value).toString();
}

function decodeDev(dev: ProtoFields, out: StateUpdate[]): void {
    const sysStatus = getInt32(dev, 1);
    if (sysStatus !== undefined && sysStatus > 0) {
        push(out, 'telemetry.deviceState', sysStatus);
    }
    const battery = getInt32(dev, 3);
    if (battery !== undefined && battery > 0 && battery <= 100) {
        push(out, 'telemetry.batteryPercent', battery);
    }
    push(out, 'telemetry.chargeState', int32(dev, 2));
    push(out, 'telemetry.sensorStatus', int32(dev, 4));
    push(out, 'telemetry.lastStatus', int32(dev, 5));
    push(out, 'telemetry.selfCheckStatus', getUint32(dev, 12) ?? 0);
    push(out, 'telemetry.batteryHeating', int32(dev, 14) !== 0);
    push(out, 'telemetry.headlampOn', int32(dev, 15) !== 0);
    const lock = getMessage(dev, 11);
    if (lock) {
        push(out, 'telemetry.lockState', getUint32(lock, 1) ?? 0);
    }
}

function decodeRtk(rtk: ProtoFields, out: StateUpdate[]): void {
    const status = int32(rtk, 1);
    push(out, 'telemetry.rtkStatus', status);
    push(out, 'telemetry.rtkStatusText', RTK_STATUS_NAMES[status] ?? `STATUS_${status}`);
    push(out, 'telemetry.positionLevel', int32(rtk, 2));
    push(out, 'telemetry.gpsSatellites', int32(rtk, 3));
    push(out, 'telemetry.gpsSatellitesL2', int32(rtk, 7));
    push(out, 'telemetry.coViewSatellites', int32(rtk, 10));
}

function decodeLocation(loc: ProtoFields, out: StateUpdate[]): void {
    push(out, 'telemetry.posX', round(int32(loc, 1) / 10_000, 3));
    push(out, 'telemetry.posY', round(int32(loc, 2) / 10_000, 3));
    push(out, 'telemetry.headingRaw', round(int32(loc, 3) / 10_000, 4));
    push(out, 'telemetry.positionType', int32(loc, 4));
    push(out, 'telemetry.currentZoneHash', hashString(getInt64(loc, 5)));
    const mapHash = hashString(getInt64(loc, 6));
    if (mapHash) {
        push(out, 'telemetry.mapHash', mapHash);
    }
}

function decodeWork(work: ProtoFields, out: StateUpdate[]): void {
    // `area`: upper 16 bits = completion %, lower 16 bits = mowed area.
    const area = getUint32(work, 4) ?? 0;
    push(out, 'telemetry.mowProgressPct', Math.min(100, area >>> 16));
    push(out, 'telemetry.mowedArea', area & 0xffff);
    // `progress`: lower 16 bits = total minutes, upper 16 bits = remaining minutes.
    // Interpretation not verified on a live device yet (see CHANGELOG).
    const progress = getUint32(work, 3) ?? 0;
    push(out, 'telemetry.jobProgressRaw', progress);
    push(out, 'telemetry.jobTotalMin', progress & 0xffff);
    push(out, 'telemetry.jobRemainingMin', progress >>> 16);
    push(out, 'telemetry.jobBreakpointReason', int32(work, 5));
    push(out, 'telemetry.navRunMode', int32(work, 16));
    const knife = int32(work, 20);
    if (knife > 0) {
        push(out, 'telemetry.jobKnifeHeightMm', knife);
    }
}

function decodeConnect(connect: ProtoFields, out: StateUpdate[]): void {
    push(out, 'telemetry.connectType', int32(connect, 1));
    const ble = int32(connect, 2);
    if (ble !== 0) {
        push(out, 'telemetry.bleRssi', ble);
    }
    const wifi = int32(connect, 3);
    if (wifi !== 0) {
        push(out, 'telemetry.wifiRssi', wifi);
    }
    const mobile = int32(connect, 5);
    if (mobile !== 0) {
        push(out, 'telemetry.mobileRssi', mobile);
    }
}

function decodeMaintain(m: ProtoFields, out: StateUpdate[]): void {
    const mileage = getInt64(m, 1);
    if (mileage !== undefined && mileage > 0n) {
        push(out, 'maintenance.mileageM', Number(mileage));
    }
    const workTime = int32(m, 2);
    if (workTime > 0) {
        push(out, 'maintenance.workTimeSec', workTime);
    }
    push(out, 'maintenance.batteryCycles', int32(m, 3));
    const blade = getMessage(m, 4);
    if (blade) {
        push(out, 'maintenance.bladeUsedHours', round(int32(blade, 1) / 3600, 1));
        const warn = int32(blade, 2);
        if (warn > 0) {
            push(out, 'maintenance.bladeWarnHours', round(warn / 3600, 1));
        }
    }
}

function decodeBasestation(b: ProtoFields, out: StateUpdate[]): void {
    const major = getUint32(b, 1) ?? 0;
    const minor = getUint32(b, 2) ?? 0;
    const patch = getUint32(b, 3) ?? 0;
    const build = getUint32(b, 4) ?? 0;
    if (major || minor || patch || build) {
        push(out, 'basestation.version', `${major}.${minor}.${patch}.${build}`);
    }
    push(out, 'basestation.status', getUint32(b, 5) ?? 0);
}

/**
 * Decodes `report_info_data` (the payload of sys field 39).
 *
 * @param report
 */
export function decodeReportInfoData(report: ProtoFields): StateUpdate[] {
    const out: StateUpdate[] = [];
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
    // Vision / NetRTK models without a base station report their anchor here.
    const mqttRtk = rtk ? getMessage(rtk, 13) : undefined;
    if (mqttRtk) {
        const lat = getDouble(mqttRtk, 4);
        const lon = getDouble(mqttRtk, 5);
        if (lat !== undefined && lon !== undefined && lat !== 0 && lon !== 0 && lat !== -1 && lon !== -1) {
            push(out, 'map.baseLatitude', round(lat, 8));
            push(out, 'map.baseLongitude', round(lon, 8));
        }
    }
    return out;
}

export interface DeviceError {
    code: number;
    /** Unix milliseconds, 0 when unknown. */
    time: number;
}

/**
 * Decodes the `update_buf_data` list of sys field 27.
 * Type 1 carries the map anchor, type 2 the ten most recent errors.
 *
 * @param data
 */
export function decodeSystemUpdateBuf(data: bigint[]): StateUpdate[] {
    const out: StateUpdate[] = [];
    const at = (i: number): bigint => data[i] ?? 0n;
    const kind = Number(at(0));
    if (kind === 1) {
        if (at(5) !== 0n) {
            push(out, 'map.baseLatitude', round((Number(at(5)) / 1e8) * RAD_TO_DEG, 8));
            push(out, 'map.baseLongitude', round((Number(at(6)) / 1e8) * RAD_TO_DEG, 8));
            if (data.length > 13) {
                push(out, 'map.baseYawDeg', round((Number(at(13)) / 1e8) * RAD_TO_DEG, 3));
            }
        }
        if (at(7) !== 0n) {
            push(out, 'map.dockX', round(Number(at(7)) / 1e4, 3));
            push(out, 'map.dockY', round(Number(at(8)) / 1e4, 3));
            push(out, 'map.dockHeadingRaw', Number(at(3)));
        }
    } else if (kind === 2) {
        const errors: DeviceError[] = [];
        for (let i = 3; i <= 21; i += 2) {
            const code = Math.abs(Number(at(i)));
            if (code === 0) {
                continue;
            }
            errors.push({ code, time: toMillis(Number(at(i + 1))) });
        }
        push(out, 'errors.code', errors[0]?.code ?? 0);
        push(out, 'errors.time', errors[0]?.time ?? 0);
        push(out, 'errors.listJson', JSON.stringify(errors));
    }
    return out;
}

/**
 * Device timestamps come in seconds or milliseconds depending on firmware.
 *
 * @param value
 */
export function toMillis(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return value < 1e11 ? value * 1000 : value;
}

/**
 * Decodes a `MctlSys` message (field 10 of LubaMsg) and returns the state
 * updates for the status report and the update buffer. Other sys fields are
 * handled elsewhere.
 *
 * @param sys
 */
export function decodeSysReports(sys: ProtoFields): StateUpdate[] {
    const out: StateUpdate[] = [];
    for (const report of getMessages(sys, SYS_FIELD_REPORT_DATA)) {
        out.push(...decodeReportInfoData(report));
    }
    const update = getMessage(sys, SYS_FIELD_UPDATE_BUF);
    if (update) {
        out.push(...decodeSystemUpdateBuf(getRepeatedInt64(update, 1)));
    }
    return out;
}

/**
 * Decodes a base64 `LubaMsg` and returns the report state updates (empty if none).
 *
 * @param protoBase64
 */
export function decodeLubaReports(protoBase64: string): StateUpdate[] {
    const luba = decodeFields(Buffer.from(protoBase64, 'base64'));
    const out: StateUpdate[] = [];
    for (const sys of getMessages(luba, 10)) {
        out.push(...decodeSysReports(sys));
    }
    return out;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
    if (value && typeof value === 'object') {
        return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
        try {
            const parsed: unknown = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

const NOTIFICATION_EVENTS = new Set([
    'device_notification_event',
    'device_warning_code_event',
    'device_information_event',
]);

/**
 * Decodes the JSON thing events that carry codes. Returns null for events
 * this module does not handle.
 *
 * - `device_warning_event`: `value.code` (number)
 * - `device_notification_event` / `device_warning_code_event` / `device_information_event`:
 * `value.data` = JSON string `{"localTime": <s|ms>, "code": "<code>"}`
 *
 * @param params
 * @param now
 */
export function decodeDeviceEvent(params: Record<string, unknown> | undefined, now: number): StateUpdate[] | null {
    const identifier = typeof params?.identifier === 'string' ? params.identifier : '';
    const value = parseJsonObject(params?.value);
    if (identifier === 'device_warning_event') {
        const code = Number(value?.code);
        if (!Number.isFinite(code)) {
            return null;
        }
        return [
            { id: 'errors.lastWarningCode', value: Math.abs(code) },
            { id: 'errors.lastWarningTime', value: now },
        ];
    }
    if (NOTIFICATION_EVENTS.has(identifier)) {
        const data = parseJsonObject(value?.data);
        const code = data?.code;
        if (code === undefined || code === null || code === '') {
            return null;
        }
        const localTime = toMillis(Number(data?.localTime));
        return [
            {
                id: 'errors.lastNotificationCode',
                value: typeof code === 'object' ? JSON.stringify(code) : String(code as string | number),
            },
            { id: 'errors.lastNotificationType', value: identifier },
            { id: 'errors.lastNotificationTime', value: localTime || now },
        ];
    }
    return null;
}

// --- map geometry -------------------------------------------------------------
//
// The mower stores its map as elements (zones, obstacles, paths, no-go areas),
// each identified by a 64-bit hash. The app first asks for the hash list
// (MctlNav.todev_gethash = nav 30, answer nav 31) and then for each hash its
// points (MctlNav.todev_get_commondata = nav 32, answer nav 33). Answers can
// span several frames; every frame must be acknowledged, otherwise the device
// repeats it. Points are local metres relative to the RTK base station.

const LUBA_FIELD_NAV = 11;
const NAV_FIELD_HASH_LIST_ACK = 31;
const NAV_FIELD_COMM_DATA_ACK = 33;

export interface MapPoint {
    x: number;
    y: number;
}

/** One frame of `NavGetHashListAck` (nav 31). */
export interface HashListFrame {
    subCmd: number;
    totalFrame: number;
    currentFrame: number;
    /** All hashes of this frame, unsigned. */
    hashes: bigint[];
}

/** One frame of `NavGetCommDataAck` (nav 33). */
export interface CommDataFrame {
    action: number;
    type: number;
    /** Unsigned 64-bit hash. */
    hash: bigint;
    paternalHashA: bigint;
    totalFrame: number;
    currentFrame: number;
    points: MapPoint[];
    name: string;
}

function navMessages(protoBase64: string): ProtoFields[] {
    try {
        return getMessages(decodeFields(Buffer.from(protoBase64, 'base64')), LUBA_FIELD_NAV);
    } catch {
        return [];
    }
}

function getUint64(fields: ProtoFields, field: number): bigint {
    const values = fields.get(field) ?? [];
    const v = values.find((x): x is bigint => typeof x === 'bigint');
    return v === undefined ? 0n : BigInt.asUintN(64, v);
}

function frameCount(fields: ProtoFields, field: number): number {
    const v = getInt32(fields, field);
    return v === undefined || v < 1 ? 1 : v;
}

/**
 * Extracts `NavGetHashListAck` frames from a base64 LubaMsg.
 *
 * @param protoBase64
 */
export function decodeHashListFrames(protoBase64: string): HashListFrame[] {
    const out: HashListFrame[] = [];
    for (const nav of navMessages(protoBase64)) {
        for (const ack of getMessages(nav, NAV_FIELD_HASH_LIST_ACK)) {
            out.push({
                subCmd: getInt32(ack, 2) ?? 0,
                totalFrame: frameCount(ack, 3),
                currentFrame: frameCount(ack, 4),
                hashes: getRepeatedInt64(ack, 13)
                    .map(h => BigInt.asUintN(64, h))
                    .filter(h => h !== 0n),
            });
        }
    }
    return out;
}

/**
 * Extracts `NavGetCommDataAck` frames (element geometry) from a base64 LubaMsg.
 *
 * @param protoBase64
 */
export function decodeCommDataFrames(protoBase64: string): CommDataFrame[] {
    const out: CommDataFrame[] = [];
    for (const nav of navMessages(protoBase64)) {
        for (const ack of getMessages(nav, NAV_FIELD_COMM_DATA_ACK)) {
            const points: MapPoint[] = [];
            for (const couple of getMessages(ack, 13)) {
                const x = getFloat(couple, 1) ?? 0;
                const y = getFloat(couple, 2) ?? 0;
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    points.push({ x, y });
                }
            }
            const nameTime = getMessage(ack, 15);
            const nameBuf = nameTime?.get(1)?.find((v): v is Buffer => v instanceof Buffer);
            out.push({
                action: getInt32(ack, 4) ?? 0,
                type: getInt32(ack, 5) ?? 0,
                hash: getUint64(ack, 6),
                paternalHashA: getUint64(ack, 7),
                totalFrame: frameCount(ack, 9),
                currentFrame: frameCount(ack, 10),
                points,
                name: nameBuf ? nameBuf.toString('utf8') : '',
            });
        }
    }
    return out;
}

/** A complete map element after all frames arrived. */
export interface MapElement {
    hash: bigint;
    type: number;
    name: string;
    points: MapPoint[];
}

/** Collects the frames of one element; frames may arrive repeated or out of order. */
export class ElementAssembler {
    private readonly parts = new Map<number, MapPoint[]>();
    private total = 0;
    private type = 0;
    private name = '';

    readonly hash: bigint;

    constructor(hash: bigint) {
        this.hash = hash;
    }

    /**
     * Returns true when the frame belonged to this element and was new.
     *
     * @param frame
     */
    add(frame: CommDataFrame): boolean {
        if (frame.hash !== this.hash || this.parts.has(frame.currentFrame)) {
            return false;
        }
        this.total = frame.totalFrame;
        this.type = frame.type;
        if (frame.name) {
            this.name = frame.name;
        }
        this.parts.set(frame.currentFrame, frame.points);
        return true;
    }

    get complete(): boolean {
        if (this.total === 0) {
            return false;
        }
        for (let i = 1; i <= this.total; i++) {
            if (!this.parts.has(i)) {
                return false;
            }
        }
        return true;
    }

    result(): MapElement {
        const points: MapPoint[] = [];
        for (let i = 1; i <= this.total; i++) {
            points.push(...(this.parts.get(i) ?? []));
        }
        return { hash: this.hash, type: this.type, name: this.name, points };
    }
}

/** Element types (`PathType`) the map shows, with their geometry. */
export const MAP_ELEMENT_KINDS: Record<number, { kind: string; geometry: 'Polygon' | 'LineString' }> = {
    0: { kind: 'zone', geometry: 'Polygon' },
    1: { kind: 'obstacle', geometry: 'Polygon' },
    2: { kind: 'path', geometry: 'LineString' },
    12: { kind: 'dumpZone', geometry: 'Polygon' },
    21: { kind: 'virtualWall', geometry: 'LineString' },
    22: { kind: 'noGo', geometry: 'Polygon' },
    23: { kind: 'noGo', geometry: 'Polygon' },
    25: { kind: 'safeZone', geometry: 'Polygon' },
    26: { kind: 'obstacleZone', geometry: 'Polygon' },
};

/** Origin and rotation of the local map in WGS84. */
export interface MapAnchor {
    lat: number;
    lon: number;
    /** Rotation of the local axes against east/north. */
    yawDeg: number;
}

const METRES_PER_DEG_LAT = 111_320;
const DEG = Math.PI / 180;

/**
 * Local metres → [longitude, latitude] (flat-earth approximation, fine for a garden).
 *
 * @param point
 * @param anchor
 */
export function localToLonLat(point: MapPoint, anchor: MapAnchor): [number, number] {
    const yaw = anchor.yawDeg * DEG;
    const east = Math.cos(yaw) * point.x - Math.sin(yaw) * point.y;
    const north = Math.sin(yaw) * point.x + Math.cos(yaw) * point.y;
    const lat = anchor.lat + north / METRES_PER_DEG_LAT;
    const lon = anchor.lon + east / (METRES_PER_DEG_LAT * Math.cos(anchor.lat * DEG));
    return [round(lon, 8), round(lat, 8)];
}

/**
 * Derives the anchor from a known robot position when the device did not send
 * its base-station origin: origin = robot position minus its local offset.
 *
 * @param robotLat
 * @param robotLon
 * @param robot
 * @param yawDeg
 */
export function anchorFromRobot(robotLat: number, robotLon: number, robot: MapPoint, yawDeg: number): MapAnchor {
    const yaw = yawDeg * DEG;
    const east = Math.cos(yaw) * robot.x - Math.sin(yaw) * robot.y;
    const north = Math.sin(yaw) * robot.x + Math.cos(yaw) * robot.y;
    const lat = robotLat - north / METRES_PER_DEG_LAT;
    const lon = robotLon - east / (METRES_PER_DEG_LAT * Math.cos(lat * DEG));
    return { lat, lon, yawDeg };
}

export interface MapFeatureProperties {
    kind: string;
    type: number;
    hash: string;
    name: string;
}

export interface MapFeature {
    type: 'Feature';
    geometry:
        | {
              type: 'Polygon';
              coordinates: Array<Array<[number, number]>>;
          }
        | {
              type: 'LineString';
              coordinates: Array<[number, number]>;
          }
        | {
              type: 'Point';
              coordinates: [number, number];
          };
    properties: MapFeatureProperties;
}

export interface MapFeatureCollection {
    type: 'FeatureCollection';
    features: MapFeature[];
}

/**
 * Builds a GeoJSON FeatureCollection of the map elements. `names` overrides the
 * element name by hash (zone names known from the zone list).
 *
 * @param elements
 * @param anchor
 * @param names
 * @param dock
 */
export function buildMapGeoJson(
    elements: MapElement[],
    anchor: MapAnchor,
    names: Map<string, string> = new Map(),
    dock?: MapPoint,
): MapFeatureCollection {
    const features: MapFeature[] = [];
    for (const element of elements) {
        const spec = MAP_ELEMENT_KINDS[element.type];
        if (!spec) {
            continue;
        }
        const coords = element.points.map(p => localToLonLat(p, anchor));
        const hash = element.hash.toString();
        const properties: MapFeatureProperties = {
            kind: spec.kind,
            type: element.type,
            hash,
            name: names.get(hash) ?? element.name,
        };
        if (spec.geometry === 'Polygon') {
            if (coords.length < 3) {
                continue;
            }
            const [first] = coords;
            const last = coords[coords.length - 1];
            const ring = first[0] === last[0] && first[1] === last[1] ? coords : [...coords, first];
            features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties });
        } else {
            if (coords.length < 2) {
                continue;
            }
            features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties });
        }
    }
    if (dock) {
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: localToLonLat(dock, anchor) },
            properties: { kind: 'dock', type: -1, hash: '', name: '' },
        });
    }
    // Zones first, so a map draws obstacles and no-go areas on top.
    const order = (f: MapFeature): number => (f.properties.kind === 'zone' ? 0 : f.properties.kind === 'dock' ? 2 : 1);
    features.sort((a, b) => order(a) - order(b));
    return { type: 'FeatureCollection', features };
}
