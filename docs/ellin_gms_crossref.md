# 艾靈森林新怪 GMS 改版後版本交叉驗證（一次性查證）

查證日期 2026-08-13。**只查證、不改資料**：巴哈值一律保留，本文僅記錄比對結果。

## 版本選擇
maplestory.io `/api/wz` 列出 GMS 共 237 個版本。本專案 build 用 **v92（改版前）**，
其 Ellin Forest 只有原版怪（Mossy Mushroom / Stone Bug / Primitive Boar）。
含 Ellin Forest **改版怪**的版本：**GMS v170**（2013 前後，收錄 `5250003–5250007` 妖精系列），
以此為官方對照基準。

## 怪物 HP/EXP/等級對照（v170 官方 vs 本站巴哈值）

| 怪物 | GMS id | 我方(巴哈) | GMS v170 官方 | 一致? |
|---|---|---|---|---|
| 光明妖精 Shining Fairy | 5250006 | LV109 / HP78000 / EXP4200 | LV100 / HP130000 / EXP1601 | ❌ 不一致 |
| 遠古妖精 Ancient Fairy | 5250005 | LV108 / HP75000 / EXP4000 | LV100 / HP130000 / EXP1601 | ❌ 不一致 |
| 狂暴的猿人肥肥 (Rampaging=)Violent Primitive Boar | 5250003 | LV107 / HP80000 / EXP4300 | LV99 / HP126000 / EXP1561 | ❌ 不一致 |
| 碴烏 Chao | 5250004 | LV0(未載) / HP1,900,000 | LV100 / HP4,250,000 / EXP82450 | ❌ 不一致 |

**結論：全部不一致 → 依規則只回報、不改動巴哈值。** Artale 為自訂伺服器，明顯重新平衡：
妖精等級調高（100→108/109）、HP 砍半（130000→約75000–78000）、EXP 調高（1601→約4000–4200）；
碴烏 boss HP 砍至官方的 ~45%（4.25M→1.9M）。

### 附註
- 官方 Shining Fairy 與 Ancient Fairy **同 HP/EXP/等級**（同系對怪）；本站兩者略有差異。
- **掉落表無法由 maplestory.io 取得**：mob detail 無 `drops` 欄位（僅 meta 的 hp/exp/等級）。
  故 drops 無法以此來源交叉驗證；巴哈掉落註記維持「社群回報、未證實」型態不變。
- v170 另有 `5250007 = Ephenia`（艾靈森林真正劇情 BOSS），本站未收錄。

## 地圖候選 id（item 4；v170 改版後有，v92 無 → 僅記錄，不採用）

| 我方圖（needs-review） | GMS v170 候選 | id | minimap(v170) | v92 收錄 |
|---|---|---|---|---|
| 艾靈森林：蝴蝶精的森林1 | Fairy Forest 1 | 300030200 | 有 | ✗ |
| 艾靈森林：蝴蝶精的森林2 | Fairy Forest 2 | 300030300 | 有 | ✗ |
| 艾靈森林：岩石山洞穴 | Rocky Mountain Cave | 300010410 | 有 | ✗ |
| 艾靈森林：岩石地城入口 | （v170 亦無明確對應；另有 Deep Inside the Cave 300010420=洞穴深處，語義不符「入口」） | — | — | — |

**重要**：上述候選 id 為 **GMS v170 專屬**，**v92 未收錄**。現行 build 固定 v92，故這些圖無法在
現行 build 採用（升級 build 的 GMS 版本後方可）。已寫入 `map_gms_ids.json` 對應條目的
`candidate_gms_map_id`，**仍維持 needs-review、build 不採用**，待日後以 minimap 視覺比對確認後升級。

視覺比對用 minimap（v170）：
- `https://maplestory.io/api/GMS/170/map/300030200/minimap`（Fairy Forest 1）
- `https://maplestory.io/api/GMS/170/map/300030300/minimap`（Fairy Forest 2）
- `https://maplestory.io/api/GMS/170/map/300010410/minimap`（Rocky Mountain Cave）
