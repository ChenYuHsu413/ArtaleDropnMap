// L3 patch 資料層 —— 三層資料架構的最上層（永遠最後套用、優先度最高）。
//   L1 基底：上游 artale-drop 資料
//   L2 補全：maplestory.io（icon / foundAt / minimap）
//   L3 patch：data-src/patches/*.patch.json（本檔負責）
//
// 設計原則：
//   - 以「穩定 key」定位（怪物/地圖＝正規化前的正式名、物品＝itemId），不依賴陣列順序。
//   - 三種操作：add（新增上游沒有的實體）、override（覆蓋指定欄位）、remove（排除錯誤資料）。
//   - 作為「最終覆蓋層」套用在已建好的 monsters/items/maps 上，不擾動既有管線 → 零破壞。
//   - 產出套用報告：applied / noop（上游已相符，可刪）/ target_missing（找不到對象）/ skipped。
//
// patch 檔格式（依對象分檔，data-src/patches/ 下）：
//   monsters.patch.json / items.patch.json / maps.patch.json
//   { "_readme": "...",
//     "add":      { "<key>": { ...fields, drops?:[品名], maps?:[圖名] } },
//     "override": { "<key>": { <field>: <value> } },
//     "remove":   [ "<key>", ... ] }

import fs from 'node:fs';
import path from 'node:path';

const TARGET_FILES = {
  monster: 'monsters.patch.json',
  item: 'items.patch.json',
  map: 'maps.patch.json',
};

// 讀入 patches/ 目錄；缺目錄或缺檔皆回傳空結構（非錯誤）。
export function loadPatches(dir) {
  const out = { monster: empty(), item: empty(), map: empty() };
  if (!fs.existsSync(dir)) return out;
  for (const [target, file] of Object.entries(TARGET_FILES)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    out[target] = {
      add: raw.add || {},
      override: raw.override || {},
      remove: Array.isArray(raw.remove) ? raw.remove : [],
    };
  }
  return out;
}
const empty = () => ({ add: {}, override: {}, remove: [] });

// 深度相等（僅比對 patch 會用到的 JSON 純值 / 陣列 / 物件）
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// 套用所有 patch。ctx 提供對 live 結構的存取與建置管線共用的小工具。
//   ctx = { monsters, items, maps, mapNameToId, resolveItemIdByName, linkMonsterToMap, monsterTemplate }
// 回傳報告陣列（每筆一操作）。
export function applyPatches(ctx, patches, report = []) {
  applyMonsterPatches(ctx, patches.monster, report);
  applyItemPatches(ctx, patches.item, report);
  applyMapPatches(ctx, patches.map, report);
  return report;
}

function rec(report, entry) {
  report.push({ source: 'patches/', ...entry });
}

// ---------- monster ----------
function applyMonsterPatches(ctx, p, report) {
  const { monsters } = ctx;
  // remove 先做，避免與同批 add/override 互相干擾
  for (const key of p.remove) {
    if (!monsters[key]) { rec(report, { target: 'monster', op: 'remove', key, status: 'target_missing' }); continue; }
    delete monsters[key];
    // 清掉交叉參照
    for (const it of Object.values(ctx.items)) {
      const i = it.dropped_by.indexOf(key);
      if (i >= 0) it.dropped_by.splice(i, 1);
    }
    for (const mp of Object.values(ctx.maps)) {
      const before = mp.mobs.length;
      mp.mobs = mp.mobs.filter((x) => x.mob !== key);
      if (mp.mobs.length !== before) { /* 交叉參照已清 */ }
    }
    rec(report, { target: 'monster', op: 'remove', key, status: 'applied' });
  }

  for (const [key, fields] of Object.entries(p.add)) {
    if (monsters[key]) {
      // 上游（或 L2）已經有了 → add 變 no-op，提示可刪 patch 或改用 override
      rec(report, { target: 'monster', op: 'add', key, status: 'noop', detail: '上游已存在此怪物，可刪除此 add（或改為 override）' });
      continue;
    }
    const { drops, maps, ...rest } = fields;
    const m = { ...ctx.monsterTemplate(key), ...rest, name: key };
    monsters[key] = m;
    for (const itemName of drops || []) {
      const itemId = ctx.resolveItemIdByName(itemName);
      if (!m.drops.includes(itemId)) m.drops.push(itemId);
      const it = ctx.items[itemId];
      if (it && !it.dropped_by.includes(key)) it.dropped_by.push(key);
    }
    for (const mapName of maps || []) ctx.linkMonsterToMap(key, mapName);
    rec(report, { target: 'monster', op: 'add', key, status: 'applied', detail: `drops=${(drops || []).length} maps=${(maps || []).length}` });
  }

  for (const [key, fields] of Object.entries(p.override)) {
    const m = monsters[key];
    if (!m) { rec(report, { target: 'monster', op: 'override', key, status: 'target_missing' }); continue; }
    const changed = applyFieldOverride(m, fields);
    rec(report, { target: 'monster', op: 'override', key, status: changed ? 'applied' : 'noop', detail: changed ? undefined : '欄位值與上游相同，可刪除此 override' });
  }
}

