// Artale DropnMap — 資料建置腳本
// 抓取 → 清洗 → 合併 → 交叉索引 → 產出 public/data/*.json
//
// 用法:
//   node scripts/build-data.mjs            # 有快取就用快取
//   node scripts/build-data.mjs --no-cache # 強制重抓所有來源
//   node scripts/build-data.mjs --if-missing # 只有 public/data 缺檔時才跑（給 prebuild 用）
//
// 交叉參照約定（重要）:
//   monsters.json 以「怪物名」為 key。
//   maps.mobs[].mob / items.dropped_by[] 皆存「怪物名」（怪物的穩定唯一鍵）。
//   monsters.drops[] 存 itemId、monsters.maps[] 存 mapId。
//   monsters.id 為 GMS mob id（可能為 null，故不當交叉鍵用）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../src/lib/normalize.js';
import { loadPatches, applyPatches, adaptLegacyReports, summarizeReport } from './lib/patch.mjs';
import * as OpenCC from 'opencc-js';

// 繁→簡（僅 build time；產出簡體變體寫進預建索引，讓簡體輸入命中，runtime 不需 opencc）
const toSimp = OpenCC.Converter({ from: 'tw', to: 'cn' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const DATA_SRC = path.join(ROOT, 'data-src'); // 人工維護的來源（練等、地圖修正、怪物別名）

// 讀取人工來源檔（不存在則回傳 fallback）
function readSrc(name, fallback) {
  const p = path.join(DATA_SRC, name);
  if (!fs.existsSync(p)) {
    log(`  [warn] data-src/${name} 不存在，使用預設。`);
    return fallback;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const args = process.argv.slice(2);
const NO_CACHE = args.includes('--no-cache');
const IF_MISSING = args.includes('--if-missing');

const GMS_VERSION = 92; // 由 mob-bridge 覆蓋率實驗選定（v92=85%，v95 持平）
const RAW_BASE = 'https://raw.githubusercontent.com/a2983456456/artale-drop/main';
const MSIO = `https://maplestory.io/api/GMS/${GMS_VERSION}`;
const CONCURRENCY = 8;

// 顯示 minimap 的信心門檻（低於此仍寫入 maps.json，但 minimap_image=null 並列入 data_gaps）
const MIN_CONFIDENCE = 0.5;
const MIN_SUPPORT = 2;

// ---------- 小工具 ----------
const log = (...a) => console.log(...a);
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

if (IF_MISSING) {
  const need = ['monsters.json', 'items.json', 'maps.json', 'leveling.json'];
  const missing = need.some((f) => !fs.existsSync(path.join(OUT_DIR, f)));
  if (!missing) {
    log('[data] public/data 已存在，略過建置（--if-missing）。');
    process.exit(0);
  }
}

const cachePath = (key) => path.join(CACHE_DIR, key.replace(/[^a-z0-9._-]/gi, '_') + '.json');

async function fetchJson(url, cacheKey, { optional = false } = {}) {
  const cp = cachePath(cacheKey);
  if (!NO_CACHE && fs.existsSync(cp)) {
    return JSON.parse(fs.readFileSync(cp, 'utf8'));
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'artale-dropnmap-build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      fs.writeFileSync(cp, JSON.stringify(data));
      return data;
    } catch (err) {
      if (attempt === 3) {
        if (optional) {
          log(`  [warn] 抓取失敗（略過）: ${url} — ${err.message}`);
          return null;
        }
        throw new Error(`抓取失敗 ${url}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

// 併發池
async function pool(items, worker, concurrency = CONCURRENCY) {
  const results = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

// 由 mob 圖檔名取得 GMS mob id：'0100100.img.xml' -> '100100'
function mobIdFromImage(img) {
  const m = String(img || '').match(/^0*(\d+)\.img/);
  return m ? m[1] : null;
}

// 地圖 slug：以排序索引產生穩定短 id
function makeMapId(index) {
  return 'map_' + String(index).padStart(4, '0');
}

// ---------- 主流程 ----------
log(`[data] 建置開始（GMS v${GMS_VERSION}${NO_CACHE ? ', 不使用快取' : ''}）`);

// 1) 抓取來源
const [dropData, mobRaw, mapRaw, itemRaw, aliasRaw, areaRaw, bossTime] = await Promise.all([
  fetchJson(`${RAW_BASE}/drop_data.json`, 'src_drop_data'),
  fetchJson(`${RAW_BASE}/mob.json`, 'src_mob'),
  fetchJson(`${RAW_BASE}/map.json`, 'src_map'),
  fetchJson(`${RAW_BASE}/item.json`, 'src_item'),
  fetchJson(`${RAW_BASE}/alias.json`, 'src_alias'),
  fetchJson(`${RAW_BASE}/area.json`, 'src_area'),
  fetchJson(`${RAW_BASE}/boss_time.json`, 'src_boss_time'),
]);
log('[data] 來源抓取完成。');

// GMS 對照表（用於 id 驗證與英文名）
const gmsMobList = await fetchJson(`${MSIO}/mob`, 'gms_mob_list');
const gmsMapList = await fetchJson(`${MSIO}/map`, 'gms_map_list');
const gmsMobIds = new Set(gmsMobList.map((m) => String(m.id)));
const gmsMapById = new Map(gmsMapList.map((m) => [String(m.id), m]));
log(`[data] GMS 對照: mobs=${gmsMobList.length}, maps=${gmsMapList.length}`);

// artale-drop image/ 資料夾（以「怪物名.png」命名）→ 補 GMS 沒有的自訂怪圖
const artaleTree = await fetchJson(
  'https://api.github.com/repos/a2983456456/artale-drop/git/trees/main?recursive=1',
  'artale_tree', { optional: true }
);
const artaleImgNames = new Set(
  (artaleTree && artaleTree.tree ? artaleTree.tree : [])
    .filter((t) => t.path.startsWith('image/') && t.path.endsWith('.png'))
    .map((t) => t.path.slice(6, -4))
);
log(`[data] artale image/ 名稱數: ${artaleImgNames.size}`);
// 三層圖片解析：GMS icon > artale png > null（占位剪影 + 記入 missing_images）
function resolveIcon(name, gmsId) {
  if (gmsId && gmsMobIds.has(gmsId)) return `${MSIO}/mob/${gmsId}/icon`;
  if (artaleImgNames.has(name)) return `${RAW_BASE}/image/${encodeURIComponent(name)}.png`;
  return null;
}

// 2) 清洗 mob.json —— 去空鍵、去除前後空白（含全形空白），並合併去空白後撞名者
const mobFields = ['level', 'hp', 'mp', 'exp', 'evasion', 'pdef', 'mdef'];
const monsters = {}; // name -> record
const cleanedNames = new Map(); // rawKey -> cleanName（供 drop/map 對照）
const JUNK_EXACT = new Set(['abc]']); // 明確的髒怪名單
const skippedTestMobs = [];
for (const rawKey of Object.keys(mobRaw)) {
  const name = normalizeName(rawKey);
  if (!name) continue; // 剔除空字串 key
  // 剔除測試/除錯用怪、純符號無字名（如「.」）、明確髒名（如 abc]）
  if (/test|測試/i.test(name) || !/[\p{L}\p{N}]/u.test(name) || JUNK_EXACT.has(name)) {
    skippedTestMobs.push(name); continue;
  }
  cleanedNames.set(rawKey, name);
  const row = mobRaw[rawKey];
  const image = row[8] || '';
  const gmsId = mobIdFromImage(image);
  const rec = {
    name,
    id: gmsId && gmsMobIds.has(gmsId) ? gmsId : null,
    gms_mob_id_raw: gmsId, // 保留原始（即使 GMS 版本無此怪）供人工參考
    level: num(row[0]),
    hp: num(row[1]),
    mp: num(row[2]),
    exp: num(row[3]),
    evasion: num(row[4]),
    pdef: num(row[5]),
    mdef: num(row[6]),
    accuracy_required: parseAccuracy(row[7]),
    accuracy_raw: row[7] ?? '',
    // 來源第 10 欄名為「備註」，實為元素抗性代碼（F/I/L/S/H + 等級，例 F2I3）。
    // v1 原樣保留，不解碼、不顯示；v2 可解析成屬性抗性標示。
    element_codes: row.length > 9 ? row[9] || '' : '',
    image,
    icon: resolveIcon(name, gmsId), // GMS icon > artale png > null
    maps: [],
    drops: [],
  };
  // 若清洗後撞名（例：緞帶肥肥　→ 緞帶肥肥），保留先出現者，資訊擇優補齊
  if (monsters[name]) {
    const ex = monsters[name];
    if (ex.id == null && rec.id != null) monsters[name] = { ...rec, ...pickFilled(ex) };
  } else {
    monsters[name] = rec;
  }
}
log(`[data] 清洗後怪物數: ${Object.keys(monsters).length}（原始 key ${Object.keys(mobRaw).length}，剔除測試怪 ${skippedTestMobs.length}：${skippedTestMobs.join('、')}）`);

// 3) items.json —— 反轉 item.json（id→name 變 name→id），解析 drop 名稱
const nameToItemId = new Map();
for (const [id, nm] of Object.entries(itemRaw)) {
  if (!nameToItemId.has(nm)) nameToItemId.set(nm, id);
}
const items = {}; // id -> record
function ensureItem(itemId, name) {
  if (!items[itemId]) items[itemId] = { id: itemId, name, aliases: [], dropped_by: [] };
  return items[itemId];
}
// 物品別名（alias.json 為 別名→正式名；反查後掛到該物品）
const aliasesByOfficialName = new Map();
for (const [alias, official] of Object.entries(aliasRaw)) {
  if (!aliasesByOfficialName.has(official)) aliasesByOfficialName.set(official, []);
  aliasesByOfficialName.get(official).push(alias);
}

const unresolvedDropNames = new Set();
for (const [rawMob, dropList] of Object.entries(dropData)) {
  const mobName = cleanedNames.get(rawMob) || normalizeName(rawMob);
  const mon = monsters[mobName];
  if (!mon) continue;
  for (const dropName of dropList) {
    let itemId = nameToItemId.get(dropName);
    if (!itemId) {
      itemId = 'custom:' + dropName; // 無 id 的掉落物（錢袋、催化劑、製法…）給合成 id
      unresolvedDropNames.add(dropName);
    }
    const it = ensureItem(itemId, dropName);
    if (!mon.drops.includes(itemId)) mon.drops.push(itemId);
    if (!it.dropped_by.includes(mobName)) it.dropped_by.push(mobName);
  }
}
// 補上別名
for (const it of Object.values(items)) {
  const al = aliasesByOfficialName.get(it.name);
  if (al) it.aliases = al;
}
log(`[data] 物品數: ${Object.keys(items).length}（無 id 掉落物 ${unresolvedDropNames.size} 個以 custom: 前綴保留）`);

// 4) 地圖：反轉 map.json（mob→{mapName}）為 mapName→mobs，解析區域
// 區域開放狀態（data-src/region_status.json）：closed 全站排除、unknown 標註、未列視為 unknown
const regionStatusSrc = readSrc('region_status.json', { open: [], closed: [], unknown: [] });
const openSet = new Set(regionStatusSrc.open);
const closedSet = new Set(regionStatusSrc.closed);
const unknownSet = new Set(regionStatusSrc.unknown);
const unlistedRegions = new Set();
const regionOf = (mapName) => (mapName.includes('：') ? mapName.split('：')[0].trim() : '其他');
function regionStatus(region) {
  if (openSet.has(region)) return 'open';
  if (closedSet.has(region)) return 'closed';
  if (unknownSet.has(region)) return 'unknown';
  unlistedRegions.add(region); // 表中沒有的新前綴 → 視為 unknown 並記入 data_gaps
  return 'unknown';
}
// 單圖黑名單（開放前綴下的活動殘留）；比對前去除所有全形/半形空白（上游有冒號後帶空白的髒 key）
const collapseWs = (s) => String(s).replace(/[\s　]/g, '');
const closedMapsSet = new Set((regionStatusSrc.closed_maps || []).map(collapseWs));
// 過濾順序：前綴檢查 → closed_maps 精確比對
function isClosedMap(clean) {
  if (regionStatus(regionOf(clean)) === 'closed') return true;
  if (closedMapsSet.has(collapseWs(clean))) return true;
  return false;
}

const mobsByMapName = new Map(); // mapName -> Set(mobName)
const mobHadClosedMap = new Set(); // 曾出沒於 closed 區域/黑名單圖（供「所在區域未開放」提示）
for (const [rawMob, mapObj] of Object.entries(mapRaw)) {
  const mobName = cleanedNames.get(rawMob) || normalizeName(rawMob);
  if (!monsters[mobName]) continue;
  for (const mapName of Object.keys(mapObj)) {
    const clean = String(mapName).replace(/　/g, ' ').trim();
    if (isClosedMap(clean)) {
      mobHadClosedMap.add(mobName); // 關閉區域或黑名單活動圖 → 全站排除，但記住這隻怪
      continue;
    }
    if (!mobsByMapName.has(clean)) mobsByMapName.set(clean, new Set());
    mobsByMapName.get(clean).add(mobName);
  }
}
const allCleanMapNames = [...new Set(
  Object.values(mapRaw).flatMap((o) => Object.keys(o).map((n) => String(n).replace(/　/g, ' ').trim()))
)];
const excludedClosedMaps = allCleanMapNames.filter((n) => regionStatus(regionOf(n)) === 'closed').length;
const excludedBlacklistMaps = allCleanMapNames.filter(
  (n) => regionStatus(regionOf(n)) !== 'closed' && closedMapsSet.has(collapseWs(n))
).length;
log(`[data] 排除關閉區域地圖: ${excludedClosedMaps} 張 + 單圖黑名單: ${excludedBlacklistMaps} 張`);

// 4b) 修正層：套用 data-src/map_overrides.json（抓取上游後、建索引前）
//     add_mobs 補進對應地圖；上游更新不會覆蓋這些人工修正。
const mapOverrides = readSrc('map_overrides.json', { maps: {} });
const overrideReport = [];
const regionOverride = new Map(); // 新建地圖用；mapName -> region
let createdCount = 0;
for (const [mapName, ov] of Object.entries(mapOverrides.maps || {})) {
  const clean = String(mapName).replace(/　/g, ' ').trim();
  const ovRegion = ov.region || regionOf(clean);
  if (regionStatus(ovRegion) === 'closed' || closedMapsSet.has(collapseWs(clean))) {
    log(`  [warn] override 目標地圖屬關閉區域/黑名單，略過：「${clean}」`);
    overrideReport.push({ map: clean, skipped: true, reason: '關閉區域或單圖黑名單' });
    continue;
  }
  let created = false;
  if (!mobsByMapName.has(clean)) {
    if (ov.create_if_missing) {
      // 上游完全沒有這張圖 → 新建地圖節點（region 以 override 為準，否則由名稱推導）
      mobsByMapName.set(clean, new Set());
      const region = ov.region || (clean.includes('：') ? clean.split('：')[0].trim() : '其他');
      regionOverride.set(clean, region);
      created = true;
      createdCount++;
    } else {
      log(`  [warn] override 目標地圖不存在且未設 create_if_missing，略過：「${clean}」`);
      overrideReport.push({ map: clean, skipped: true, reason: '地圖不存在且未 create_if_missing' });
      continue;
    }
  }
  const added = [];
  const missing = [];
  for (const mob of ov.add_mobs || []) {
    if (!monsters[mob]) { missing.push(mob); continue; }
    if (!mobsByMapName.get(clean).has(mob)) { mobsByMapName.get(clean).add(mob); added.push(mob); }
  }
  overrideReport.push({ map: clean, created, added, missing, verified_by: ov.verified_by, note: ov.note });
  if (missing.length) log(`  [warn] override「${clean}」有不存在的怪物: ${missing.join('、')}`);
}
log(`[data] 套用地圖修正: ${overrideReport.filter((r) => !r.skipped).length} 張圖（新建 ${createdCount}），補進 ${overrideReport.reduce((n, r) => n + (r.added ? r.added.length : 0), 0)} 筆怪物`);

const mapNames = [...mobsByMapName.keys()].sort();
log(`[data] 相異地圖名: ${mapNames.length}`);

// 5) mob-bridge：抓取需要的怪物 foundAt（GMS 地圖 id 清單），做投票用
const bridgeMobs = new Set(); // 出現在 map.json 且可對應 GMS mob id 的怪物名
for (const set of mobsByMapName.values()) {
  for (const mobName of set) {
    const mon = monsters[mobName];
    if (mon && mon.id) bridgeMobs.add(mobName);
  }
}
const bridgeList = [...bridgeMobs];
log(`[data] 需抓 foundAt 的怪物: ${bridgeList.length}（快取於 scripts/.cache）`);
const foundAtByMob = new Map(); // mobName -> Set(gmsMapId)
await pool(bridgeList, async (mobName) => {
  const gmsId = monsters[mobName].id;
  const detail = await fetchJson(`${MSIO}/mob/${gmsId}`, `gms_mob_${gmsId}`, { optional: true });
  const found = detail && Array.isArray(detail.foundAt) ? detail.foundAt.map(String) : [];
  foundAtByMob.set(mobName, new Set(found));
});

// 6) 投票交叉配對：每個中文地圖名 → 最可能的 GMS map id + 信心分數
const maps = {};
const mapNameToId = new Map();
const lowConfidenceMaps = [];
const scored = []; // 第一輪暫存，第二輪再驗證 minimap 是否存在
mapNames.forEach((mapName, i) => {
  const mapId = makeMapId(i + 1);
  mapNameToId.set(mapName, mapId);
  const region = regionOverride.get(mapName) || (mapName.includes('：') ? mapName.split('：')[0].trim() : '其他');

  const mobSet = mobsByMapName.get(mapName);
  const bridgeable = [...mobSet].filter((m) => foundAtByMob.has(m));
  const votes = new Map();
  for (const m of bridgeable) {
    for (const g of foundAtByMob.get(m)) votes.set(g, (votes.get(g) || 0) + 1);
  }
  let bestId = null, support = 0, second = 0;
  for (const [g, v] of votes) {
    if (v > support) { second = support; support = v; bestId = g; }
    else if (v > second) second = v;
  }
  const denom = bridgeable.length || 1;
  const confidence = bridgeable.length ? +(support / denom).toFixed(3) : null;
  const margin = bridgeable.length ? +((support - second) / denom).toFixed(3) : null;
  const valid = bestId && gmsMapById.has(bestId);
  const scoreOk = valid && confidence != null && confidence >= MIN_CONFIDENCE && support >= MIN_SUPPORT;
  scored.push({ mapId, mapName, region, mobSet, bestId, valid, scoreOk, confidence, support, margin, bridgeable: bridgeable.length });
});

// 6b) 人工權威配對來源（data-src/map_gms_ids.json）：投票後覆蓋。
//     先把要覆蓋的 GMS id 併入 minimap/neighbors 抓取清單，確保覆蓋後衍生資料齊全。
const mapGmsSrc = readSrc('map_gms_ids.json', { maps: {} });
const mapGmsEntries = mapGmsSrc.maps || {};
const GMS_ADOPT = new Set(['verified', 'name-high', 'manual']);
const overrideFetchIds = [...new Set(
  Object.values(mapGmsEntries).filter((e) => GMS_ADOPT.has(e.confidence) && e.gms_map_id != null).map((e) => String(e.gms_map_id))
)];

// 驗證通過分數門檻的候選 GMS id 是否真的有 minimap（map list 含無資料的殘缺 id）；併入人工覆蓋目標 id
const candidateIds = [...new Set([...scored.filter((s) => s.scoreOk).map((s) => s.bestId), ...overrideFetchIds])];
log(`[data] 驗證 minimap 可用性: ${candidateIds.length} 個候選 GMS 地圖（含人工覆蓋目標 ${overrideFetchIds.length}）`);
const mapDetailById = new Map(); // gmsId -> { hasMinimap, neighbors:[gmsId] }
await pool(candidateIds, async (gmsId) => {
  const d = await fetchJson(`${MSIO}/map/${gmsId}`, `gms_map_${gmsId}`, { optional: true });
  const hasMinimap = !!(d && d.name && d.miniMap);
  const neighbors = d && Array.isArray(d.portals)
    ? [...new Set(d.portals.filter((p) => p && p.toMap != null).map((p) => String(p.toMap)).filter((t) => t && t !== '999999999'))]
    : [];
  mapDetailById.set(gmsId, { hasMinimap, neighbors });
});

// 路線走法（人工維護於 data-src/routes.json）：destination 精確或 dest_maps_prefix 前綴匹配
const routesSrc = readSrc('routes.json', { routes: [] });
const routeList = routesSrc.routes || [];
function matchRoute(mapName) {
  for (const r of routeList) {
    if (r.destination && r.destination === mapName) return r;
    if (r.dest_maps_prefix && mapName.startsWith(r.dest_maps_prefix)) return r;
  }
  return null;
}
let routesAttached = 0;

// 第二輪：組出 maps.json
for (const s of scored) {
  const gmsMap = s.valid ? gmsMapById.get(s.bestId) : null;
  const detail = s.scoreOk ? mapDetailById.get(s.bestId) : null;
  const hasMinimap = !!(detail && detail.hasMinimap);
  const route = matchRoute(s.mapName);
  if (route) routesAttached++;
  maps[s.mapId] = {
    id: s.mapId,
    name: s.mapName,
    region: s.region,
    region_status: regionStatus(s.region), // 'open' | 'unknown'（closed 已排除）
    mobs: [...s.mobSet].sort().map((mob) => ({ mob })), // 交叉參照存怪物名
    // maplestory.io 配對結果（無論信心高低都保留，供人工校對 / v2 路徑沿用）
    gms_map_id: s.valid ? s.bestId : null,
    gms_map_name: gmsMap ? gmsMap.name : null,
    gms_street_name: gmsMap ? gmsMap.streetName : null,
    match_confidence: s.confidence,
    match_support: s.support,
    match_margin: s.margin,
    match_bridgeable: s.bridgeable,
    gms_has_minimap: hasMinimap,
    // v1：分數達標且該 GMS 地圖確實有 minimap 才給圖
    minimap_image: hasMinimap ? `${MSIO}/map/${s.bestId}/minimap` : null,
    // 「怎麼走」步驟（人工路線），無則 null
    route: route ? { steps: route.steps, source_url: route.source_url } : null,
    neighbors: [], // v1 留空（本站 map id）；v2 由下方 gms_neighbors 反查填入
    gms_neighbors: detail ? detail.neighbors : [], // 原始 GMS 相鄰 id，供 v2 沿用
  };
  if (!hasMinimap) {
    lowConfidenceMaps.push({
      map: s.mapName, region: s.region, gms_map_id: s.valid ? s.bestId : null,
      gms_map_name: gmsMap ? gmsMap.name : null,
      confidence: s.confidence, support: s.support, bridgeable: s.bridgeable,
      reason: !s.bridgeable ? '無可橋接怪物'
        : !s.valid ? '無有效 GMS map id'
        : !s.scoreOk ? '信心不足'
        : 'GMS 此版本無 minimap 資料',
    });
  }
}

// 6c) 套用人工權威配對（monster-vote 之後、patch 之前）
//     adopt(verified/name-high/manual)→覆蓋投票並重算所有 GMS 衍生欄位；
//     region-exclusive→清空 GMS 配對、不標配對失敗；needs-review→忽略(維持投票)。
const mapGmsReport = { applied: 0, noop: 0, region_exclusive: 0, needs_review: 0, target_missing: 0, changes: [] };
function deriveGms(mp, gmsId) {
  // 依新 id 重算所有 GMS 衍生欄位，不殘留舊 id 資料
  const gmsMap = gmsMapById.get(String(gmsId)) || null;
  const detail = mapDetailById.get(String(gmsId)) || null;
  const hasMinimap = !!(detail && detail.hasMinimap);
  mp.gms_map_id = String(gmsId);
  mp.gms_map_name = gmsMap ? gmsMap.name : null;
  mp.gms_street_name = gmsMap ? gmsMap.streetName : null;
  mp.gms_has_minimap = hasMinimap;
  mp.minimap_image = hasMinimap ? `${MSIO}/map/${gmsId}/minimap` : null;
  mp.gms_neighbors = detail ? detail.neighbors : [];
}
for (const [mapName, e] of Object.entries(mapGmsEntries)) {
  const mapId = mapNameToId.get(mapName);
  if (!mapId || !maps[mapId]) { mapGmsReport.target_missing++; mapGmsReport.changes.push({ map: mapName, action: 'target_missing' }); continue; }
  const mp = maps[mapId];
  if (e.confidence === 'needs-review') { mapGmsReport.needs_review++; continue; }
  if (e.confidence === 'region-exclusive') {
    // 清空 GMS 配對（覆蓋任何錯誤投票），標記為區域獨佔而非配對失敗
    Object.assign(mp, {
      gms_map_id: null, gms_map_name: null, gms_street_name: null, gms_has_minimap: false,
      minimap_image: null, gms_neighbors: [], match_confidence: null, match_support: 0, match_margin: null,
      region_exclusive: true, gms_match_source: 'region-exclusive',
    });
    mapGmsReport.region_exclusive++;
    continue;
  }
  if (GMS_ADOPT.has(e.confidence) && e.gms_map_id != null) {
    const before = mp.gms_map_id;
    if (String(before) === String(e.gms_map_id)) { mapGmsReport.noop++; mp.gms_match_source = e.confidence; continue; }
    deriveGms(mp, e.gms_map_id);
    mp.match_confidence = null; mp.match_margin = null; // 非投票結果，清掉投票信心避免誤讀
    mp.gms_match_source = e.confidence;
    mapGmsReport.applied++;
    mapGmsReport.changes.push({ map: mapName, from: before, to: mp.gms_map_id, gms_name: mp.gms_map_name, minimap: mp.gms_has_minimap, source: e.confidence });
  }
}
log(`[data] 人工權威配對: 覆蓋 ${mapGmsReport.applied}、no-op(與投票同) ${mapGmsReport.noop}、region-exclusive 分流 ${mapGmsReport.region_exclusive}、needs-review 忽略 ${mapGmsReport.needs_review}、對象缺失 ${mapGmsReport.target_missing}`);

// 回填 monsters.maps（存 mapId）
for (const [mapName, set] of mobsByMapName) {
  const mapId = mapNameToId.get(mapName);
  for (const mobName of set) {
    if (monsters[mobName] && !monsters[mobName].maps.includes(mapId)) {
      monsters[mobName].maps.push(mapId);
    }
  }
}
// 標記「只出沒於關閉區域」的怪（開放地圖為空、但曾有 closed 地圖）→ 供「所在區域未開放」提示
for (const m of Object.values(monsters)) {
  if (m.maps.length === 0 && mobHadClosedMap.has(m.name)) m.closed_region_only = true;
}
const confidentCount = Object.values(maps).filter((m) => m.minimap_image).length;
log(`[data] 地圖配對: ${confidentCount}/${mapNames.length} 有 minimap（信心≥${MIN_CONFIDENCE}）`);
log(`[data] 附加路線走法: ${routesAttached} 張圖`);

// 7) 練等推薦（人工維護於 data-src/leveling.json）
const leveling = readSrc('leveling.json', []);
// 驗證：type=map 的 map_name 是否存在於地圖集合；引用的怪物/掉落是否存在
const levelingIssues = [];
const allMapNamesSet = new Set(mapNames);
for (const rec of leveling) {
  if (rec.type === 'map') {
    if (!rec.map_name || !allMapNamesSet.has(rec.map_name))
      levelingIssues.push({ card: rec.display_name || rec.map_name, issue: `map_name 不在地圖集合：${rec.map_name}` });
    for (const mob of rec.alt_maps || [])
      if (!allMapNamesSet.has(mob)) levelingIssues.push({ card: rec.display_name, issue: `alt_map 不存在：${mob}` });
  }
  for (const mob of rec.mobs || [])
    if (!monsters[mob]) levelingIssues.push({ card: rec.display_name, issue: `怪物不存在：${mob}` });
}
if (levelingIssues.length) {
  log(`  [warn] 練等資料有 ${levelingIssues.length} 筆參照問題（見 data_gaps.leveling_issues）`);
} else {
  log(`[data] 練等推薦: ${leveling.length} 筆，參照全數對應。`);
}

// 7b) 怪物特殊行為標註（data-src/mob_overrides.json）：no_drops 等
const mobOverrides = readSrc('mob_overrides.json', { mobs: {} });
const mobOverrideReport = [];
for (const [mobName, ov] of Object.entries(mobOverrides.mobs || {})) {
  if (!monsters[mobName]) { log(`  [warn] mob_overrides「${mobName}」怪物不存在`); mobOverrideReport.push({ key: mobName, status: 'target_missing' }); continue; }
  const applied = [];
  if (ov.no_drops) { monsters[mobName].no_drops = true; applied.push('no_drops'); }
  if (ov.behavior_note) { monsters[mobName].behavior_note = ov.behavior_note; applied.push('behavior_note'); }
  mobOverrideReport.push({ key: mobName, status: applied.length ? 'applied' : 'noop', detail: applied.join('+') });
}
log(`[data] 套用怪物行為標註: ${mobOverrideReport.filter((r) => r.status === 'applied').length} 筆`);

// 7c) L3 patch 資料層（data-src/patches/）——最後套用、優先度最高，覆蓋 L1 上游 + L2 補全。
//     以最終 monsters/items/maps 為對象做 add/override/remove，不擾動既有管線 → 零破壞。
let patchMapSeq = 0;
function monsterTemplate(name) {
  return {
    name, id: null, level: 0, hp: 0, mp: 0, exp: 0, evasion: 0, pdef: 0, mdef: 0,
    accuracy_required: 0, accuracy_raw: '', element_codes: '', image: '', icon: null, maps: [], drops: [],
  };
}
function resolveItemIdByName(name) {
  const itemId = nameToItemId.get(name) || 'custom:' + name;
  ensureItem(itemId, name);
  return itemId;
}
function createMap(name, fields) {
  const id = 'map_patch_' + String(++patchMapSeq).padStart(3, '0');
  const region = fields.region || (name.includes('：') ? name.split('：')[0].trim() : '其他');
  const mp = {
    id, name, region, region_status: regionStatus(region),
    mobs: [], gms_map_id: null, gms_map_name: null, gms_street_name: null,
    match_confidence: null, match_support: 0, match_margin: null, match_bridgeable: 0,
    gms_has_minimap: false, minimap_image: null, route: null, neighbors: [], gms_neighbors: [],
    ...fields,
  };
  maps[id] = mp;
  mapNameToId.set(name, id);
  return mp;
}
function linkMonsterToMap(monsterName, mapName) {
  const m = monsters[monsterName];
  if (!m) { log(`  [warn] patch: 無法把不存在的怪物「${monsterName}」掛到地圖「${mapName}」`); return; }
  let mp = mapNameToId.has(mapName) ? maps[mapNameToId.get(mapName)] : null;
  if (!mp) mp = createMap(mapName, {});
  if (!mp.mobs.some((x) => x.mob === monsterName)) mp.mobs.push({ mob: monsterName });
  if (!m.maps.includes(mp.id)) m.maps.push(mp.id);
}

const patches = loadPatches(path.join(DATA_SRC, 'patches'));
const patchReport = [];
applyPatches(
  { monsters, items, maps, mapNameToId, monsterTemplate, resolveItemIdByName, linkMonsterToMap, createMap },
  patches, patchReport
);
// 既有 override 檔以 adapter 併入同一報告（不改其套用行為，僅讓報告涵蓋新舊修正）
adaptLegacyReports({ mobOverrideReport, mapOverrideReport: overrideReport }, patchReport);
const patchSummary = summarizeReport(patchReport);
log(`[data] Patch 套用: 共 ${patchSummary.total} 筆（生效 ${patchSummary.applied}、no-op ${patchSummary.noop}、對象缺失 ${patchSummary.target_missing}、略過 ${patchSummary.skipped}）`);
if (patchSummary.removable.length) log(`  [info] 可清理（上游已相符，可刪 patch）: ${patchSummary.removable.map((r) => `${r.source}:${r.key}`).join('、')}`);
if (patchSummary.unresolved.length) log(`  [warn] patch 對象缺失（key 打錯或上游改名?）: ${patchSummary.unresolved.map((r) => `${r.source}:${r.key}`).join('、')}`);

// 8) data_gaps 報告
const monsterList = Object.values(monsters);
const missingImages = monsterList.filter((m) => !m.icon).map((m) => m.name).sort();
log(`[data] 缺圖怪物（占位剪影）: ${missingImages.length}`);
// 圖卡牆隱藏放寬監測：舊規則(無圖且無掉落)會藏、但新規則因 is_boss 或 drops_note 而顯示者。
// 供人工把關——若某次 patch 讓此數暴增（>20），代表可能灌入大量僅有註記的殘缺條目，需複查。
const wallNewlyShown = monsterList
  .filter((m) => m.drops.length === 0 && m.maps.length === 0 && (m.is_boss || m.drops_note))
  .map((m) => m.name).sort();
log(`[data] 圖卡牆放寬新增顯示（is_boss/drops_note）: ${wallNewlyShown.length}${wallNewlyShown.length ? `（${wallNewlyShown.join('、')}）` : ''}${wallNewlyShown.length > 20 ? ' ⚠️ 超過 20，請人工複查' : ''}`);
// 開放狀態未確認（unknown + 表中未列的新前綴）
const unknownMapList = Object.values(maps).filter((m) => m.region_status === 'unknown');
const unknownRegionsPresent = [...new Set(unknownMapList.map((m) => m.region))].sort();
const regionUnconfirmed = {
  unknown_regions: unknownRegionsPresent,
  unlisted_regions: [...unlistedRegions].sort(), // 表中沒有的新前綴（req 4）
  maps: unknownMapList.map((m) => m.name).sort(),
};
// 活動地圖候選：隱藏地圖前綴、整圖每隻怪都無掉落、且未列入黑名單（在索引中即代表未黑名單）→ 供人工複查
const eventMapCandidates = Object.values(maps)
  .filter((m) => m.region === '隱藏地圖' && m.mobs.length > 0
    && m.mobs.every((x) => (monsters[x.mob] ? monsters[x.mob].drops.length : 0) === 0))
  .map((m) => m.name).sort();
log(`[data] 活動地圖候選（待人工複查）: ${eventMapCandidates.length}`);
log(`[data] 區域開放未確認: ${unknownRegionsPresent.length} 區、${unknownMapList.length} 圖；未列前綴: ${[...unlistedRegions].join('、') || '無'}`);
const gaps = {
  generated_at_note: '由 build-data.mjs 產出；日期見檔案 mtime',
  gms_version: GMS_VERSION,
  summary: {
    monsters_total: monsterList.length,
    monsters_missing_drops: monsterList.filter((m) => m.drops.length === 0).length,
    monsters_missing_maps: monsterList.filter((m) => m.maps.length === 0).length,
    monsters_no_gms_bridge: monsterList.filter((m) => m.id == null).length,
    maps_total: mapNames.length,
    maps_with_minimap: confidentCount,
    maps_low_confidence: lowConfidenceMaps.length,
    unresolved_drop_item_names: unresolvedDropNames.size,
    map_overrides_applied: overrideReport.length,
    leveling_cards: leveling.length,
    leveling_issues: levelingIssues.length,
    missing_images: missingImages.length,
    excluded_closed_maps: excludedClosedMaps,
    excluded_blacklist_maps: excludedBlacklistMaps,
    region_unknown: unknownRegionsPresent.length,
    region_unlisted: unlistedRegions.size,
    event_map_candidates: eventMapCandidates.length,
    patches_total: patchSummary.total,
    patches_applied: patchSummary.applied,
    patches_noop: patchSummary.noop,
    patches_target_missing: patchSummary.target_missing,
    map_gms_override_applied: mapGmsReport.applied,
    map_gms_override_noop: mapGmsReport.noop,
    map_gms_region_exclusive: mapGmsReport.region_exclusive,
    map_gms_needs_review: mapGmsReport.needs_review,
    wall_newly_shown: wallNewlyShown.length,
  },
  missing_images: missingImages,
  wall_newly_shown: wallNewlyShown,
  map_gms_override: mapGmsReport,
  patch_summary: patchSummary,
  patch_report: patchReport,
  region_unconfirmed: regionUnconfirmed,
  event_map_candidates: eventMapCandidates,
  map_overrides_applied: overrideReport,
  leveling_issues: levelingIssues,
  monsters_missing_drops: monsterList.filter((m) => m.drops.length === 0).map((m) => m.name).sort(),
  monsters_missing_maps: monsterList.filter((m) => m.maps.length === 0).map((m) => m.name).sort(),
  monsters_no_gms_bridge: monsterList
    .filter((m) => m.id == null)
    .map((m) => ({ name: m.name, raw_id: m.gms_mob_id_raw })),
  maps_low_confidence: lowConfidenceMaps,
  unresolved_drop_item_names: [...unresolvedDropNames].sort(),
};

// 清掉 monsters 內部暫存欄位
for (const m of monsterList) delete m.gms_mob_id_raw;

// 9) 怪物俗稱別名已併入統一 data-src/aliases.json（monster 區），mob_alias.json 已淘汰。
const skillBuilds = {
  _note: '技能點法，v1 不實作內容；預留空結構與隱藏頁籤。',
  builds: [],
};

// 地圖俗稱別名（人工維護），驗證正式名（片語）是否命中任一地圖
const mapAlias = readSrc('map_alias.json', { aliases: {} });
for (const [alias, canon] of Object.entries(mapAlias.aliases || {})) {
  const hit = mapNames.some((n) => n.includes(canon));
  if (!hit) log(`  [warn] map_alias「${alias}」的正式名片語未命中任何地圖：${canon}`);
}

// 9c) 統一別名（data-src/aliases.json：canonical → 別名陣列，涵蓋 monster/item/map）
const aliasesSrc = readSrc('aliases.json', { monster: {}, item: {}, map: {} });
const itemByName = new Map(Object.values(items).map((it) => [it.name, it]));
const mapByFullName = new Map(Object.values(maps).map((m) => [m.name, m]));
const aliasIssues = [];
for (const canon of Object.keys(aliasesSrc.monster || {})) if (!monsters[canon]) aliasIssues.push({ type: 'monster', canonical: canon });
for (const canon of Object.keys(aliasesSrc.item || {})) if (!itemByName.has(canon)) aliasIssues.push({ type: 'item', canonical: canon });
for (const canon of Object.keys(aliasesSrc.map || {})) if (!mapByFullName.has(canon)) aliasIssues.push({ type: 'map', canonical: canon });
if (aliasIssues.length) log(`  [warn] aliases.json 有 ${aliasIssues.length} 筆 canonical 不存在：${aliasIssues.map((a) => a.canonical).join('、')}`);
gaps.alias_issues = aliasIssues;
gaps.summary.alias_issues = aliasIssues.length;

// 11) 預建搜尋索引（search_index.json）——build time 產出，含 opencc 簡體變體。
// 前端載入後直接在記憶體查詢，不在輸入時重建索引。別名合併進同一實體、不產生重複條目。
const mapAliasPairs = Object.entries(mapAlias.aliases || {});
const simpOf = (s) => normalize(toSimp(s));
const joinNorm = (arr) => [...new Set(arr.filter(Boolean).map(normalize))].join(' ');
const joinSimp = (arr) => [...new Set(arr.filter(Boolean).map(simpOf))].join(' ');
// 只在簡體與正規化結果不同時才寫入 simp 欄位，省體積（純繁中或英數的名稱 simp === norm 就省略）
const simpField = (name, normVal) => { const s = simpOf(name); return s === normVal ? '' : s; };

const searchDocs = [];
for (const m of Object.values(monsters)) {
  const aliases = aliasesSrc.monster?.[m.name] || [];
  const norm = normalize(m.name);
  const aliasNorm = joinNorm(aliases);
  const aliasSimp = joinSimp(aliases);
  searchDocs.push({
    type: 'monster', key: m.name, name: m.name, norm, simp: simpField(m.name, norm),
    alias_norm: aliasNorm, alias_simp: aliasSimp === aliasNorm ? '' : aliasSimp, level: m.level,
  });
}
for (const it of Object.values(items)) {
  const aliases = [...(it.aliases || []), ...(aliasesSrc.item?.[it.name] || [])];
  const norm = normalize(it.name);
  const aliasNorm = joinNorm(aliases);
  const aliasSimp = joinSimp(aliases);
  searchDocs.push({
    type: 'item', key: it.id, name: it.name, norm, simp: simpField(it.name, norm),
    alias_norm: aliasNorm, alias_simp: aliasSimp === aliasNorm ? '' : aliasSimp, dropCount: (it.dropped_by || []).length,
  });
}
for (const mp of Object.values(maps)) {
  const aliasTerms = [...(aliasesSrc.map?.[mp.name] || [])];
  for (const [alias, canon] of mapAliasPairs) if (mp.name.includes(canon)) aliasTerms.push(alias);
  const norm = normalize(mp.name);
  const aliasNorm = joinNorm(aliasTerms);
  const aliasSimp = joinSimp(aliasTerms);
  searchDocs.push({
    type: 'map', key: mp.id, name: mp.name, norm, simp: simpField(mp.name, norm),
    alias_norm: aliasNorm, alias_simp: aliasSimp === aliasNorm ? '' : aliasSimp, region: mp.region, mobCount: (mp.mobs || []).length,
  });
}
log(`[data] 預建搜尋索引: ${searchDocs.length} 筆（含簡體變體 ${searchDocs.filter((d) => d.simp).length}）`);

// 10) 寫出
const writeJson = (name, data) => {
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data));
  log(`  ✓ ${name}`);
};
writeJson('monsters.json', monsters);
writeJson('items.json', items);
writeJson('maps.json', maps);
writeJson('leveling.json', leveling);
writeJson('map_alias.json', mapAlias);
writeJson('map_gms_ids.json', mapGmsSrc);
writeJson('aliases.json', aliasesSrc);
writeJson('search_index.json', searchDocs);
writeJson('mob_overrides.json', mobOverrides);
writeJson('region_status.json', regionStatusSrc);
writeJson('skill_builds.json', skillBuilds);
writeJson('area.json', areaRaw);
writeJson('boss_time.json', bossTime || {});
writeJson('data_gaps.json', gaps);

// meta（給前端顯示資料來源版本）
writeJson('meta.json', {
  gms_version: GMS_VERSION,
  built_at: Date.now(), // 資料版本；前端用來 cache-bust 大型 JSON（重建才失效）
  counts: gaps.summary,
  open_regions: regionStatusSrc.open, // 依玩家等級動線排序，供區域下拉
  sources: {
    drop: `${RAW_BASE}/drop_data.json`,
    maplestory_io: MSIO,
  },
});

log('[data] 完成。');

// ---------- 輔助函式 ----------
function normalizeName(raw) {
  // 只做「顯示層」的空白清理（保留原字，不做異體字歸一 —— 那是搜尋層的事）
  return String(raw).replace(/　/g, ' ').trim();
}
// 單一數值段清洗：
//   "?"            → 0（未知）
//   "130萬"        → 1300000（萬=1e4、億=1e8）
//   "461000\n(+…)" → 取首段數字 461000（去掉換行/括號後的加成）
function parseOne(seg) {
  if (typeof seg === 'number') return Number.isFinite(seg) ? seg : 0;
  let s = String(seg ?? '').trim();
  if (!s || s === '?') return 0;
  s = s.split(/[\n(]/)[0].trim();
  const hasWan = /萬/.test(s);
  const hasYi = /億/.test(s);
  const digits = s.replace(/[^\d.]/g, '');
  if (!digits) return 0;
  let n = parseFloat(digits);
  if (hasYi) n *= 1e8;
  else if (hasWan) n *= 1e4;
  return Math.round(n);
}
// 數值欄位清洗：斜線＝「型態一/型態二」，解析成陣列保留兩值；其餘回傳單一數字。
//   "800/700"       → [800, 700]
//   "5375萬 / 1250萬" → [53750000, 12500000]
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if (s.includes('/')) {
    const parts = s.split('/').map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) return parts.map(parseOne);
  }
  return parseOne(s);
}
function parseAccuracy(s) {
  const m = String(s ?? '').match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}
function pickFilled(rec) {
  const out = {};
  for (const k of mobFields) if (rec[k]) out[k] = rec[k];
  return out;
}
