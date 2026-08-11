# Artale 練等打寶決策工具

🔗 **Demo：<https://chenyuhsu413.github.io/ArtaleDropnMap/>**

一個**決策工具**。核心兩件事：

1. **瀏覽 / 找東西** — 首頁即怪物圖卡牆，打字即時篩選（fuzzy + 異體字 + 別名），點卡看掉落與刷圖。
2. **我要練等** — 右上「練等」入口，輸入等級 → 推薦練功地圖。

深度資料一律外連到 [artalemaplestory.com](https://www.artalemaplestory.com/zh)。純靜態站，可直接部署到 GitHub Pages。

技術：Vite + vanilla JS（無框架，JS gzip ~20KB）、Fuse.js 模糊搜尋、hash 路由（GH Pages 子路徑安全）、RWD + 深色模式。

## 介面（瀏覽優先）與視覺

- **首頁＝怪物圖卡牆**：進站即見有資料的怪（預設依等級排序）。頂部固定工具列＝搜尋框 + 等級 chip（1–30 / 30–70 / 70–100 / 100+）+ 區域下拉 + 「顯示全部」開關；打字即時收斂、不跳頁。
  - **預設隱藏「無掉落且無地圖」的活動/召喚垃圾怪**（計數旁註「已隱藏 N 隻無資料怪物」，例：顯示 731、已隱藏 293）；只要有地圖**或**有掉落就保留（異型雙碟無掉落但 override 補了出沒圖 → 保留）。**主動搜尋時被隱藏的怪仍會出現**（搜尋＝明確意圖）。「顯示全部」開關可一鍵顯示 1024 隻。
- **圖片三層解析（build 預算 `monsters[].icon`）**：GMS icon > artale-drop `image/怪名.png` > `null`。第二層補回 GMS 沒有的自訂怪（101 的搞怪CD／香水／人偶／瘋狂喵z客等 10 隻）。仍缺圖者（143 隻，含異型雙碟）顯示**占位剪影**並記入 `data_gaps.missing_images`。
- **特殊行為標註（`data-src/mob_overrides.json`）**：`no_drops: true` 的怪（如異型雙碟）**不顯示「資料待補」**，掉落區改顯示 `behavior_note`（「擊殺後分裂為 3 個搞怪CD」）。
- **區域開放閘門（`data-src/region_status.json`，2026-08-10 定稿）**：`closed` 前綴地圖 + `closed_maps` 單圖黑名單（活動殘留）**全站排除**（不進地圖索引、不進怪物出沒清單、不進區域下拉；本次排除 **323 前綴圖 + 51 黑名單圖**、保留 647 張）。只出沒於這些圖的怪（提諾＝皇后之路；蓋福克斯／字母怪 A~Z＝活動圖；鬧鬼宅邸房間怪等）自動落入「隱藏組」，主動搜尋仍可見、出沒地圖區顯示「所在區域未開放」、圖卡標「區域未開放」而非誤導的地圖清單。`unknown` 標「開放狀態未確認」並列入 `data_gaps.region_unconfirmed`（定稿後為 0）；表中未列的新前綴仍視為 unknown 並記入 data_gaps。**區域下拉只列 open 前綴（30 個），依 `open` 陣列順序**（楓之島→…→童話村→蒙特鳩研究所→卡帕萊特研究所→台北101→…）。**`region_status.json` 為排序唯一權威來源，`open` 陣列順序＝下拉顯示順序，照原序使用、不另行調整**；要改順序就直接改 `open` 陣列。
- **`data_gaps.event_map_candidates`**：隱藏地圖前綴下、整圖每隻怪都無掉落、且未在黑名單的圖（本次 54 張；先前 88 張中經人工分類、活動殘留已收進 closed_maps，剩餘為組隊任務副本與真隱藏圖，屬正常保留），供日後複查。
- **資料 cache-busting**：`meta.json` 每次帶時間戳取最新（檔小），其餘大型 JSON 用 `meta.built_at` 版本號 → **重建才失效、平時可快取**。避免重新部署更新資料後，回訪者拿到瀏覽器快取的舊 JSON。
- **效能**：圖片 `loading="lazy"`、過濾 debounce 120ms、分批渲染（每批 60，IntersectionObserver + scroll 備援）。
- **視覺＝懷舊楓之谷**：圖卡做成「遊戲內視窗」（淺色圓角、藍色漸層標題列放名+Lv），像素圖 `image-rendering: pixelated` 保持銳利。色彩 token：`--maple-sky / --window-blue / --maple-orange / --leaf-green / --ink`，深色模式改夜間深藍紫 `#1E2235`。練功地圖卡標題列用綠色、組隊/任務卡用橘色。點綴字體用開源繁中像素字 **Cubic 11**（子集化 woff2 僅 7KB，只用於 logo / 區塊標 / 等級數字；內文用 Noto Sans TC 系統字堆疊）。動效僅卡片浮起 + 過濾淡入，`prefers-reduced-motion` 尊重。

---

## 快速開始

```bash
npm install
npm run data     # 抓取 + 清洗來源，產出 public/data/*.json（首次約 1~3 分鐘）
npm run dev      # 本地開發 http://localhost:5175
npm run build    # 產出 dist/（可直接丟 GitHub Pages）
```

指令：

| 指令 | 說明 |
| --- | --- |
| `npm run data` | 一鍵重抓 → 清洗 → 合併 → 產出 JSON（有 `scripts/.cache` 快取） |
| `npm run data:fresh` | 忽略快取，強制重抓所有來源 |
| `npm run dev` / `build` / `preview` | Vite 開發 / 打包 / 預覽 |

`npm run build` 前會自動跑 `data --if-missing`（缺檔才補）。

---

## 資料管線（`scripts/build-data.mjs`）

來源：[a2983456456/artale-drop](https://github.com/a2983456456/artale-drop) 的公開 JSON + [maplestory.io](https://maplestory.io) API。**全部 build time 抓取清洗，前端不 runtime 依賴外站**（唯一例外：怪物頭像 / minimap 圖片走 maplestory.io CDN）。

已處理的來源問題：

- **三檔怪物集合不一致**（mob 1030 / drop 359 / map 731）→ 以 `mob.json` 為主集合合併；drop、map 皆為其子集。缺掉落或缺地圖的怪物**保留**、欄位留空，並列入 `data_gaps.json`。
- **異體字 + 數字混寫** → `src/lib/normalize.js` 正規化，查詢與索引兩端都先過再比對：
  - 異體字：型↔形、裡↔裏、台↔臺、著↔着…
  - **數字統一**：`2 ↔ II ↔ Ⅱ ↔ 二` 皆歸一為阿拉伯數字（上游地圖名混用「紅螃蟹海灘II」與「結冰的平原Ⅱ」）。已對全部 3258 個怪物/物品名驗證，**新撞名數 = 0**。
- **髒資料** → 剔除空字串 key、測試/除錯怪（含「Test」「測試」「？？？」、純符號名如「.」、明確髒名如「abc]」）、去除前後空白（含全形空白），去空白後撞名者合併。清洗後 **1023 隻**怪。
- **掉落物是「名稱」非 id** → 反查 `item.json` 補 id；25 個無 id 者（錢袋、催化劑、製法…）以 `custom:<name>` 保留。

### 人工維護來源（`data-src/`）與修正層

`data-src/` 是**手動維護**、不受上游覆蓋的資料，build 時讀入：

| 檔案 | 用途 |
| --- | --- |
| `data-src/leveling.json` | 練等推薦（真實內容，schema 見下）→ 輸出 `public/data/leveling.json` |
| `data-src/map_overrides.json` | **地圖修正層**：玩家實測與上游 `map.json` 不符的更正。build 於**抓取上游後、建索引前**套用，`add_mobs` 把怪物補進對應地圖；`create_if_missing: true`（含 `region`）可**新建上游不存在的地圖**（如「隱密之地：空屋」，無 minimap 顯示「預覽待補」）；未設 create_if_missing 又找不到地圖則警告不新建。上游更新不覆蓋 |
| `data-src/routes.json` | 地圖**走法路線**（不依賴 GMS 相鄰）。地圖名符合 `destination`（精確）或 `dest_maps_prefix`（前綴）就把 `steps` 掛到該圖，地圖頁「怎麼走」顯示 |
| `data-src/mob_overrides.json` | 怪物特殊行為，`{ mobs: { 怪名: { no_drops, behavior_note } } }`；`no_drops` 者不標「資料待補」，改顯示行為說明 |
| `data-src/region_status.json` | 地圖前綴（冒號前段）開放狀態：`open`（顯示）/`closed`（全站排除）/`unknown`（顯示但標「開放狀態未確認」並列入 data_gaps）。另有 `closed_maps`＝**開放前綴下的單圖黑名單**（活動殘留＋鬧鬼宅邸內部房間＋GM 活動圖，51 張），比對前去除全形/半形空白（上游有冒號後帶空白的髒 key）。過濾順序＝前綴檢查 → closed_maps 精確比對。表中未列的新前綴**視為 unknown 並記入 data_gaps**，不靜默放行 |
| `data-src/aliases.json` | **統一別名來源**（canonical 正式名 → 別名陣列），分 `monster`/`item`/`map` 三類（如 `異型雙碟: ["雙碟","異形雙碟"]`）。build 併入預建搜尋索引、不產生重複條目；canonical 不存在者列入 `data_gaps.alias_issues`。**怪物俗稱（原 `mob_alias.json`）已併入此檔 `monster` 區並淘汰舊檔** |
| `data-src/map_alias.json` | **⚠️ 片語替換規則，非別名表**（不是 `aliases.json` 的漏網之魚，請勿提議遷移）。語義＝`{ "俗稱": "正式片語" }` 的**子字串比對、一對多**：一個俗稱可命中多張地圖（如 `摩登101→台北101` 命中所有 `台北101：…` 圖），並由前端 `getMapByName` 做**片語替換**解析地圖名。此語義放不進 `aliases.json` 的「完整地圖名→別名」schema，故刻意獨立；其定位留待**地圖頁階段**重評 |
| `data-src/patches/*.patch.json` | **L3 patch 資料層**（`monsters`/`items`/`maps` 各一檔），最後套用、優先度最高，覆蓋上游(L1)+maplestory.io(L2)。三種操作 `add`（新增上游沒有的實體，怪物可帶 `drops`/`maps` 自動串接）、`override`（覆蓋欄位）、`remove`（排除錯誤），以穩定 key（怪名/物品 id/地圖名）定位、不依賴順序。套用報告見 `data_gaps.patch_report`：`applied`/`noop`（上游已相符，提示可刪，不自動刪）/`target_missing` |

**三層資料架構**：L1 上游 artale-drop → L2 maplestory.io 補全（icon/foundAt/minimap）→ **L3 `data-src/patches/`**（最後套用）。既有 `map_overrides.json`/`mob_overrides.json`/`region_status.json` 語義不變、原地運作，透過 adapter 一併納入統一 `patch_report`（新舊修正一覽）；真正搬進 `patches/` 的遷移列為待辦。

build 會驗證這些來源的參照（地圖名／怪物名是否存在），問題列入 `data_gaps.json` 的 `map_overrides_applied`、`leveling_issues`、`alias_issues`、`patch_report`。

地圖、怪物、物品**都進預建搜尋索引**（`public/data/search_index.json`，build time 產出，含 `opencc-js` 產生的**簡體變體**）：前端載入後在記憶體查詢，不在輸入時重建索引。搜地圖名或俗稱（如「摩登101」「試煉洞穴」）可直接跳到地圖頁；**繁簡混用**（如「异型双碟」）與**別名/簡稱**（如「雙碟」「白水」）皆命中。比對優先序：完全相符 > 前綴 > 別名 > 模糊（Fuse.js，容忍 1–2 字差異）。全域搜尋框在首頁頂部與 `/search` 頁，結果分**怪物/物品/地圖**三組。

**數值欄位清洗**：上游 `mob.json` 的 hp/exp 等欄位有髒字串，`num()` 統一處理：`"?"→0`、`"130萬"→1300000`（萬/億）、`"461000\n(+…)"→461000`。**斜線＝「型態一/型態二」→ 解析成陣列保留兩值**（如 `"800/700"→[800,700]`）：
- 顯示層兩值並列（`800 / 700`）。
- 效率計算（`exp/hp` 自動推薦）取**末值**（型態二＝實戰型態，已驗證與攻略 500/500/400/700 吻合）；`eff()` 取末值。
- 顯示 `fmtStat()`：大數字換算回「萬」並加千分位（`53750000 → 5,375萬`、`970000 → 97萬`），中數字加千分位（`1200 → 1,200`），避免手機卡片被長數字撐爆。
- **BOSS 不參與效率計算**：以「HP 為陣列（多型態）或列於 `boss_time`」判定（如拉圖斯），僅展示不推薦（`isBoss()`）。

地圖名尾端空白（如 `隱密之地：黑肥肥領土␣`）trim 後合併。

### maplestory.io 地圖配對（v1 = 「只接 minimap 圖」策略）

maplestory.io **沒有中文/台服區**，中文地圖名無法字串比對。唯一橋接：
**怪物圖檔名 → MapleStory mob id → `foundAt`（GMS 地圖 id 清單）**，再用**投票法**替每個中文地圖名選出最可能的 GMS map id。

- 選定 **GMS v92**（mob-bridge 覆蓋率實驗：v62=65%、v83=83%、v92=85%、v95 持平）。
- Artale 是自訂伺服器，怪物→地圖佈局與 GMS 不同，故 per-map 準確度有限。**信心≥0.5 且該 GMS 地圖確有 minimap** 才顯示圖，目前 **406 / 1019** 張。
- 無論信心高低，**配對到的 `gms_map_id` 與信心分數都寫進 `maps.json` 與 `data_gaps.json`**，供人工校對或 v2 路徑功能直接沿用，不必重跑投票。
- **路徑麵包屑 / 相鄰地圖為 v2**；資料結構已備好（`maps[].gms_neighbors` 已存原始 GMS 相鄰 id）。

---

## 產出資料與交叉參照約定

`public/data/`：

| 檔案 | key | 內容 |
| --- | --- | --- |
| `monsters.json` | 怪物名 | `{ name, id(GMS mob id\|null), level, hp, mp, exp, evasion, pdef, mdef, accuracy_required, notes, image, maps:[mapId], drops:[itemId] }` |
| `items.json` | itemId | `{ id, name, aliases:[], dropped_by:[怪物名] }` |
| `maps.json` | mapId | `{ id, name, region, mobs:[{mob:怪物名}], minimap_image, gms_map_id, gms_map_name, match_confidence, match_support, gms_has_minimap, neighbors:[], gms_neighbors:[] }` |
| `leveling.json` | — | 練等推薦（來源 `data-src/leveling.json`；schema 見下） |
| `data_gaps.json` | — | 缺漏報告：缺掉落 / 缺地圖 / 無 GMS 橋接的怪、低信心地圖（含候選 id 與分數）、無 id 掉落物 |
| `aliases.json` / `map_alias.json` | — | 統一別名（怪/物/圖）/ 地圖俗稱片語 |
| `search_index.json` | — | 預建搜尋索引（怪/物/圖，含 `norm`/`simp` 簡體變體與別名） |
| `skill_builds.json` | — | 預留空結構（技能點法，v1 不實作內容） |
| `area.json` / `boss_time.json` / `meta.json` | — | 區域開放狀態 / BOSS 重生時間 / 建置版本與統計 |

**交叉參照鍵**：怪物一律以**怪物名**互相參照（`maps.mobs[].mob`、`items.dropped_by[]`）；`monsters.id`（GMS mob id）可能為 null，故不當交叉鍵。`monsters.drops[]`→itemId、`monsters.maps[]`→mapId。

`leveling.json` schema（練等卡片會顯示屬性弱點 `element` 與推薦職業 `recommended_jobs`；`type: "party_quest"` 的卡片**不連地圖頁**）：

```json
[{ "level_range": [35,40], "map_name": "黃金海岸：紅螃蟹海灘II", "display_name": "紅螃蟹海灘2",
   "type": "map",                       // "map" | "party_quest" | "quest"（後兩者不連地圖頁，map_name 可為 null）
   "mobs": ["紅螃蟹"], "alt_maps": [],   // alt_maps：同推薦的替代地圖名
   "element": "弱雷",                    // 屬性弱點，null 表無
   "recommended_jobs": ["冰雷"],
   "party": "solo|party|either|any", "tags": ["屬性剋制"],
   "drops_highlight": ["太極扇","上衣幸運卷軸100%"],
   "notes": "…", "source_url": "https://forum.gamer.com.tw/…", "source_author": "呆小笨" }]
```

`type` 為 `party_quest` / `quest` 的卡片不顯示「查看地圖」；`party: "either"` 表單刷/組隊皆可。

沒命中人工推薦時，練等頁會依 `±5 等、exp/hp 比值` 自動推算並標示「自動推薦」。

---

## 部署（GitHub Pages）

`.github/workflows/deploy.yml`：push 到 `main` 即自動 `npm ci → npm run data → npm run build → deploy`，`base` 自動設為 `/<repo>/`。首次需到 repo **Settings → Pages → Source: GitHub Actions** 啟用。

本地打包到自訂子路徑：`BASE=/你的repo/ npm run build`。

---

## 已知缺口 / v2

- 練等推薦：目前 43 筆（`data-src/leveling.json`），可持續增補。
- 地圖 minimap 覆蓋 ~40%（自訂伺服器限制）；低信心者見 `data_gaps.json`。
- 「怎麼走」：人工路線（`data-src/routes.json`）已可顯示；自動相鄰麵包屑仍 v2（`gms_neighbors` 已備）。
- 別名：統一於 `data-src/aliases.json`（怪/物/圖 canonical→別名，含原 `mob_alias` 6 筆已併入）＋ `data-src/map_alias.json`（地圖俗稱片語 6 筆，因片語語義維持獨立），可持續增補。
- 技能點法：頁面與資料結構預留，v1 不實作。
- 怪物元素抗性：`monsters[].element_codes` 已保留原始碼（F/I/L/S/H），v2 可解碼顯示。
- 卡片牆效能已做 lazy/debounce/分批；Lighthouse mobile 分數請於實際部署站台驗證（本機瀏覽器面板不合成畫面，無法在此跑 Lighthouse/截圖）。

### 重新產生像素字子集（Cubic 11）

字體子集 `src/assets/Cubic11-subset.woff2`（7KB）由 [ACh-K/Cubic-11](https://github.com/ACh-K/Cubic-11) 子集化而來，需要 `pip install fonttools brotli`：

```bash
pyftsubset Cubic_11.ttf --text="練等打寶怪物圖鑑推薦地全部區域找東西級經驗待補資料首選已驗證組隊任務" \
  --unicodes="U+0020-007E,U+00B7,U+2013,U+2014,U+FF01-FF5E" \
  --flavor=woff2 --output-file=src/assets/Cubic11-subset.woff2 --no-hinting --desubroutinize
```

若之後在 logo / 區塊標用到新的中文字，記得把該字補進 `--text` 重跑，否則會顯示缺字（tofu）。
