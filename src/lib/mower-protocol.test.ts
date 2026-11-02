import { expect } from 'chai';
import {
    anchorFromRobot,
    buildMapGeoJson,
    decodeCommDataFrames,
    decodeHashListFrames,
    ElementAssembler,
    localToLonLat,
    decodeDeviceEvent,
    decodeFields,
    getDouble,
    getInt32,
    getRepeatedInt64,
    decodeLubaReports,
    decodeSystemUpdateBuf,
    REPORT_STATE_DEFS,
    type StateUpdate,
    toMillis,
} from './mower-protocol.ts';

// --- tiny protobuf writer for test fixtures -------------------------------

function varint(value: bigint | number): Buffer {
    let v = BigInt.asUintN(64, BigInt(value));
    const bytes: number[] = [];
    do {
        let b = Number(v & 0x7fn);
        v >>= 7n;
        if (v > 0n) {
            b |= 0x80;
        }
        bytes.push(b);
    } while (v > 0n);
    return Buffer.from(bytes);
}

function fVarint(field: number, value: bigint | number): Buffer {
    return Buffer.concat([varint((field << 3) | 0), varint(value)]);
}

function fBytes(field: number, payload: Buffer): Buffer {
    return Buffer.concat([varint((field << 3) | 2), varint(payload.length), payload]);
}

function fDouble(field: number, value: number): Buffer {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(value);
    return Buffer.concat([varint((field << 3) | 1), b]);
}

function msg(...parts: Buffer[]): Buffer {
    return Buffer.concat(parts);
}

function luba(sys: Buffer): string {
    return msg(fVarint(1, 244), fVarint(2, 1), fVarint(3, 7), fBytes(10, sys)).toString('base64');
}

function fFloat(field: number, value: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeFloatLE(value);
    return Buffer.concat([varint((field << 3) | 5), b]);
}

function fFixed64(field: number, value: bigint): Buffer {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt.asUintN(64, value));
    return Buffer.concat([varint((field << 3) | 1), b]);
}

function lubaNav(nav: Buffer): string {
    return msg(fVarint(1, 240), fVarint(2, 17), fVarint(3, 7), fBytes(11, nav)).toString('base64');
}

function asMap(updates: StateUpdate[]): Record<string, unknown> {
    return Object.fromEntries(updates.map(u => [u.id, u.value]));
}

// --- proto-decode ---------------------------------------------------------

describe('lib/proto-decode', () => {
    it('reads negative int32 sent as 10-byte varint', () => {
        const fields = decodeFields(fVarint(1, -1005));
        expect(getInt32(fields, 1)).to.equal(-1005);
    });

    it('reads doubles', () => {
        expect(getDouble(decodeFields(fDouble(4, 49.7731)), 4)).to.equal(49.7731);
    });

    it('reads packed and unpacked repeated int64 alike', () => {
        const packed = decodeFields(fBytes(1, msg(varint(2), varint(0), varint(-7))));
        const unpacked = decodeFields(msg(fVarint(1, 2), fVarint(1, 0), fVarint(1, -7)));
        expect(getRepeatedInt64(packed, 1)).to.deep.equal([2n, 0n, -7n]);
        expect(getRepeatedInt64(unpacked, 1)).to.deep.equal([2n, 0n, -7n]);
    });

    it('survives truncated input', () => {
        const fields = decodeFields(Buffer.from([0x08, 0x96]));
        expect(fields.size).to.equal(0);
    });
});

// --- report_info_data -----------------------------------------------------

