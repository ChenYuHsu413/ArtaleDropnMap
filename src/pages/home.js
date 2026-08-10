import { store, search, getMonster } from '../lib/store.js';
import { monsterCard, esc } from '../lib/ui.js';
import { go } from '../lib/router.js';

const BATCH = 60;
const LEVEL_CHIPS = [
  { key: 'all', label: '全部', range: null },
  { key: '1', label: '1–30', range: [1, 30] },
  { key: '2', label: '30–70', range: [30, 70] },
  { key: '3', label: '70–100', range: [70, 100] },
  { key: '4', label: '100+', range: [100, 999] },
];

export function homePage({ query }) {
  const state = {
    query: query.q || '',
    range: null,
    region: '',
    showAll: false, // 預設隱藏「無掉落且無地圖」的活動/召喚垃圾怪
  };
  const hasData = (m) => m.drops.length > 0 || m.maps.length > 0;

  const regionOpts = ['<option value="">全部區域</option>']
    .concat(store.regionList.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`))
    .join('');

  const html = `
    <div class="hero-strip">
      <h1 class="pixel">怪物圖鑑</h1>
      <span class="sub">點卡片看掉落與刷圖；要練等點右上「練等」。</span>
    </div>
    <div class="toolbar">
      <div class="search-wrap">
        <input type="search" id="wall-search" autocomplete="off" placeholder="搜尋怪物（打字即時篩選，例：異形→異型）" value="${esc(state.query)}" />
      </div>
      <div class="chips" id="lv-chips">
        ${LEVEL_CHIPS.map((c) => `<button class="chip ${c.key === 'all' ? 'on' : ''}" data-key="${c.key}">${c.label}</button>`).join('')}
      </div>
      <select class="region-select" id="region-select" aria-label="區域篩選">${regionOpts}</select>
      <button class="chip" id="show-all" aria-pressed="false" title="包含無掉落且無出沒地圖的怪">顯示全部</button>
    </div>
    <div class="wall-meta" id="wall-meta"></div>
    <div class="wall" id="wall"></div>
    <div class="loadmore-hint" id="loadmore" hidden>向下捲動載入更多…</div>
    <div class="sentinel" id="sentinel"></div>`;

  const onMount = (el) => {
    const wall = el.querySelector('#wall');
    const meta = el.querySelector('#wall-meta');
    const loadmore = el.querySelector('#loadmore');
    const input = el.querySelector('#wall-search');
    let list = [];
    let rendered = 0;

    function compute() {
      // 一次搜尋，拆出怪物與其他（物品/地圖）結果
      let others = { item: 0, map: 0 };
      let monsters;
      if (state.query) {
        const hits = search(state.query, 3000);
        monsters = hits.filter((d) => d.type === 'monster').map((d) => getMonster(d.key)).filter(Boolean);
        for (const d of hits) if (d.type === 'item') others.item++; else if (d.type === 'map') others.map++;
      } else {
        monsters = Object.values(store.monsters);
      }
      if (state.range) monsters = monsters.filter((m) => m.level >= state.range[0] && m.level <= state.range[1]);
      if (state.region) monsters = monsters.filter((m) => { const s = store.monsterRegions.get(m.name); return s && s.has(state.region); });
      // 瀏覽時（無搜尋）預設隱藏無資料怪；主動搜尋則全顯示（搜尋是明確意圖）
      let hidden = 0;
      if (!state.query && !state.showAll) {
        const before = monsters.length;
        monsters = monsters.filter(hasData);
        hidden = before - monsters.length;
      }
      if (!state.query) monsters.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'zh-Hant'));
      return { monsters, others, hidden };
    }

    function renderBatch(animate) {
      const slice = list.slice(rendered, rendered + BATCH);
      if (!slice.length) return;
      const frag = document.createElement('div');
      frag.innerHTML = slice.map(monsterCard).join('');
      while (frag.firstChild) wall.appendChild(frag.firstChild);
      rendered += slice.length;
      loadmore.hidden = rendered >= list.length;
      if (animate) { wall.classList.remove('animate'); void wall.offsetWidth; wall.classList.add('animate'); }
    }

    function apply() {
      const { monsters, others, hidden } = compute();
      list = monsters;
      rendered = 0;
      wall.innerHTML = '';
      if (!list.length) {
        loadmore.hidden = true;
        wall.classList.remove('animate');
        renderEmpty(wall, state.query);
        meta.textContent = '';
        return;
      }
      renderBatch(true);
      const otherHtml = state.query && (others.item || others.map)
        ? ` <a class="other-hits" href="#/search?q=${encodeURIComponent(state.query)}">也有 ${others.item} 物品・${others.map} 地圖符合 →</a>`
        : '';
      const hiddenHtml = hidden ? `，<span class="muted">已隱藏 ${hidden} 隻無資料怪物</span>` : '';
      meta.innerHTML = `顯示 ${list.length} 隻怪物${state.query ? `（符合「${esc(state.query)}」）` : ''}${hiddenHtml}${otherHtml}`;
    }

    // 首次渲染
    apply();

    // 即時搜尋（debounce 120ms）
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { state.query = input.value.trim(); apply(); }, 120);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); state.query = input.value.trim(); apply(); } });

    // 等級 chips
    el.querySelector('#lv-chips').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      el.querySelectorAll('#lv-chips .chip').forEach((c) => c.classList.remove('on'));
      btn.classList.add('on');
      state.range = LEVEL_CHIPS.find((c) => c.key === btn.dataset.key).range;
      apply();
    });

    // 區域
    el.querySelector('#region-select').addEventListener('change', (e) => {
      state.region = e.target.value;
      apply();
    });

    // 顯示全部（含無資料怪）
    const showAllBtn = el.querySelector('#show-all');
    showAllBtn.addEventListener('click', () => {
      state.showAll = !state.showAll;
      showAllBtn.classList.toggle('on', state.showAll);
      showAllBtn.setAttribute('aria-pressed', String(state.showAll));
      apply();
    });

    // 分批載入：IntersectionObserver 為主，scroll 為備援（部分瀏覽器會節流 IO）
    const sentinel = el.querySelector('#sentinel');
    const maybeMore = () => {
      if (rendered >= list.length) return;
      if (sentinel.getBoundingClientRect().top < window.innerHeight + 400) renderBatch(false);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) maybeMore();
    }, { rootMargin: '400px' });
    io.observe(sentinel);
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; maybeMore(); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    // 頁面離開時清理（router 會替換 #app 內容，但 window 監聽需自行移除）
    const cleanup = () => {
      if (document.getElementById('wall') !== wall) {
        window.removeEventListener('scroll', onScroll);
        io.disconnect();
        window.removeEventListener('hashchange', cleanup);
      }
    };
    window.addEventListener('hashchange', cleanup);
  };

  return { html, onMount };
}

function renderEmpty(wall, query) {
  const sugg = search(query, 3);
  const links = sugg.map((d) => {
    const href = d.type === 'monster' ? `#/monster/${encodeURIComponent(d.key)}`
      : d.type === 'map' ? `#/map/${encodeURIComponent(d.key)}`
      : `#/item/${encodeURIComponent(d.key)}`;
    return `<a href="${href}">${esc(d.name)}</a>`;
  }).join('');
  wall.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
    <h3>找不到「${esc(query)}」</h3>
    <p class="muted">試試別名或確認字形（例：異形 → 異型、火肥吧 → 火肥肥）。</p>
    ${links ? `<div class="sugg">${links}</div>` : ''}
  </div>`;
}
