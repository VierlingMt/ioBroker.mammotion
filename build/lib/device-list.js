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
var device_list_exports = {};
__export(device_list_exports, {
  mergeDeviceRecords: () => mergeDeviceRecords,
  resolveDeviceListRefresh: () => resolveDeviceListRefresh
});
module.exports = __toCommonJS(device_list_exports);
function resolveDeviceListRefresh(input) {
  if (input.recordCount > 0) {
    return "sync";
  }
  if (!input.fetchFailed) {
    return "sync";
  }
  return input.cachedCount > 0 ? "keep-cached" : "unavailable";
}
function mergeDeviceRecords(modernRecords, legacyRecords) {
  const modernIotIds = new Set(modernRecords.map((r) => r.iotId).filter(Boolean));
  return [...modernRecords, ...legacyRecords.filter((r) => r.iotId && !modernIotIds.has(r.iotId))];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mergeDeviceRecords,
  resolveDeviceListRefresh
});
//# sourceMappingURL=device-list.js.map
