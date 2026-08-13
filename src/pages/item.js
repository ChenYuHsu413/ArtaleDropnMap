import { store, getItem, getMonster, getMap, itemIconUrl } from '../lib/store.js';
import { monsterRow, esc } from '../lib/ui.js';

function levelingMapNames() {
  return new Set(store.leveling.map((r) => r.map_name));
}

export function itemPage({ params }) {
  const it = getItem(params.id);
  if (!it) return { html: `<div class="crumbs"><a href="#/">首頁</a></div><div class="empty-note">查無此物品。</div>` };

  const url = itemIconUrl(it);
  const icon = url
    ? `<img src="${url}" alt="" onerror="this.style.visibility='hidden'">`
    : '<span style="font-size:2.4rem">🎁</span>';

  const recSet = levelingMapNames();

  // 掉落此物的怪 → 各自出沒地圖；高亮推薦刷圖
  const droppers = it.dropped_by
    .map((n) => getMonster(n))
    .filter(Boolean)
    .sort((a, b) => a.level - b.level);

  const blocks = droppers.map((m) => {
    const maps = m.maps
      .map((id) => getMap(id))
      .filter(Boolean)
      .map((mp) => {
        const rec = recSet.has(mp.name);
        return `<a class="tag ${rec ? '' : ''}" href="#/map/${mp.id}" style="${rec ? 'border-color:var(--good);color:var(--good)' : ''}">${esc(mp.name)}${rec ? ' ★' : ''}</a>`;
      }).join(' ');
    return `<div class="row" style="flex-direction:column;align-items:stretch;gap:6px">
      ${monsterRow(m)}
      <div style="padding-left:4px">${maps || '<span class="muted" style="font-size:.82rem">出沒地圖待補</span>'}</div>
    </div>`;
  }).join('');

  const html = `
    <div class="crumbs"><a href="#/">首頁</a> ／ 物品 ／ ${esc(it.name)}</div>
    <div class="detail-head">${icon}<div><h1>${esc(it.name)}</h1>
      ${it.aliases.length ? `<div class="muted">別名：${esc(it.aliases.join('、'))}</div>` : ''}</div></div>

    <h2 class="section-title">哪些怪會掉 ${it.dropped_by.length ? `<span class="pill">${it.dropped_by.length}</span>` : ''}</h2>
    ${blocks ? `<div class="rows">${blocks}</div>` : '<div class="empty-note">掉落來源資料待補。</div>'}
    <p class="muted" style="font-size:.8rem;margin-top:10px">★ 標記＝人工精選推薦刷圖。</p>`;

  return { html };
}
