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
  mobAlias: {},
  bossTime: {},
  ready: false,
  _fuse: null,
  _mapByName: null,
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
  const [monsters, items, maps, leveling, mobAlias, mapAlias, bossTime] = await Promise.all([
    getJson('monsters.json', ver),
    getJson('items.json', ver),
    getJson('maps.json', ver),
    getJson('leveling.json', ver),
    getJson('mob_alias.json', ver).catch(() => ({})),
    getJson('map_alias.json', ver).catch(() => ({ aliases: {} })),
    getJson('boss_time.json', ver).catch(() => ({})),
  ]);
  store.monsters = monsters;
  store.items = items;
  store.maps = maps;
  store.leveling = leveling;
  store.meta = meta;
  store.mobAlias = mobAlias;
  store.mapAlias = mapAlias && mapAlias.aliases ? mapAlias.aliases : {};
  store.bossTime = bossTime;

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

// 建立搜尋索引：怪物 + 物品，正規化後的名字與別名都放進 Fuse。
function buildSearchIndex() {
  // mob_alias.json 為 { 俗稱: 正式名 }；反轉成 正式名 -> [俗稱...] 供搜尋
  const aliasesByMob = new Map();
  for (const [alias, official] of Object.entries(store.mobAlias || {})) {
    if (alias.startsWith('_')) continue;
    if (!aliasesByMob.has(official)) aliasesByMob.set(official, []);
    aliasesByMob.get(official).push(alias);
  }
  store._mobAliasesByName = aliasesByMob;

  const docs = [];
  for (const m of Object.values(store.monsters)) {
    const aliases = aliasesByMob.get(m.name) || [];
    docs.push({
      type: 'monster',
      key: m.name,
      name: m.name,
      norm: normalize(m.name),
      alias_norm: aliases.map(normalize).join(' '),
      level: m.level,
      image: m.image,
    });
  }
  for (const it of Object.values(store.items)) {
    const aliasNorm = (it.aliases || []).map(normalize).join(' ');
    docs.push({
      type: 'item',
      key: it.id,
      name: it.name,
      norm: normalize(it.name),
      alias_norm: aliasNorm,
      dropCount: (it.dropped_by || []).length,
    });
  }
  // 地圖也進索引，讓玩家用地圖名或俗稱（map_alias）找到地圖頁。
  // map_alias 為 { 俗稱: 正式片語 }；若地圖名含該正式片語，就把俗稱掛為別名詞。
  const mapAliasPairs = Object.entries(store.mapAlias || {});
  for (const mp of Object.values(store.maps)) {
    const aliasTerms = [];
    for (const [alias, canon] of mapAliasPairs) {
      if (mp.name.includes(canon)) aliasTerms.push(alias);
    }
    docs.push({
      type: 'map',
      key: mp.id,
      name: mp.name,
      norm: normalize(mp.name),
      alias_norm: aliasTerms.map(normalize).join(' '),
      region: mp.region,
      mobCount: (mp.mobs || []).length,
    });
  }
  store._fuse = new Fuse(docs, {
    includeScore: true,
    threshold: 0.42, // 容忍打錯一個字
    ignoreLocation: true,
    minMatchCharLength: 1,
    keys: [
      { name: 'norm', weight: 0.7 },
      { name: 'alias_norm', weight: 0.3 },
    ],
  });
  store._docs = docs;
}

// 搜尋：先精確（正規化相等）再模糊。
export function search(query, limit = 20) {
  const q = normalize(query);
  if (!q) return [];
  const exact = [];
  const exactKeys = new Set();
  for (const d of store._docs) {
    if (d.norm === q || (d.alias_norm && d.alias_norm.split(' ').includes(q))) {
      exact.push(d);
      exactKeys.add(d.type + ':' + d.key);
    }
  }
  const fuzzy = store._fuse
    .search(q, { limit: limit + exact.length })
    .map((r) => r.item)
    .filter((d) => !exactKeys.has(d.type + ':' + d.key));
  return [...exact, ...fuzzy].slice(0, limit);
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
// 是否為多型態 BOSS（HP 為陣列）或列於 boss_time —— 不參與效率自動推薦。
export const isBoss = (m) => Array.isArray(m.hp) || !!(store.bossTime && store.bossTime[m.name]);

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
