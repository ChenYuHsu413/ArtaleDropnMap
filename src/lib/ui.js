import { search, mobIconUrl, itemIconUrl, getMonster, getItem, fmtStat } from './store.js';
import { go } from './router.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 圖片載入失敗就隱藏（避免破圖）
const IMG_FALLBACK = 'onerror="this.style.visibility=\'hidden\'"';

const KIND_EMOJI = { monster: '👾', item: '🎁', map: '🗺️' };

export function suggestIconHtml(doc) {
  let url = null;
  if (doc.type === 'monster') url = mobIconUrl(getMonster(doc.key));
  else if (doc.type === 'item') url = itemIconUrl(getItem(doc.key));
  return url
    ? `<img class="suggest-thumb" src="${url}" alt="" loading="lazy" ${IMG_FALLBACK}>`
    : `<span class="suggest-thumb" style="display:inline-flex;align-items:center;justify-content:center;color:var(--text-dim)">${KIND_EMOJI[doc.type] || '❔'}</span>`;
}

function gotoDoc(doc) {
  if (doc.type === 'monster') go(`#/monster/${encodeURIComponent(doc.key)}`);
  else if (doc.type === 'map') go(`#/map/${encodeURIComponent(doc.key)}`);
  else go(`#/item/${encodeURIComponent(doc.key)}`);
}

// 可重用的即時搜尋框；autoNavigate=false 時 Enter 導到搜尋結果頁。
export function mountSearchBox(root, { placeholder = '搜尋物品或怪物…', initial = '' } = {}) {
  root.innerHTML = `
    <div class="searchbox">
      <input type="search" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(initial)}" />
      <div class="suggest" hidden></div>
    </div>`;
  const input = root.querySelector('input');
  const box = root.querySelector('.suggest');
  let results = [];
  let active = -1;

  const close = () => { box.hidden = true; active = -1; };
  const open = () => { if (box.children.length) box.hidden = false; };

  function renderSuggest() {
    const q = input.value.trim();
    if (!q) { box.innerHTML = ''; close(); return; }
    results = search(q, 8);
    if (!results.length) {
      box.innerHTML = `<div class="suggest-item muted">查無符合「${esc(q)}」</div>`;
      open(); return;
    }
    box.innerHTML = results.map((d, i) => {
      const kind = d.type === 'monster' ? '怪物' : d.type === 'map' ? '地圖' : '物品';
      const meta = d.type === 'monster'
        ? `Lv.${d.level ?? '?'}`
        : d.type === 'map'
          ? esc(d.region || '')
          : (d.dropCount ? `${d.dropCount} 怪掉落` : '');
      return `<div class="suggest-item" data-i="${i}">
        ${suggestIconHtml(d)}
        <span class="name">${esc(d.name)}</span>
        <span class="kind">${kind} ${meta}</span>
      </div>`;
    }).join('');
    active = -1;
    open();
  }

  input.addEventListener('input', renderSuggest);
  input.addEventListener('focus', () => { if (input.value.trim()) renderSuggest(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, results.length - 1); paintActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paintActive(); }
    else if (e.key === 'Enter') {
      if (active >= 0 && results[active]) gotoDoc(results[active]);
      else if (input.value.trim()) go(`#/search?q=${encodeURIComponent(input.value.trim())}`);
      close();
    } else if (e.key === 'Escape') close();
  });
  function paintActive() {
    [...box.children].forEach((c, i) => c.classList.toggle('active', i === active));
    if (active >= 0 && box.children[active]) box.children[active].scrollIntoView({ block: 'nearest' });
  }
  box.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.suggest-item');
    if (!item || item.dataset.i == null) return;
    e.preventDefault();
    gotoDoc(results[+item.dataset.i]);
    close();
  });
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });
  return input;
}

// 怪物圖卡（遊戲內視窗樣式）— 用於首頁圖卡牆
export function monsterCard(m) {
  const url = mobIconUrl(m);
  const sprite = url
    ? `<div class="sprite-box"><img class="pixelated" src="${url}" alt="${esc(m.name)}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('placeholder')"></div>`
    : '<div class="sprite-box placeholder" title="缺圖"></div>';
  // no_drops（如異型雙碟）不算資料待補；只在關閉區域的怪標「區域未開放」
  let todo = '';
  if (m.closed_region_only && !m.drops.length) {
    todo = '<span class="badge badge-todo">區域未開放</span>';
  } else if (!m.maps.length || (!m.drops.length && !m.no_drops)) {
    todo = '<span class="badge badge-todo">資料待補</span>';
  }
  let dropsHtml = '';
  const drops = m.drops.slice(0, 3).map((id) => getItem(id)).filter(Boolean).map((i) => i.name);
  if (drops.length) {
    dropsHtml = `<div class="drops"><span class="dh">亮點掉落</span>${esc(drops.join('、'))}</div>`;
  } else if (m.no_drops && m.behavior_note) {
    dropsHtml = `<div class="drops"><span class="dh">特殊行為</span>${esc(m.behavior_note)}</div>`;
  }
  return `<a class="mcard" href="#/monster/${encodeURIComponent(m.name)}">
    <div class="mwin">
      <div class="mwin-title"><span class="t-name">${esc(m.name)}</span><span class="t-lv pixel">Lv.${m.level}</span></div>
      <div class="mwin-body">
        ${sprite}
        <div class="m-exp"><span class="k">EXP</span>${fmtStat(m.exp)}</div>
        <div class="todo-slot">${todo}</div>
        ${dropsHtml}
      </div>
    </div>
  </a>`;
}

// 怪物列（可點）— 顯示頭像、等級、經驗
export function monsterRow(m, extra = '') {
  const url = mobIconUrl(m);
  const img = url
    ? `<img src="${url}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : `<span style="width:40px;text-align:center">👾</span>`;
  return `<a class="row" href="#/monster/${encodeURIComponent(m.name)}">
    ${img}
    <span class="grow"><span class="name">${esc(m.name)}</span>
      <div class="meta">Lv.${m.level} ・ 經驗 ${fmtStat(m.exp)} ・ HP ${fmtStat(m.hp)}${extra}</div></span>
  </a>`;
}
