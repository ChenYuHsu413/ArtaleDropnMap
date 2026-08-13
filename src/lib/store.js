import Fuse from 'fuse.js';
import { normalize } from './normalize.js';

const BASE = import.meta.env.BASE_URL || './';
const dataUrl = (f) => `${BASE}data/${f}`;

export const store = {
  monsters: {}, // name -> record
  items: {}, // id -> record
  maps: {}, // id -> record
  leveling: [],
  meta: {},
  bossTime: {},
  ready: false,
  _fuse: null,
  _mapByName: null,
  _searchIndex: null,
};

async function getJson(f, ver) {
  // meta 每次帶時間戳取最新（檔小）；其餘用 built_at 版本號 → 重建才失效，平時可快取
  const bust = ver ? `?v=${ver}` : `?_=${Date.now()}`;
  const res = await fetch(dataUrl(f) + bust);
  if (!res.ok) throw new Error(`載入 ${f} 失敗 (${res.status})`);
  return res.json();
}

export async function loadData() {
  if (store.ready) return store;
  const meta = await getJson('meta.json').catch(() => ({}));
  const ver = meta.built_at || '';
  const [monsters, items, maps, leveling, mapAlias, bossTime, searchIndex] = await Promise.all([
    getJson('monsters.json', ver),
    getJson('items.json', ver),
    getJson('maps.json', ver),
    getJson('leveling.json', ver),
    getJson('map_alias.json', ver).catch(() => ({ aliases: {} })),
    getJson('boss_time.json', ver).catch(() => ({})),
    getJson('search_index.json', ver).catch(() => null),
  ]);
  store.monsters = monsters;
  store.items = items;
  store.maps = maps;
  store.leveling = leveling;
  store.meta = meta;
  store.mapAlias = mapAlias && mapAlias.aliases ? mapAlias.aliases : {};
  store.bossTime = bossTime;
  store._searchIndex = searchIndex;

  store._mapByName = new Map(Object.values(maps).map((m) => [m.name, m]));

  // 每隻怪的區域（由其地圖推導）+ 全站區域清單（依該區最低等排序＝遊戲進程順）
  const monsterRegions = new Map();
  const presentRegions = new Set();
  for (const m of Object.values(monsters)) {
    const regs = new Set();
    for (const mapId of m.maps) {
      const mp = maps[mapId];
      if (mp && mp.region) { regs.add(mp.region); presentRegions.add(mp.region); }
    }
    monsterRegions.set(m.name, regs);
  }
  store.monsterRegions = monsterRegions;
  // 區域下拉：只列 open 前綴（closed 已在 build 排除、unknown 不入下拉），依 meta.open_regions 的等級動線排序
  store.regionList = (meta.open_regions || []).filter((r) => presentRegions.has(r));

  buildSearchIndex();
  store.ready = true;
  return store;
}

// 搜尋索引於 build time 預產（public/data/search_index.json，含 opencc 簡體變體）。
// 前端只把它載入記憶體並建 Fuse；不在輸入時重建。docs 欄位：
//   { type, key, name, norm, simp, alias_norm, alias_simp, level|dropCount|region,mobCount }
function buildSearchIndex() {
  const docs = store._searchIndex || [];
  // 別名詞陣列（正規化 + 簡體）預切好，供 exact/prefix/alias 比對
  for (const d of docs) {
    d._aliasTerms = ((d.alias_norm || '') + ' ' + (d.alias_simp || '')).split(' ').filter(Boolean);
  }
  store._docs = docs;
  store._fuse = new Fuse(docs, {
    includeScore: true,
    threshold: 0.42, // 容忍打錯一個字
    ignoreLocation: true,
    minMatchCharLength: 1,
    keys: [
      { name: 'norm', weight: 0.6 },
      { name: 'simp', weight: 0.2 }, // 簡體變體，讓簡體輸入也能模糊命中
      { name: 'alias_norm', weight: 0.15 },
      { name: 'alias_simp', weight: 0.05 },
    ],
  });
}

