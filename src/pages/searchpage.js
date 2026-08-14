import { searchGrouped, getMonster, getItem, getMap, mobIconUrl, itemIconUrl, fmtStat } from '../lib/store.js';
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
        <div class="meta">怪物 ・ Lv.${m.level || '?'} ・ 經驗 ${fmtStat(m.exp)}${m.drops.length ? '' : ' ・ <span class="badge-warn tag">掉落待補</span>'}</div></span>
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

const GROUP = [
  { type: 'monster', label: '怪物' },
  { type: 'item', label: '物品' },
  { type: 'map', label: '地圖' },
];

function groupSection(label, list) {
  if (!list.length) return '';
  return `<section class="search-group">
    <h2 class="section-title">${label} <span class="pill">${list.length}</span></h2>
    <div class="rows">${list.map(resultRow).join('')}</div>
  </section>`;
}

function resultsHtml(q) {
  if (!q) return '<div class="empty-note">輸入關鍵字開始搜尋怪物、物品或地圖。</div>';
  const groups = searchGrouped(q, 40);
  const total = groups.monster.length + groups.item.length + groups.map.length;
  if (!total) return '<div class="empty-note">查無結果。試試更短的關鍵字、別名，或檢查有無錯字。</div>';
  return GROUP.map((g) => groupSection(g.label, groups[g.type])).join('');
}

export function searchPage({ query }) {
  const q = query.q || '';

  const html = `
    <div class="crumbs"><a href="#/">首頁</a> ／ 搜尋</div>
    <div id="sp-search" class="sp-search"></div>
    <div id="sp-results">${resultsHtml(q)}</div>`;

  const onMount = (el) => {
    const out = el.querySelector('#sp-results');
    const input = mountSearchBox(el.querySelector('#sp-search'), {
      initial: q,
      // 即時更新下方結果與網址（replaceState 不觸發 router 重繪，避免重掛搜尋框）
      onInput: (v) => {
        out.innerHTML = resultsHtml(v);
        history.replaceState(null, '', v ? `#/search?q=${encodeURIComponent(v)}` : '#/search');
      },
    });
    input.focus();
    const val = input.value; input.value = ''; input.value = val; // 游標移到字尾
  };
  return { html, onMount };
}