describe('lib/mower-protocol => decodeLubaReports (sys 39)', () => {
    const report = msg(
        fBytes(1, msg(fVarint(1, 1), fVarint(2, -60), fVarint(3, -55))),
        fBytes(
            2,
            msg(
                fVarint(1, 13),
                fVarint(2, 0),
                fVarint(3, 87),
                fVarint(5, 11),
                fVarint(15, 1),
                fBytes(11, fVarint(1, 0)),
            ),
        ),
        fBytes(3, msg(fVarint(1, 4), fVarint(2, 0), fVarint(3, 31), fVarint(7, 18), fVarint(10, 25))),
        fBytes(4, msg(fVarint(1, 123_456), fVarint(2, -78_900), fVarint(3, 15_708), fVarint(4, 1), fVarint(5, 42n))),
        fBytes(5, msg(fVarint(3, (25 << 16) | 120), fVarint(4, (40 << 16) | 350), fVarint(20, 55))),
        fBytes(
            7,
            msg(
                fVarint(1, 123_000),
                fVarint(2, 360_000),
                fVarint(3, 77),
                fBytes(4, msg(fVarint(1, 180_000), fVarint(2, 540_000))),
            ),
        ),
        fBytes(11, msg(fVarint(1, 1), fVarint(2, 2), fVarint(3, 3), fVarint(4, 4), fVarint(5, 1))),
    );
    const states = asMap(decodeLubaReports(luba(fBytes(39, report))));

    it('decodes device status', () => {
        expect(states['telemetry.deviceState']).to.equal(13);
        expect(states['telemetry.batteryPercent']).to.equal(87);
        expect(states['telemetry.chargeState']).to.equal(0);
        expect(states['telemetry.lastStatus']).to.equal(11);
        expect(states['telemetry.headlampOn']).to.equal(true);
        expect(states['telemetry.batteryHeating']).to.equal(false);
        expect(states['telemetry.lockState']).to.equal(0);
    });

    it('decodes positioning quality', () => {
        expect(states['telemetry.rtkStatus']).to.equal(4);
        expect(states['telemetry.rtkStatusText']).to.equal('FIX');
        expect(states['telemetry.gpsSatellites']).to.equal(31);
        expect(states['telemetry.gpsSatellitesL2']).to.equal(18);
        expect(states['telemetry.coViewSatellites']).to.equal(25);
    });

    it('decodes the local map position with sign', () => {
        expect(states['telemetry.posX']).to.equal(12.346);
        expect(states['telemetry.posY']).to.equal(-7.89);
        expect(states['telemetry.headingRaw']).to.equal(1.5708);
        expect(states['telemetry.currentZoneHash']).to.equal('42');
    });

    it('splits the packed job fields', () => {
        expect(states['telemetry.mowProgressPct']).to.equal(40);
        expect(states['telemetry.mowedArea']).to.equal(350);
        expect(states['telemetry.jobTotalMin']).to.equal(120);
        expect(states['telemetry.jobRemainingMin']).to.equal(25);
        expect(states['telemetry.jobKnifeHeightMm']).to.equal(55);
    });

    it('decodes connectivity and skips missing RSSI', () => {
        expect(states['telemetry.connectType']).to.equal(1);
        expect(states['telemetry.bleRssi']).to.equal(-60);
        expect(states['telemetry.wifiRssi']).to.equal(-55);
        expect(states).not.to.have.property('telemetry.mobileRssi');
    });

    it('decodes maintenance and blade hours', () => {
        expect(states['maintenance.mileageM']).to.equal(123_000);
        expect(states['maintenance.workTimeSec']).to.equal(360_000);
        expect(states['maintenance.batteryCycles']).to.equal(77);
        expect(states['maintenance.bladeUsedHours']).to.equal(50);
        expect(states['maintenance.bladeWarnHours']).to.equal(150);
    });

    it('decodes the base station', () => {
        expect(states['basestation.version']).to.equal('1.2.3.4');
        expect(states['basestation.status']).to.equal(1);
    });

    it('takes the map anchor from the RTK MQTT info of vision models', () => {
        const rtk = fBytes(3, fBytes(13, msg(fDouble(4, 49.77312), fDouble(5, 11.18934))));
        const s = asMap(decodeLubaReports(luba(fBytes(39, rtk))));
        expect(s['map.baseLatitude']).to.equal(49.77312);
        expect(s['map.baseLongitude']).to.equal(11.18934);
    });

    it('ignores the -1/-1 "no GGA" marker', () => {
        const rtk = fBytes(3, fBytes(13, msg(fDouble(4, -1), fDouble(5, -1))));
        expect(asMap(decodeLubaReports(luba(fBytes(39, rtk))))).not.to.have.property('map.baseLatitude');
    });

    it('returns nothing for unrelated messages', () => {
        expect(decodeLubaReports(luba(fBytes(2, fVarint(1, 13))))).to.deep.equal([]);
        expect(decodeLubaReports(Buffer.from('garbage').toString('base64'))).to.deep.equal([]);
    });

    it('only emits ids that have an object definition', () => {
        const known = new Set(REPORT_STATE_DEFS.map(d => d.id));
        known.add('telemetry.deviceState');
        known.add('telemetry.batteryPercent');
        known.add('telemetry.wifiRssi');
        for (const id of Object.keys(states)) {
            expect(known.has(id), id).to.equal(true);
        }
    });
});

// --- systemUpdateBuf ------------------------------------------------------

