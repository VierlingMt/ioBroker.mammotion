import { expect } from 'chai';
import { mergeDeviceRecords, resolveDeviceListRefresh } from './device-list.ts';

describe('lib/device-list => resolveDeviceListRefresh', () => {
    it('syncs when the cloud returned devices, regardless of partial failures', () => {
        expect(resolveDeviceListRefresh({ recordCount: 1, fetchFailed: false, cachedCount: 0 })).to.equal('sync');
        expect(resolveDeviceListRefresh({ recordCount: 1, fetchFailed: true, cachedCount: 1 })).to.equal('sync');
        expect(resolveDeviceListRefresh({ recordCount: 2, fetchFailed: true, cachedCount: 0 })).to.equal('sync');
    });

    it('trusts an empty result when every request succeeded (account without devices)', () => {
        expect(resolveDeviceListRefresh({ recordCount: 0, fetchFailed: false, cachedCount: 0 })).to.equal('sync');
        expect(resolveDeviceListRefresh({ recordCount: 0, fetchFailed: false, cachedCount: 1 })).to.equal('sync');
    });

    it('keeps cached devices when the fetch failed and nothing came back', () => {
        expect(resolveDeviceListRefresh({ recordCount: 0, fetchFailed: true, cachedCount: 1 })).to.equal('keep-cached');
        expect(resolveDeviceListRefresh({ recordCount: 0, fetchFailed: true, cachedCount: 3 })).to.equal('keep-cached');
    });

    it('reports the refresh as unavailable when the fetch failed and nothing is cached', () => {
        expect(resolveDeviceListRefresh({ recordCount: 0, fetchFailed: true, cachedCount: 0 })).to.equal('unavailable');
    });
});

describe('lib/device-list => mergeDeviceRecords', () => {
    it('keeps modern records first and appends legacy records with new iotIds', () => {
        const modern = [{ iotId: 'a', source: 'modern' }];
        const legacy = [
            { iotId: 'a', source: 'legacy' },
            { iotId: 'b', source: 'legacy' },
        ];
        const merged = mergeDeviceRecords(modern, legacy);
        expect(merged.map(r => `${r.iotId}:${r.source}`)).to.deep.equal(['a:modern', 'b:legacy']);
    });

    it('drops legacy records without an iotId', () => {
        const merged = mergeDeviceRecords([], [{ iotId: '' }, { iotId: 'x' }]);
        expect(merged.map(r => r.iotId)).to.deep.equal(['x']);
    });

    it('returns an empty list when both inputs are empty', () => {
        expect(mergeDeviceRecords([], [])).to.deep.equal([]);
    });
});
