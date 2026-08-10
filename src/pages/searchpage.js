import { search, getMonster, getItem, getMap, mobIconUrl, itemIconUrl, fmtStat } from '../lib/store.js';
import { mountSearchBox, esc } from '../lib/ui.js';

function resultRow(d) {
  if (d.type === 'map') {
    const mp = getMap(d.key);
    return `<a class="row" href="#/map/${encodeURIComponent(d.key)}">
      <span style="width:40px;text-align:center;font-size:1.3rem">🗺️</span>
      <span class="grow"><span class="name">${esc(mp.name)}</span>
        <div class="meta">地圖 ・ ${esc(mp.region)} ・ ${mp.mobs.length} 種怪${mp.minimap_image ? ' ・ 有地圖' : ''}</div></span>
    </a>`;
  }
  if (d.type === 'monster') {
    const m = getMonster(d.key);
    const url = mobIconUrl(m);
    const img = url ? `<img src="${url}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">` : '<span style="width:40px;text-align:center">👾</span>';
    return `<a class="row" href="#/monster/${encodeURIComponent(d.key)}">
      ${img}
      <span class="grow"><span class="name">${esc(m.name)}</span>
        <div class="meta">怪物 ・ Lv.${m.level} ・ 經驗 ${fmtStat(m.exp)}${m.drops.length ? '' : ' ・ <span class="badge-warn tag">掉落待補</span>'}</div></span>
    </a>`;
  }
  const it = getItem(d.key);
  const url = itemIconUrl(it);
  const img = url ? `<img src="${url}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">` : '<span style="width:40px;text-align:center">🎁</span>';
  return `<a class="row" href="#/item/${encodeURIComponent(d.key)}">
    ${img}
    <span class="grow"><span class="name">${esc(it.name)}</span>
      <div class="meta">物品 ・ ${it.dropped_by.length} 隻怪掉落${it.aliases.length ? ' ・ 別名 ' + esc(it.aliases.join('、')) : ''}</div></span>
  </a>`;
}

export function searchPage({ query }) {
  const q = query.q || '';
  const results = q ? search(q, 40) : [];

  const html = `
    <div class="crumbs"><a href="#/">首頁</a> ／ 搜尋</div>
    <div id="sp-search" style="margin-bottom:18px"></div>
    ${q
      ? `<h2 class="section-title">「${esc(q)}」的結果 <span class="pill">${results.length}</span></h2>
         ${results.length
           ? `<div class="rows">${results.map(resultRow).join('')}</div>`
           : '<div class="empty-note">查無結果。試試更短的關鍵字，或檢查有無錯字。</div>'}`
      : '<div class="empty-note">輸入關鍵字開始搜尋。</div>'}`;

  const onMount = (el) => {
    const input = mountSearchBox(el.querySelector('#sp-search'), { initial: q });
    input.focus();
  };
  return { html, onMount };
}
