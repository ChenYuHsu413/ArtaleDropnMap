import { store, getMonster, getItem, getMap, mobIconUrl, itemIconUrl, fmtStat, isBoss } from '../lib/store.js';
import { esc } from '../lib/ui.js';

function levelingMapNames() {
  return new Set(store.leveling.map((r) => r.map_name));
}

export function monsterPage({ params }) {
  const m = getMonster(params.name);
  if (!m) return { html: `<div class="crumbs"><a href="#/">首頁</a></div><div class="empty-note">查無此怪物「${esc(params.name)}」。</div>` };

  const iconUrl = mobIconUrl(m);
  const icon = iconUrl
    ? `<img class="pixelated" src="${iconUrl}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'silhouette',style:'width:64px;height:64px;display:inline-block'}))">`
    : '<span class="silhouette" style="width:64px;height:64px;display:inline-block"></span>';

  const stats = [
    ['等級', m.level || '?'], ['HP', m.hp], ['MP', m.mp], ['經驗', m.exp],
    ['命中需求', m.accuracy_required], ['迴避', m.evasion], ['物防', m.pdef], ['魔防', m.mdef],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${fmtStat(v)}</div></div>`).join('');

  // 掉落物
  const drops = m.drops
    .map((id) => getItem(id))
    .filter(Boolean)
    .map((it) => {
      const url = itemIconUrl(it);
      const img = url ? `<img src="${url}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">` : '<span style="width:40px;text-align:center">🎁</span>';
      return `<a class="row" href="#/item/${encodeURIComponent(it.id)}">
        ${img}<span class="grow"><span class="name">${esc(it.name)}</span></span></a>`;
    }).join('');

  // 出沒地圖（人工精選圖高亮為「推薦刷圖」）
  const recSet = levelingMapNames();
  const maps = m.maps
    .map((id) => getMap(id))
    .filter(Boolean)
    .map((mp) => {
      const rec = recSet.has(mp.name);
      return `<a class="row ${rec ? 'highlight-map' : ''}" href="#/map/${mp.id}">
        <span class="grow"><span class="name">${esc(mp.name)}</span>
          <div class="meta">${esc(mp.region)}${rec ? ' ・ <span class="rec-flag">★ 推薦刷圖</span>' : ''}</div></span>
        ${mp.minimap_image ? '<span class="tag">有地圖</span>' : ''}
      </a>`;
    }).join('');

  const html = `
    <div class="crumbs"><a href="#/">首頁</a> ／ 怪物 ／ ${esc(m.name)}</div>
    <div class="detail-head">${icon}<div><h1>${esc(m.name)}${isBoss(m) ? ' <span class="tag badge-warn">野王 BOSS</span>' : ''}</h1>
      <div class="muted">Lv.${m.level || '?'}${m.respawn ? ` ・ 重生 ${esc(m.respawn)}` : ''}</div></div></div>
    <div class="stats">${stats}</div>
    ${m.behavior_note && !m.no_drops ? `<div class="empty-note"><strong>行為</strong>：${esc(m.behavior_note)}</div>` : ''}

    <h2 class="section-title">掉落物 ${m.drops.length ? `<span class="pill">${m.drops.length}</span>` : ''}</h2>
    ${drops
      ? `<div class="rows">${drops}</div>`
      : m.no_drops
        ? `<div class="empty-note">此怪不掉落物品${m.behavior_note ? `——${esc(m.behavior_note)}` : ''}。</div>`
        : m.drops_note
          ? `<div class="empty-note">${esc(m.drops_note)}</div>`
          : '<div class="empty-note">掉落資料待補。</div>'}

    <h2 class="section-title">出沒地圖 ${m.maps.length ? `<span class="pill">${m.maps.length}</span>` : ''}</h2>
    ${maps
      ? `<div class="rows">${maps}</div>`
      : m.closed_region_only
        ? '<div class="empty-note">所在區域未開放——此怪僅出沒於目前關閉的區域或活動地圖，暫無可前往的地圖。</div>'
        : '<div class="empty-note">出沒地圖資料待補。</div>'}`;

  return { html };
}
