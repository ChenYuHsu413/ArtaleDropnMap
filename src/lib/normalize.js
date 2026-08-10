// 異體字 + 數字正規化 — 查詢端與索引端都先過這裡再比對。
// 對照表以「常見異體 → 正規字」為方向，成對展開避免遺漏。
const VARIANT_PAIRS = [
  ['型', '形'],
  ['裡', '裏'],
  ['台', '臺'],
  ['著', '着'],
  ['劍', '剑'],
  ['彩', '綵'],
  ['妖', '妟'],
  ['穴', '窟'], // 試煉洞穴 ↔ 試煉洞窟
  ['挖', '發'], // 遺跡挖掘地 ↔ 遺跡發掘地
];

// 建一張「任一異體 → 群組代表字」的映射；群組代表取 pair[0]。
const CHAR_MAP = new Map();
for (const group of VARIANT_PAIRS) {
  const canon = group[0];
  for (const ch of group) CHAR_MAP.set(ch, canon);
}

// Unicode 羅馬數字（Ⅰ..Ⅻ 與小寫）→ 阿拉伯數字
const UNICODE_ROMAN = {
  'Ⅰ': '1', 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4', 'Ⅴ': '5', 'Ⅵ': '6',
  'Ⅶ': '7', 'Ⅷ': '8', 'Ⅸ': '9', 'Ⅹ': '10', 'Ⅺ': '11', 'Ⅻ': '12',
  'ⅰ': '1', 'ⅱ': '2', 'ⅲ': '3', 'ⅳ': '4', 'ⅴ': '5', 'ⅵ': '6',
  'ⅶ': '7', 'ⅷ': '8', 'ⅸ': '9', 'ⅹ': '10',
};
// 中文數字（單字）→ 阿拉伯數字
const CN_NUM = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };
const ROMAN_VAL = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function romanToInt(s) {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN_VAL[s[i]];
    const next = ROMAN_VAL[s[i + 1]];
    total += next && cur < next ? -cur : cur;
  }
  return total;
}

// 數字統一：2 ↔ II ↔ Ⅱ ↔ 二 皆歸一為阿拉伯數字。
// 上游地圖名混用「紅螃蟹海灘II」與「結冰的平原Ⅱ」兩種寫法，統一後才好比對。
// 已對全部怪物/物品名驗證：不會造成任何名稱撞在一起（新撞名數 = 0）。
export function unifyNumbers(s) {
  let out = '';
  for (const ch of s) out += UNICODE_ROMAN[ch] ?? CN_NUM[ch] ?? ch;
  // ASCII 羅馬數字連續段（前後非字母數字才視為數字，避免誤傷單字）
  out = out.replace(/(?<![A-Za-z0-9])[IVXLCDM]+(?![A-Za-z0-9])/g, (m) => {
    const v = romanToInt(m);
    return v > 0 ? String(v) : m;
  });
  return out;
}

export function normalize(str) {
  if (str == null) return '';
  let s = String(str).trim();
  // 全形空白 → 半形，再去除所有空白
  s = s.replace(/　/g, ' ').replace(/\s+/g, '');
  // 全形英數 → 半形
  s = s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  // 數字統一（需在轉小寫前，羅馬數字為大寫）
  s = unifyNumbers(s);
  s = s.toLowerCase();
  // 異體字歸一
  let out = '';
  for (const ch of s) out += CHAR_MAP.get(ch) || ch;
  return out;
}

export { VARIANT_PAIRS };
