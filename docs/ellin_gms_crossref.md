# 艾靈森林新怪 GMS 版本交叉驗證（一次性查證）

查證日期 2026-08-13。**只查證，不改巴哈的 HP/EXP 值**（僅升級註記；碴烏等級因取得可靠來源而補入，見下）。

## 版本探測結論（關鍵）
maplestory.io GMS 共 237 版。對 Shining Fairy（mob `5250006`）跨版二分探測其等級：

| 版本 | Shining Fairy |
|---|---|
| v95 / v100 / v105 / v110 | 不存在（艾靈森林改版前） |
| **v111 – v145** | **LV109 / HP83000 / EXP1618（首發值）** |
| v155 / v165 / v170 | LV100 / HP130000 / EXP1601（後續改版下修） |

→ **艾靈森林改版約在 v111 上線；首發版（v111–v145）Shining Fairy 等級就是 109**，與巴哈一致。
之前用 v170 比對得「等級 100」是**改版後下修版**，並非首發值。

## 四怪 GMS 首發值（v115）vs 本站（巴哈）

| 怪物 | 本站(巴哈) | GMS 首發 v115 | 等級 | HP | EXP |
|---|---|---|---|---|---|
| 光明妖精 Shining Fairy (5250006) | LV109 / HP78000 / EXP4200 | LV109 / HP83000 / EXP1618 | ✅一致 | 近(78k vs 83k) | 異(Artale↑) |
| 遠古妖精 Ancient Fairy (5250005) | LV108 / HP75000 / EXP4000 | LV108 / HP81000 / EXP1588 | ✅一致 | 近(75k vs 81k) | 異(Artale↑) |
| 狂暴的猿人肥肥 = Violent Primitive Boar (5250003) | LV107 / HP80000 / EXP4300 | LV107 / HP158000 / EXP3114 | ✅一致 | 異(Artale↓) | 異(Artale↑) |
| 碴烏 Chao (5250004) | LV110* / HP1,900,000 | LV110 / HP4,250,000 / EXP82450 | ✅一致 | 異(Artale↓) | — |

\* 碴烏原巴哈未載等級，此次由 GMS 首發取得 **110** 並補入（與其他三怪等級皆對得上首發版，非臆造）。

## 結論
- **等級：四怪全部＝GMS 首發官方值（v111–v145 era），孤證解除。** 巴哈的等級不是自訂/臆造，
  是首發官方值；之所以「和 GMS 現版不同」是因為官方後來（v155+）下修，Artale 沿用首發值。
- **HP：** 妖精類接近首發（差 5–8k，屬四捨五入/微調）；猿人肥肥與碴烏 boss 明顯 **Artale 下修**。
- **EXP：** 全面 **Artale 提升**（私服經驗加成），非官方值。
- **掉落表：** maplestory.io mob detail **無 `drops` 欄位**，任何版本都取不到官方掉落表 →
  drops 永遠無法以此來源驗證，巴哈掉落註記維持「社群回報、未證實」。
- 已於各怪 `drops_note` 升級註記（等級孤證解除、標明官方首發 HP/EXP 與 Artale 自訂）。

## 地圖候選 id（v170 改版後有、v92 無 → 僅記錄，維持 needs-review、build 不採用）
| 我方圖（needs-review） | GMS v170 候選 | id | minimap(v170) |
|---|---|---|---|
| 蝴蝶精的森林1 | Fairy Forest 1 | 300030200 | 有 |
| 蝴蝶精的森林2 | Fairy Forest 2 | 300030300 | 有 |
| 岩石山洞穴 | Rocky Mountain Cave | 300010410 | 有 |
| 岩石地城入口 | v170 亦無明確對應 | — | — |

候選 id 為改版後版本專屬、**v92 未收錄**，現行 build（固定 v92）不可採用；待升級 GMS 版本或
minimap 視覺比對後再升級。視覺比對 minimap：
- `https://maplestory.io/api/GMS/170/map/300030200/minimap`（Fairy Forest 1）
- `https://maplestory.io/api/GMS/170/map/300030300/minimap`（Fairy Forest 2）
- `https://maplestory.io/api/GMS/170/map/300010410/minimap`（Rocky Mountain Cave）
