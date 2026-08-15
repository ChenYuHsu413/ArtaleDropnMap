import { store, getMonster, getMapByName, getMap, mobIconUrl, eff, fmtStat, isBoss } from '../lib/store.js';
import { esc } from '../lib/ui.js';

function mobAvatars(names) {
  return names
    .map((n) => {
      const m = getMonster(n);
      if (!m) return `<span class="mob-avatar">${esc(n)}</span>`;
      const url = mobIconUrl(m);
      const img = url
        ? `<img src="${url}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        : '👾';
      return `<span class="mob-avatar">${img}${esc(n)} <span class="muted">Lv.${m.level || '?'}·${fmtStat(m.exp)}exp</span></span>`;
    })
    .join('');
}

function curatedCard(rec) {
  // party_quest / quest 皆不連地圖頁
  const noMapLink = rec.type === 'party_quest' || rec.type === 'quest';
  const title = rec.display_name || rec.map_name || '';

  // 屬性弱點（醒目）
  const elementBadge = rec.element
    ? `<span class="tag el-weak">${esc(rec.element)}</span>`
    : '';
  const typeTag = rec.type === 'party_quest' ? '組隊任務' : rec.type === 'quest' ? '任務' : '';
  const partyText = { solo: '單刷', party: '組隊', either: '單/組皆可' }[rec.party] || '';
  const badgeLabel = noMapLink ? typeTag : partyText;
  const partyBadge = badgeLabel && !(rec.tags || []).includes(badgeLabel)
    ? `<span class="tag">${badgeLabel}</span>` : '';

  // 推薦職業
  const jobs = (rec.recommended_jobs || []).length
    ? `<div class="rec-line"><span class="rec-key">推薦職業</span>${rec.recommended_jobs.map((j) => `<span class="job">${esc(j)}</span>`).join('')}</div>`
    : '';

  // 掉落亮點
  const drops = (rec.drops_highlight || []).length
    ? `<div class="rec-line"><span class="rec-key">掉落亮點</span><span>${rec.drops_highlight.map((d) => `<span class="tag">${esc(d)}</span>`).join('')}</span></div>`
    : '';

  // 地圖按鈕：party_quest / quest 不連地圖頁
  let mapBtns = '';
  if (!noMapLink) {
    const mapRec = getMapByName(rec.map_name);
    if (mapRec) mapBtns += `<a class="btn btn-ghost" href="#/map/${mapRec.id}">查看地圖</a>`;
    if (mapRec && mapRec.route) mapBtns += `<a class="btn route-btn" href="#/map/${mapRec.id}">🧭 路線</a>`;
    for (const alt of rec.alt_maps || []) {
      const altRec = getMapByName(alt);
      if (altRec) mapBtns += `<a class="btn btn-ghost" href="#/map/${altRec.id}">${esc(altRec.name.split('：').pop())}</a>`;
    }
  }
  const src = rec.source_url
    ? `<a class="btn btn-ghost" href="${esc(rec.source_url)}" target="_blank" rel="noopener">原文${rec.source_author ? '・' + esc(rec.source_author) : ''}</a>`
    : '';

  const winClass = noMapLink ? 'win-orange' : 'win-green';
  return `<div class="mwin card ${winClass}">
    <div class="mwin-title"><span class="t-name">${esc(title)}</span><span class="t-lv pixel">Lv.${rec.level_range[0]}–${rec.level_range[1]}</span></div>
    <div class="mwin-body">
      <div>${elementBadge}${partyBadge}${(rec.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      ${(rec.mobs || []).length ? `<div class="mobs">${mobAvatars(rec.mobs)}</div>` : ''}
      ${jobs}
      ${drops}
      ${rec.notes ? `<p class="muted" style="margin:4px 0">${esc(rec.notes)}</p>` : ''}
      <div class="card-actions">${mapBtns}${src}</div>
    </div>
  </div>`;
}

// fallback：依 ±5 等、exp/hp 比值高的怪，聚合到其出沒地圖
function autoRecommend(lv) {
  const lo = lv - 5, hi = lv + 5;
  // BOSS（多型態/列於 boss_time）不參與效率計算
  const qualifying = Object.values(store.monsters).filter(
    (m) => m.level >= lo && m.level <= hi && eff(m.exp) > 0 && m.maps.length && !isBoss(m)
  );
  const byMap = new Map(); // mapId -> {score, mobs:Set}
  for (const m of qualifying) {
    const ratio = eff(m.exp) / Math.max(1, eff(m.hp));
    for (const mapId of m.maps) {
      if (!byMap.has(mapId)) byMap.set(mapId, { score: 0, mobs: new Set() });
      const e = byMap.get(mapId);
      e.score += ratio;
      e.mobs.add(m.name);
    }
  }
  const ranked = [...byMap.entries()]
    .map(([mapId, e]) => ({ map: getMap(mapId), score: e.score, mobs: [...e.mobs] }))
    .filter((x) => x.map)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  return ranked
    .map((x) => {
      const topMobs = x.mobs
        .map((n) => getMonster(n))
        .sort((a, b) => eff(b.exp) / Math.max(1, eff(b.hp)) - eff(a.exp) / Math.max(1, eff(a.hp)))
        .slice(0, 4)
        .map((m) => m.name);
      return `<div class="mwin card win-green">
        <div class="mwin-title"><span class="t-name">${esc(x.map.name)}</span><span class="t-lv pixel">自動</span></div>
        <div class="mwin-body">
          <div><span class="tag badge-warn">自動推薦</span> <span class="muted" style="font-size:.8rem">區域：${esc(x.map.region)}</span></div>
          <div class="mobs">${mobAvatars(topMobs)}</div>
          <div class="card-actions"><a class="btn btn-ghost" href="#/map/${x.map.id}">查看地圖</a></div>
        </div>
      </div>`;
    })
    .join('');
}

export function levelingPage({ query }) {
  const lv = Math.min(200, Math.max(1, parseInt(query.lv, 10) || 35));
  const party = query.party || 'any';

  let curated = store.leveling.filter(
    (r) => lv >= r.level_range[0] && lv <= r.level_range[1]
  );
  if (party !== 'any') {
    // 'either' 的推薦單刷/組隊皆符合
    const filtered = curated.filter((r) => !r.party || r.party === party || r.party === 'any' || r.party === 'either');
    if (filtered.length) curated = filtered;
  }

  const controls = `
    <div class="entry" style="margin-bottom:18px">
      <div class="level-row">
        <span>等級</span>
        <input type="range" id="lv-range" min="1" max="120" value="${lv}" />
        <input type="number" id="lv-num" class="level-num" min="1" max="200" value="${lv}" />
        <button class="btn" id="lv-go">更新</button>
      </div>
    </div>`;

  let body;
  if (curated.length) {
    body = `<h2 class="section-title">Lv.${lv} 精選練功地圖 <span class="pill">${curated.length}</span></h2>
      <div class="cards">${curated.map(curatedCard).join('')}</div>`;
  } else {
    const auto = autoRecommend(lv);
    body = `<div class="empty-note">目前 Lv.${lv} 尚無人工精選推薦，以下依怪物數值自動推算。</div>
      <h2 class="section-title">自動推薦 <span class="pill badge-warn">beta</span></h2>
      <div class="cards">${auto || '<div class="empty-note">找不到合適的怪，試試調整等級。</div>'}</div>`;
  }

  const html = `<div class="crumbs"><a href="#/">首頁</a> ／ 練等推薦</div>${controls}${body}`;

  const onMount = (el) => {
    const range = el.querySelector('#lv-range');
    const numEl = el.querySelector('#lv-num');
    range.addEventListener('input', () => (numEl.value = range.value));
    const submit = () => {
      const v = Math.min(200, Math.max(1, +numEl.value || 35));
      location.hash = `#/leveling?lv=${v}&party=${party}`;
    };
    el.querySelector('#lv-go').addEventListener('click', submit);
    numEl.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  };

  return { html, onMount };
}