describe('lib/mower-protocol => decodeSystemUpdateBuf (sys 27)', () => {
    it('reads the error list, newest first, as positive codes', () => {
        const data = [2n, 0n, 0n, -1005n, 1_725_159_492n, -1411n, 1_725_150_000n];
        while (data.length < 23) {
            data.push(0n);
        }
        const s = asMap(decodeSystemUpdateBuf(data));
        expect(s['errors.code']).to.equal(1005);
        expect(s['errors.time']).to.equal(1_725_159_492_000);
        expect(JSON.parse(s['errors.listJson'] as string)).to.deep.equal([
            { code: 1005, time: 1_725_159_492_000 },
            { code: 1411, time: 1_725_150_000_000 },
        ]);
    });

    it('reports 0 when the error list is empty', () => {
        const s = asMap(decodeSystemUpdateBuf([2n, ...new Array<bigint>(22).fill(0n)]));
        expect(s['errors.code']).to.equal(0);
        expect(s['errors.listJson']).to.equal('[]');
    });

    it('reads the map anchor and the dock position', () => {
        const latRad = (49.77312 * Math.PI) / 180;
        const lonRad = (11.18934 * Math.PI) / 180;
        const data = [
            1n,
            0n,
            0n,
            90n,
            0n,
            BigInt(Math.round(latRad * 1e8)),
            BigInt(Math.round(lonRad * 1e8)),
            25_000n,
            -12_500n,
        ];
        while (data.length < 14) {
            data.push(0n);
        }
        data[13] = BigInt(Math.round((Math.PI / 6) * 1e8));
        const s = asMap(decodeSystemUpdateBuf(data));
        expect(s['map.baseLatitude']).to.be.closeTo(49.77312, 1e-6);
        expect(s['map.baseLongitude']).to.be.closeTo(11.18934, 1e-6);
        expect(s['map.baseYawDeg']).to.be.closeTo(30, 1e-3);
        expect(s['map.dockX']).to.equal(2.5);
        expect(s['map.dockY']).to.equal(-1.25);
        expect(s['map.dockHeadingRaw']).to.equal(90);
    });

    it('is reached through decodeLubaReports with a packed list', () => {
        const packed = fBytes(1, msg(...[2n, 0n, 0n, -3n, 1000n].map(v => varint(v))));
        const s = asMap(decodeLubaReports(luba(fBytes(27, packed))));
        expect(s['errors.code']).to.equal(3);
    });
});

// --- events ----------------------------------------------------------------

describe('lib/mower-protocol => decodeDeviceEvent', () => {
    const now = 1_700_000_000_000;

    it('reads device_warning_event', () => {
        const s = decodeDeviceEvent({ identifier: 'device_warning_event', value: { code: -1005 } }, now);
        expect(asMap(s ?? [])).to.deep.equal({ 'errors.lastWarningCode': 1005, 'errors.lastWarningTime': now });
    });

    it('reads notification events with JSON data', () => {
        const s = decodeDeviceEvent(
            { identifier: 'device_notification_event', value: { data: '{"localTime":1725159492000,"code":"1002"}' } },
            now,
        );
        expect(asMap(s ?? [])).to.deep.equal({
            'errors.lastNotificationCode': '1002',
            'errors.lastNotificationType': 'device_notification_event',
            'errors.lastNotificationTime': 1_725_159_492_000,
        });
    });

    it('accepts the value as JSON string', () => {
        const s = decodeDeviceEvent({ identifier: 'device_warning_event', value: '{"code":7}' }, now);
        expect(asMap(s ?? [])['errors.lastWarningCode']).to.equal(7);
    });

    it('ignores other events', () => {
        expect(decodeDeviceEvent({ identifier: 'device_protobuf_msg_event', value: {} }, now)).to.equal(null);
        expect(decodeDeviceEvent(undefined, now)).to.equal(null);
    });

    it('normalises seconds and milliseconds', () => {
        expect(toMillis(1_725_159_492)).to.equal(1_725_159_492_000);
        expect(toMillis(1_725_159_492_000)).to.equal(1_725_159_492_000);
        expect(toMillis(0)).to.equal(0);
    });
});

// --- map geometry ------------------------------------------------------------

