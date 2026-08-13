import { store, getMap, getMonster, getItem, mobIconUrl, fmtStat } from '../lib/store.js';
import { esc } from '../lib/ui.js';

export function mapPage({ params }) {
  const mp = getMap(params.id);
  if (!mp) return { html: `<div class="crumbs"><a href="#/">首頁</a></div><div class="empty-note">查無此地圖。</div>` };

  // minimap 區塊
  let minimap;
  if (mp.minimap_image) {
    minimap = `<div class="minimap-wrap">
      <img src="${mp.minimap_image}" alt="${esc(mp.name)} minimap" loading="lazy"
           onerror="this.parentElement.innerHTML='<span class=muted>地圖預覽載入失敗</span>'">
      <div class="muted" style="font-size:.75rem;margin-top:6px">
        對應 GMS：${esc(mp.gms_map_name || '')}（${mp.gms_match_source
          ? '人工校正・' + esc(mp.gms_match_source)
          : '信心 ' + Math.round((mp.match_confidence || 0) * 100) + '%'}）
      </div>
    </div>`;
  } else {
    const gmsNote = mp.gms_match_source
      ? `（對應 GMS：${esc(mp.gms_map_name || mp.gms_map_id)}・人工校正，惟此版本無 minimap 圖）`
      : mp.gms_map_id ? `（候選 GMS id ${mp.gms_map_id}，信心不足未採用）` : '';
    minimap = `<div class="empty-note">地圖預覽待補${gmsNote}。路徑與相鄰地圖功能規劃於 v2。</div>`;
  }

  // 怪物清單（依等級排序，帶掉落亮點）
  const mobs = mp.mobs
    .map((x) => getMonster(x.mob))
    .filter(Boolean)
    .sort((a, b) => a.level - b.level)
    .map((m) => {
      const url = mobIconUrl(m);
      const img = url ? `<img src="${url}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">` : '<span style="width:40px;text-align:center">👾</span>';
      const topDrops = m.drops.slice(0, 3).map((id) => getItem(id)).filter(Boolean).map((i) => i.name);
      return `<a class="row" href="#/monster/${encodeURIComponent(m.name)}">
        ${img}
        <span class="grow"><span class="name">${esc(m.name)}</span>
          <div class="meta">Lv.${m.level} ・ 經驗 ${fmtStat(m.exp)} ・ HP ${fmtStat(m.hp)}${topDrops.length ? ' ・ 掉 ' + esc(topDrops.join('、')) : ''}</div></span>
      </a>`;
    }).join('');

  // 同區域地圖
  const siblings = Object.values(store.maps)
    .filter((x) => x.region === mp.region && x.id !== mp.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
    .slice(0, 40)
    .map((x) => `<a class="tag" href="#/map/${x.id}">${esc(x.name.replace(mp.region + '：', ''))}</a>`)
    .join(' ');

  const html = `
    <div class="crumbs"><a href="#/">首頁</a> ／ 地圖 ／ ${esc(mp.region)}</div>
    <div class="detail-head"><div><h1>${esc(mp.name)} ${mp.region_status === 'unknown' ? '<span class="tag badge-warn">開放狀態未確認</span>' : ''}</h1>
      <div class="muted">區域：${esc(mp.region)}</div></div></div>

    ${minimap}

    <h2 class="section-title">怎麼走</h2>
    ${mp.route
      ? `<ol class="route-steps">${mp.route.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
         ${mp.route.source_url ? `<p class="muted" style="font-size:.78rem"><a href="${esc(mp.route.source_url)}" target="_blank" rel="noopener">路線來源 ↗</a></p>` : ''}`
      : '<div class="empty-note">尚無走法資料。自動路徑（相鄰麵包屑）規劃於 v2；已保留 GMS map id 與相鄰結構。</div>'}

    <h2 class="section-title">這張圖的怪物 ${mp.mobs.length ? `<span class="pill">${mp.mobs.length}</span>` : ''}</h2>
    ${mobs ? `<div class="rows">${mobs}</div>` : '<div class="empty-note">怪物資料待補。</div>'}

    ${siblings ? `<h2 class="section-title">同區域地圖（${esc(mp.region)}）</h2><div>${siblings}</div>` : ''}`;

  return { html };
}
