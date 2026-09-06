/**
 * Pure helpers for the device-list refresh in `refreshSessionAndDeviceCache`.
 *
 * Kept free of adapter state so the decision logic can be unit-tested. The adapter
 * calls the cloud (modern device list, modern device records, legacy bindings) and
 * feeds the outcome in here; this module decides whether the result may replace the
 * cached device set or whether the refresh has to be treated as a transient failure.
 */

/** Minimal shape of a device record as far as the merge logic is concerned. */
export interface DeviceRecordLike {
    /** Cloud identity of the device; records without one are ignored. */
    iotId: string;
}

export type DeviceListRefreshDecision =
    /** Replace the cached devices with the fetched records (also used for a genuinely empty account). */
    | 'sync'
    /** Fetch failed and nothing came back, but devices are cached: keep them and retry later. */
    | 'keep-cached'
    /** Fetch failed, nothing came back and nothing is cached: the refresh failed. */
    | 'unavailable';

/** Outcome of the device-list requests, as seen by `resolveDeviceListRefresh`. */
export interface DeviceListRefreshInput {
    /** Number of merged device records returned by the cloud. */
    recordCount: number;
    /** At least one of the device-list requests failed (timeout, 5xx, network). */
    fetchFailed: boolean;
    /** Devices currently held in the adapter cache. */
    cachedCount: number;
}

/**
 * Decide what to do with the outcome of a device-list refresh.
 *
 * An empty result is only trusted when every request succeeded. If a request failed and the
 * merged list is empty, the emptiness is most likely caused by the failure (for example a
 * short internet outage during the daily restart), not by the account having no devices.
 * Wiping the cache in that situation would stop polling for good, because the adapter only
 * polls devices it knows about.
 *
 * @param input outcome of the device-list requests plus the current cache size
 * @returns what the caller should do with the fetched records
 */
export function resolveDeviceListRefresh(input: DeviceListRefreshInput): DeviceListRefreshDecision {
    if (input.recordCount > 0) {
        return 'sync';
    }
    if (!input.fetchFailed) {
        // The cloud answered and reported no devices: trust it.
        return 'sync';
    }
    return input.cachedCount > 0 ? 'keep-cached' : 'unavailable';
}

/**
 * Merge modern and legacy device records: modern records first, then legacy entries
 * whose iotId is not already covered. Entries without an iotId are dropped.
 *
 * @param modernRecords records from the modern Mammotion API (owner accounts)
 * @param legacyRecords records from the legacy/Aliyun bindings (shared devices)
 * @returns the merged, de-duplicated record list
 */
export function mergeDeviceRecords<T extends DeviceRecordLike>(modernRecords: T[], legacyRecords: T[]): T[] {
    const modernIotIds = new Set(modernRecords.map(r => r.iotId).filter(Boolean));
    return [...modernRecords, ...legacyRecords.filter(r => r.iotId && !modernIotIds.has(r.iotId))];
}
