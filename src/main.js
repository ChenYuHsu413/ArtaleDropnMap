import './styles.css';
import { loadData } from './lib/store.js';
import { route, setNotFound, startRouter } from './lib/router.js';
import { homePage } from './pages/home.js';
import { levelingPage } from './pages/leveling.js';
import { searchPage } from './pages/searchpage.js';
import { monsterPage } from './pages/monster.js';
import { itemPage } from './pages/item.js';
import { mapPage } from './pages/map.js';

// 主題切換（記憶於 localStorage）
function initTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem('theme');
  if (saved) root.setAttribute('data-theme', saved);
  else if (window.matchMedia('(prefers-color-scheme: light)').matches)
    root.setAttribute('data-theme', 'light');
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
}

route('/', homePage);
route('/leveling', levelingPage);
route('/search', searchPage);
route('/monster/:name', monsterPage);
route('/item/:id', itemPage);
route('/map/:id', mapPage);
setNotFound(() => '<div class="crumbs"><a href="#/">首頁</a></div><div class="empty-note">找不到頁面。</div>');

initTheme();
loadData()
  .then(() => startRouter())
  .catch((err) => {
    document.getElementById('app').innerHTML =
      `<div class="empty-note">資料載入失敗：${err.message}<br>請先執行 <code>npm run data</code> 產生 public/data。</div>`;
  });