// ---------- item ----------
function applyItemPatches(ctx, p, report) {
  const { items } = ctx;
  for (const key of p.remove) {
    if (!items[key]) { rec(report, { target: 'item', op: 'remove', key, status: 'target_missing' }); continue; }
    const name = items[key].name;
    delete items[key];
    for (const m of Object.values(ctx.monsters)) {
      const i = m.drops.indexOf(key);
      if (i >= 0) m.drops.splice(i, 1);
    }
    rec(report, { target: 'item', op: 'remove', key, status: 'applied', detail: name });
  }
  for (const [key, fields] of Object.entries(p.add)) {
    if (items[key]) { rec(report, { target: 'item', op: 'add', key, status: 'noop', detail: '上游已存在此物品' }); continue; }
    items[key] = { id: key, name: fields.name || key, aliases: fields.aliases || [], dropped_by: fields.dropped_by || [] };
    rec(report, { target: 'item', op: 'add', key, status: 'applied' });
  }
  for (const [key, fields] of Object.entries(p.override)) {
    const it = items[key];
    if (!it) { rec(report, { target: 'item', op: 'override', key, status: 'target_missing' }); continue; }
    const changed = applyFieldOverride(it, fields);
    rec(report, { target: 'item', op: 'override', key, status: changed ? 'applied' : 'noop', detail: changed ? undefined : '欄位值與上游相同，可刪除此 override' });
  }
}

// ---------- map（key＝地圖正式名）----------
function applyMapPatches(ctx, p, report) {
  const { maps, mapNameToId } = ctx;
  const mapByName = (name) => (mapNameToId.has(name) ? maps[mapNameToId.get(name)] : null);

  for (const key of p.remove) {
    const mp = mapByName(key);
    if (!mp) { rec(report, { target: 'map', op: 'remove', key, status: 'target_missing' }); continue; }
    for (const { mob } of mp.mobs) {
      const m = ctx.monsters[mob];
      if (m) { const i = m.maps.indexOf(mp.id); if (i >= 0) m.maps.splice(i, 1); }
    }
    delete maps[mp.id];
    mapNameToId.delete(key);
    rec(report, { target: 'map', op: 'remove', key, status: 'applied' });
  }

  for (const [key, fields] of Object.entries(p.add)) {
    if (mapByName(key)) { rec(report, { target: 'map', op: 'add', key, status: 'noop', detail: '上游已存在此地圖，可改用 override' }); continue; }
    const { add_mobs, ...rest } = fields;
    const mp = ctx.createMap(key, rest);
    for (const mob of add_mobs || []) ctx.linkMonsterToMap(mob, key);
    rec(report, { target: 'map', op: 'add', key, status: 'applied', detail: `mobs=${(add_mobs || []).length}` });
  }

  for (const [key, fields] of Object.entries(p.override)) {
    const mp = mapByName(key);
    if (!mp) { rec(report, { target: 'map', op: 'override', key, status: 'target_missing' }); continue; }
    const { add_mobs, ...rest } = fields;
    let changed = applyFieldOverride(mp, rest);
    for (const mob of add_mobs || []) {
      if (!mp.mobs.some((x) => x.mob === mob)) { ctx.linkMonsterToMap(mob, key); changed = true; }
    }
    rec(report, { target: 'map', op: 'override', key, status: changed ? 'applied' : 'noop', detail: changed ? undefined : '欄位值與上游相同，可刪除此 override' });
  }
}

// 覆蓋物件欄位；回傳是否真的有值改變（全相同＝no-op）。
function applyFieldOverride(obj, fields) {
  let changed = false;
  for (const [k, v] of Object.entries(fields)) {
    if (!deepEqual(obj[k], v)) { obj[k] = v; changed = true; }
  }
  return changed;
}

// 把既有 override 檔（mob_overrides / map_overrides）的既有報告併入統一報告，供「新舊修正一覽」。
// 不改變其套用行為（那些檔仍由 build 主流程原地套用）——這裡只做報告層 adapter。
export function adaptLegacyReports({ mobOverrideReport = [], mapOverrideReport = [] }, report = []) {
  for (const r of mobOverrideReport) {
    report.push({ source: 'mob_overrides.json', target: 'monster', op: 'override', key: r.key, status: r.status, detail: r.detail });
  }
  for (const r of mapOverrideReport) {
    if (r.skipped) { report.push({ source: 'map_overrides.json', target: 'map', op: 'add_mobs', key: r.map, status: 'skipped', detail: r.reason }); continue; }
    const status = (r.added && r.added.length) || r.created ? 'applied' : 'noop';
    const detail = [r.created ? '新建地圖' : null, r.added && r.added.length ? `補 ${r.added.length} 怪` : '無新增（上游已具備）', r.missing && r.missing.length ? `缺怪 ${r.missing.join('、')}` : null]
      .filter(Boolean).join('；');
    report.push({ source: 'map_overrides.json', target: 'map', op: 'add_mobs', key: r.map, status, detail });
  }
  return report;
}

// 報告摘要（供 build log 與 data_gaps）
export function summarizeReport(report) {
  const by = (s) => report.filter((r) => r.status === s).length;
  return {
    total: report.length,
    applied: by('applied'),
    noop: by('noop'),
    target_missing: by('target_missing'),
    skipped: by('skipped'),
    // no-op 與 target_missing 是「可清理 / 需注意」清單
    removable: report.filter((r) => r.status === 'noop').map((r) => ({ source: r.source, target: r.target, op: r.op, key: r.key, detail: r.detail })),
    unresolved: report.filter((r) => r.status === 'target_missing').map((r) => ({ source: r.source, target: r.target, op: r.op, key: r.key })),
  };
}