// 搜尋比對優先序：完全相符 > 前綴相符 > 別名相符 > 模糊相符。
// norm=繁中正規化、simp=簡體正規化 → 繁簡輸入皆可命中同一實體。
export function search(query, limit = 20) {
  const q = normalize(query);
  if (!q) return [];
  const seen = new Set();
  const buckets = [[], [], []]; // 0=exact, 1=prefix, 2=alias
  const take = (d, tier) => { const k = d.type + ':' + d.key; if (seen.has(k)) return; seen.add(k); buckets[tier].push(d); };
  for (const d of store._docs) {
    if (d.norm === q || d.simp === q) { take(d, 0); continue; }
    if (d.norm.startsWith(q) || (d.simp && d.simp.startsWith(q))) { take(d, 1); continue; }
    if (d._aliasTerms.includes(q) || d._aliasTerms.some((t) => t.startsWith(q))) take(d, 2);
  }
  const ranked = [...buckets[0], ...buckets[1], ...buckets[2]];
  if (ranked.length >= limit) return ranked.slice(0, limit);
  // 補模糊
  const fuzzy = store._fuse
    .search(q, { limit: limit + ranked.length })
    .map((r) => r.item)
    .filter((d) => !seen.has(d.type + ':' + d.key));
  return [...ranked, ...fuzzy].slice(0, limit);
}

// 分組搜尋：回傳 { monster, item, map } 三組（各自已依優先序排序）。供全域搜尋頁/下拉分組顯示。
export function searchGrouped(query, perGroup = 8) {
  const all = search(query, perGroup * 6);
  const groups = { monster: [], item: [], map: [] };
  for (const d of all) {
    if (groups[d.type] && groups[d.type].length < perGroup) groups[d.type].push(d);
  }
  return groups;
}

// 便捷取用
export const getMonster = (name) => store.monsters[name] || null;
export const getItem = (id) => store.items[id] || null;
export const getMap = (id) => store.maps[id] || null;

// 地圖名解析：先精確，miss 再套 map_alias 片語替換 + 正規化（含異體字/數字）比對。
export function getMapByName(name) {
  if (!name) return null;
  const exact = store._mapByName && store._mapByName.get(name);
  if (exact) return exact;
  // 片語替換（俗稱 → 正式）
  let sub = name;
  for (const [alias, canon] of Object.entries(store.mapAlias || {})) {
    if (sub.includes(alias)) sub = sub.split(alias).join(canon);
  }
  if (store._mapByName && store._mapByName.get(sub)) return store._mapByName.get(sub);
  // 正規化比對
  const target = normalize(sub);
  for (const mp of Object.values(store.maps)) {
    if (normalize(mp.name) === target) return mp;
  }
  return null;
}

// 數值可能為單值或「型態一/型態二」陣列。
// 效率計算取末值（型態二＝實戰型態，已驗證與攻略數字吻合）。
export const eff = (x) => (Array.isArray(x) ? x[x.length - 1] : typeof x === 'number' ? x : 0);
// 單值顯示：大數字換算回「萬」並加千分位（53750000 → 5,375萬），中數字加千分位。
function fmtOne(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n ?? '');
  if (n >= 10000) {
    const wan = n / 10000;
    const s = Number.isInteger(wan) ? wan.toLocaleString('en-US') : (Math.round(wan * 10) / 10).toLocaleString('en-US');
    return s + '萬';
  }
  if (n >= 1000) return n.toLocaleString('en-US');
  return String(n);
}
// 陣列（型態一/型態二）兩值並列，如「800 / 700」「5,375萬 / 1,250萬」。
export const fmtStat = (x) => (Array.isArray(x) ? x.map(fmtOne).join(' / ') : fmtOne(x));
// 是否為多型態 BOSS（HP 為陣列）、列於 boss_time、或 patch 明標 is_boss（野王）—— 不參與效率自動推薦。
export const isBoss = (m) => Array.isArray(m.hp) || !!m.is_boss || !!(store.bossTime && store.bossTime[m.name]);

// mob 頭像 URL（build 已預算 icon：GMS icon > artale png > null）
export function mobIconUrl(monster) {
  return (monster && monster.icon) || null;
}
// 物品圖示 URL（數字 id 才行；custom: 無圖）
export function itemIconUrl(item) {
  if (!item || String(item.id).startsWith('custom:')) return null;
  const v = store.meta.gms_version || 92;
  return `https://maplestory.io/api/GMS/${v}/item/${item.id}/icon`;
}
