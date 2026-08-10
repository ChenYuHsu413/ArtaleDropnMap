// 極簡 hash 路由（GitHub Pages 子路徑安全，免 404 重寫）
// 路由格式: #/segment/param?query=value

const routes = [];
let notFound = () => '<div class="empty-note">找不到頁面</div>';

export function route(pattern, handler) {
  // pattern e.g. '/monster/:name'
  const parts = pattern.split('/').filter(Boolean);
  routes.push({ parts, handler });
}
export function setNotFound(fn) { notFound = fn; }

function parseHash() {
  let h = location.hash.replace(/^#/, '') || '/';
  const [pathStr, queryStr = ''] = h.split('?');
  const segs = pathStr.split('/').filter(Boolean);
  const query = {};
  for (const kv of queryStr.split('&')) {
    if (!kv) continue;
    const [k, v = ''] = kv.split('=');
    query[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return { segs, query };
}

function match({ segs }) {
  for (const r of routes) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

const app = () => document.getElementById('app');

async function render() {
  const parsed = parseHash();
  const m = match(parsed);
  const el = app();
  el.innerHTML = '<div class="loading">載入中…</div>';
  try {
    const result = m
      ? await m.handler({ params: m.params, query: parsed.query })
      : { html: notFound() };
    const { html, onMount } = typeof result === 'string' ? { html: result } : result;
    el.innerHTML = html;
    window.scrollTo(0, 0);
    if (onMount) onMount(el);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="empty-note">發生錯誤：${err.message}</div>`;
  }
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}

export function go(hash) { location.hash = hash; }
