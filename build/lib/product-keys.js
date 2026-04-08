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
var product_keys_exports = {};
__export(product_keys_exports, {
  LUBA_PRO_PRODUCT_KEYS: () => LUBA_PRO_PRODUCT_KEYS,
  PRODUCT_KEY_GROUPS: () => PRODUCT_KEY_GROUPS,
  YUKA_MINI_PRODUCT_KEYS: () => YUKA_MINI_PRODUCT_KEYS,
  YUKA_ML_PRODUCT_KEYS: () => YUKA_ML_PRODUCT_KEYS,
  YUKA_PRODUCT_KEYS: () => YUKA_PRODUCT_KEYS,
  resolveProductKeyGroup: () => resolveProductKeyGroup
});
module.exports = __toCommonJS(product_keys_exports);
var _a, _b, _c, _d, _e, _f, _g, _h, _i;
const PRODUCT_KEY_GROUPS = {
  Cm900ProductKey: ["zkRuTK9KsXG", "6DbgVh2Qs5m"],
  Luba2MiniProductKey: ["a1L5ZfJIxGl", "a1dCWYFLROK"],
  LubaLAProductKey: ["CDYuKXTYrSP"],
  LubaLDProductKey: ["a1jDMfG2Fgj", "a1vtZq9LUFS"],
  LubaMBProductKey: ["a1pb9toor70"],
  LubaMDProductKey: ["a1T6VTFTc0C", "a14iRDqMepW"],
  LubaProductKey: ["a1UBFdq6nNz", "a1x0zHD3Xop", "a1pvCnb3PPu", "a1kweSOPylG", "a1JFpmAV5Ur", "a1BmXWlsdbA", "a1jOhAYOIG8", "a1K4Ki2L5rK", "a1ae1QnXZGf", "a1nf9kRBWoH", "a1ZU6bdGjaM"],
  LubaVAProductKey: ["a1Ce85210Be", "a1BBOJnnjb9"],
  LubaVProductKey: ["a1iMygIwxFC", "a1LLmy1zc0j"],
  LubaVProProductKey: ["a1mb8v6tnAa", "a1pHsTqyoPR"],
  RTKNBProductKey: ["a1NfZqdSREf", "a1ZuQVL7UiN"],
  RTKProductKey: ["a1qXkZ5P39W", "a1Nc68bGZzX"],
  YukaMiniProductKey: ["a1BqmEWMRbX", "a1biqVGvxrE"],
  YukaMLProductKey: ["a1OWGO8WXbh", "a1s6znKxGvI"],
  YukaMN100ProductKey: ["NnbeYtaEUGE"],
  YukaMVProductKey: ["a1jFe8HzcDb", "a16cz0iXgUJ", "USpE46bNTC7", "pdA6uJrBfjz"],
  YukaPlusProductKey: ["a1lNESu9VST", "a1zAEzmvWDa"],
  YukaProductKey: ["a1kT0TlYEza", "a1IQV0BrnXb"]
};
function resolveProductKeyGroup(productKey) {
  if (!productKey) {
    return null;
  }
  for (const [group, keys] of Object.entries(PRODUCT_KEY_GROUPS)) {
    if (keys.includes(productKey)) {
      return group;
    }
  }
  return null;
}
const LUBA_PRO_PRODUCT_KEYS = new Set((_a = PRODUCT_KEY_GROUPS.LubaVProProductKey) != null ? _a : []);
const YUKA_MINI_PRODUCT_KEYS = new Set((_b = PRODUCT_KEY_GROUPS.YukaMiniProductKey) != null ? _b : []);
const YUKA_ML_PRODUCT_KEYS = new Set((_c = PRODUCT_KEY_GROUPS.YukaMLProductKey) != null ? _c : []);
const YUKA_PRODUCT_KEYS = /* @__PURE__ */ new Set([
  ...(_d = PRODUCT_KEY_GROUPS.YukaProductKey) != null ? _d : [],
  ...(_e = PRODUCT_KEY_GROUPS.YukaPlusProductKey) != null ? _e : [],
  ...(_f = PRODUCT_KEY_GROUPS.YukaMVProductKey) != null ? _f : [],
  ...(_g = PRODUCT_KEY_GROUPS.YukaMN100ProductKey) != null ? _g : [],
  ...(_h = PRODUCT_KEY_GROUPS.YukaMiniProductKey) != null ? _h : [],
  ...(_i = PRODUCT_KEY_GROUPS.YukaMLProductKey) != null ? _i : []
]);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LUBA_PRO_PRODUCT_KEYS,
  PRODUCT_KEY_GROUPS,
  YUKA_MINI_PRODUCT_KEYS,
  YUKA_ML_PRODUCT_KEYS,
  YUKA_PRODUCT_KEYS,
  resolveProductKeyGroup
});
//# sourceMappingURL=product-keys.js.map