describe('lib/mower-protocol => map frames', () => {
    const bigHash = 0xf234_5678_9abc_def0n; // above 2^63: must stay unsigned

    it('decodes a hash list frame with packed hashes', () => {
        const ack = msg(
            fVarint(1, 1),
            fVarint(3, 2),
            fVarint(4, 1),
            fVarint(6, 2),
            fBytes(13, msg(varint(11n), varint(bigHash), varint(0n))),
        );
        const [frame] = decodeHashListFrames(lubaNav(fBytes(31, ack)));
        expect(frame).to.deep.equal({ subCmd: 0, totalFrame: 2, currentFrame: 1, hashes: [11n, bigHash] });
    });

    it('decodes element frames with float points, type and name', () => {
        const ack = msg(
            fVarint(1, 1),
            fVarint(4, 8),
            fFixed64(6, bigHash),
            fVarint(9, 2),
            fVarint(10, 2),
            fBytes(13, msg(fFloat(1, 1.5), fFloat(2, -2.25))),
            fBytes(13, msg(fFloat(1, 3), fFloat(2, 0))),
            fBytes(15, fBytes(1, Buffer.from('Vorgarten', 'utf8'))),
        );
        const [frame] = decodeCommDataFrames(lubaNav(fBytes(33, ack)));
        expect(frame.type).to.equal(0);
        expect(frame.hash).to.equal(bigHash);
        expect(frame.totalFrame).to.equal(2);
        expect(frame.currentFrame).to.equal(2);
        expect(frame.points).to.deep.equal([
            { x: 1.5, y: -2.25 },
            { x: 3, y: 0 },
        ]);
        expect(frame.name).to.equal('Vorgarten');
    });

    it('ignores non-nav messages', () => {
        expect(decodeCommDataFrames(luba(fBytes(39, Buffer.alloc(0))))).to.deep.equal([]);
        expect(decodeHashListFrames('not base64 at all')).to.deep.equal([]);
    });

    it('assembles frames in order, ignoring repeats and foreign hashes', () => {
        const a = new ElementAssembler(5n);
        const frame = (current: number, x: number, hash = 5n): Parameters<ElementAssembler['add']>[0] => ({
            action: 8,
            type: 1,
            hash,
            paternalHashA: 0n,
            totalFrame: 2,
            currentFrame: current,
            points: [{ x, y: 0 }],
            name: '',
        });
        expect(a.add(frame(2, 20))).to.equal(true);
        expect(a.complete).to.equal(false);
        expect(a.add(frame(2, 99))).to.equal(false);
        expect(a.add(frame(1, 10, 6n))).to.equal(false);
        expect(a.add(frame(1, 10))).to.equal(true);
        expect(a.complete).to.equal(true);
        expect(a.result().points.map(p => p.x)).to.deep.equal([10, 20]);
        expect(a.result().type).to.equal(1);
    });
});

describe('lib/mower-protocol => map coordinates and GeoJSON', () => {
    const anchor = { lat: 49.7731, lon: 11.1893, yawDeg: 0 };

    it('maps local metres to lon/lat', () => {
        const [lon, lat] = localToLonLat({ x: 0, y: 111.32 }, anchor);
        expect(lat).to.be.closeTo(49.7741, 1e-7);
        expect(lon).to.be.closeTo(11.1893, 1e-9);
        const [lon2] = localToLonLat({ x: 100, y: 0 }, anchor);
        expect(lon2).to.be.greaterThan(11.1893);
    });

    it('rotates by the yaw of the base station', () => {
        const rotated = localToLonLat({ x: 10, y: 0 }, { ...anchor, yawDeg: 90 });
        // x axis turned to north: latitude grows, longitude stays
        expect(rotated[1]).to.be.greaterThan(anchor.lat);
        expect(rotated[0]).to.be.closeTo(anchor.lon, 1e-8);
    });

    it('derives the anchor back from a robot position', () => {
        const robot = { x: 12, y: -7 };
        const [lon, lat] = localToLonLat(robot, { ...anchor, yawDeg: 30 });
        const derived = anchorFromRobot(lat, lon, robot, 30);
        expect(derived.lat).to.be.closeTo(anchor.lat, 1e-7);
        expect(derived.lon).to.be.closeTo(anchor.lon, 1e-7);
    });

    it('builds closed polygons, lines, names and the dock', () => {
        const square = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ];
        const geo = buildMapGeoJson(
            [
                { hash: 7n, type: 1, name: '', points: square },
                { hash: 1n, type: 0, name: 'area', points: square },
                { hash: 2n, type: 2, name: '', points: square.slice(0, 2) },
                { hash: 3n, type: 18, name: '', points: square },
                { hash: 4n, type: 0, name: '', points: square.slice(0, 2) },
            ],
            anchor,
            new Map([['1', 'Garten hinten']]),
            { x: 1, y: 1 },
        );
        expect(geo.features.map(f => f.properties.kind)).to.deep.equal(['zone', 'obstacle', 'path', 'dock']);
        const zone = geo.features[0];
        expect(zone.properties.name).to.equal('Garten hinten');
        expect(zone.geometry.type).to.equal('Polygon');
        const ring = (zone.geometry as { coordinates: Array<Array<[number, number]>> }).coordinates[0];
        expect(ring.length).to.equal(5);
        expect(ring[0]).to.deep.equal(ring[4]);
        expect(geo.features[2].geometry.type).to.equal('LineString');
    });
});
