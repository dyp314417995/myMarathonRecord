# PRD 产品需求文档 v2.6 — 赛事自动采集 + 草稿审核

> 版本：V2.6 | 状态：迭代六 | 模块：赛事数据自动化

> ⚠️ **采集功能已废弃（2026-08-29）**：定时从最酷/田协等平台爬取的数据质量太差，已删除 `raceAutoFetch2`/`raceSourceProbe`/`raceTest` 云函数及管理端「立即抓取」按钮。
> **数据来源改为腾讯在线文档《国内路跑认证赛事》**（https://docs.qq.com/smartsheet/DQlZpdE1QRFhST0dF?tab=sc_fJm8EC）。
>
> **方案B（2026-08-29 确认）：取消草稿审核，信任表格直接发布 + 字段级保护**
> - 导入无同名 → 直接新建 published；同名人工创建(source='manual') → 跳过
> - 同名表格赛事 → 字段合并：表格有值才覆盖，`manualFields` 里的人工修改字段保留
> - 管理端编辑时，改动的字段自动记入 `manualFields`，下次导入保留你的修改，其余跟随表格
> - 存量草稿可用 `getRaceEvents` action `publishAllDrafts` 一次性转已发布
> - 流程：`update_saishi.js`（rev 对比）→ `csv-to-races.js` → `importRaceSheet`（直接发布+字段合并）
>
> **2026-08-29 落地**：
> - 数据已全量导入（1030 条，0 失败），markerCount 热度回填完成
> - 自动导入链路：`Windows计划任务`（每天10:00，电脑开机）→ `auto_import.ps1`（拉取→转换→上传）→ 云函数定时 `dailyImport`（每天02:00）从云存储全量导入
> - 导入日志：`race_fetch_log`（汇总）+ `race_import_log`（逐条），管理端日志Tab暂未启用（云函数层保留）
> - 新增字段：`manualFields`（字段级保护）、`feeDeadline`（缴费时间原值，可空）
> - 命名规范：name 带年份 / raceGroup 不带年份；city 从赛事名提取；payment 取表格原值；标牌白金/金标/精英/普通

---

## 1. 概述

新增**赛事自动采集**能力：每天凌晨由定时任务自动到网上抓取最新赛事讯息，创建/更新赛事；抓取结果一律进入**草稿**，由管理员审核后**发布**，用户端只可见已发布赛事。

核心闭环：**自动抓取 → 草稿 → 管理员确认 → 发布 → 冻结（定时任务不再改）**。

---

## 2. 核心规则

| 状态 | 含义 | 定时任务 | 用户可见 |
|------|------|---------|---------|
| `draft` 草稿 | 自动抓取创建，待管理员确认 | ✅ 可自动更新（全量覆盖） | ❌ 不可见 |
| `published` 已发布 | 管理员确认过 / 人工创建 | ❌ 禁止自动修改 | ✅ 可见 |

- 审核状态使用独立字段 `publishStatus`，与现有 `status`（`upcoming`/`finished`，赛事进行状态）解耦，互不影响。

---

## 3. 命名规范（已确认）

| 字段 | 规则 | 示例 |
|------|------|------|
| `name` 赛事名 | **带年份** | `北京马拉松2026` |
| `raceGroup` 赛事组名 | **不带年份** | `北京马拉松` |

- 年份取**赛事举办年份**（按 `date` 推算，而非抓取那年）
- 同一赛事每年一条记录：`name` 带年份区分，`raceGroup` 相同，复用现有"同组赛事"能力
- 抓取到的名称已含年份则直接采用；不含则按举办年份追加

---

## 4. 采集源（探测定案）

> 已在云函数环境实测连通性/可解析性（`raceSourceProbe`，P0 已做）。

### 4.1 V1 源（接入）

| 源 | 列表页 | 详情页 | 定位 |
|----|--------|--------|------|
| **最酷 zuicool**（主源） | `/events`（赛事大全，纯 HTML） | `/event/{id}`（标题带年份，结构化字段） | 数字 ID 作 `sourceId`，去重最稳 |
| **中国田径协会**（官方补充） | `/event/`（竞赛工作）、`/bulletin/competition/`（官方公告） | 公告详情 HTML | 补全官方认证信息（等级/标牌等） |

### 4.2 储备源（留接口位，后续接入）

| 源 | 现状 | 接入前提 |
|----|------|---------|
| 赛会通 saihuitong | `/event.html` 可达，页面内赛事链接为 0，疑似 JS 加载 | 找到其数据接口或确认可解析 |
| 马拉松报名网 mlsbmw | `/match`、`/racecalendar` 均 JS 渲染（spaHint=true） | 找到其内部接口 |

### 4.3 放弃源

马拉马拉（纯 App 站）、爱燃烧（DNS 不通）、知行合逸（跳转壳）、中国马拉松官网（302 死循环）。

> 架构上**多源可插拔**：每源一个适配器文件，互不影响；哪个源可用随时加，坏一个单独下线。

---

## 5. 采集与更新流程

### 5.1 定时任务（云函数 `raceAutoFetch`）

```
每天 02:00 触发
  └─ 遍历采集源适配器（V1：最酷、田径协会）
       ├─ 抓取该源最新赛事列表
       ├─ 逐条抓详情 → 标准化为 RaceItem
       ├─ 按去重键查 race_events
       │   ├─ 命中 & publishStatus='published' → 跳过（冻结）
       │   ├─ 命中 & publishStatus='draft'     → 全量覆盖更新草稿
       │   └─ 未命中                            → 新建 draft
       └─ 每源独立 try/catch，单源失败不影响其它
  └─ 写采集日志 race_fetch_log（各源 抓取/新建/更新/跳过/失败 统计）
```

### 5.2 去重匹配顺序

```
sourceUrl 精确匹配（同源更新）
  → sourceId 兜底（URL 变化）
  → name 精确匹配（跨源去重：不同源抓到同一场，合并成一条）
```

跨源命中同样遵守：已发布跳过、草稿全量更新、都没有才新建。

### 5.3 更新策略（已确认）

- 草稿：采集字段**全量覆盖**
- 已发布：冻结不动
- 人工创建/编辑的赛事（`source='manual'`）：一律 `published`，定时任务永不触碰

### 5.4 适配器接口

```js
// 每源一个文件，实现统一接口
async function fetchList(ctx) => RaceItem[]
// RaceItem 标准化字段：
{
  raceGroup: '北京马拉松',        // 不带年份
  name: '北京马拉松2026',          // 带年份
  date: '2026-10-18',
  city, province,
  raceTypes: ['full'], raceLevel, distance, fee, scale,
  website, mechanism, payment, label,
  timeline: [{ label: '报名开启', date: '2026-07-01', time: '12:00' }, ...],
  sourceSite: '最酷', sourceUrl, sourceId,
}
```

---

## 6. 数据模型

### 6.1 `race_events` 新增字段

```js
publishStatus: 'draft' | 'published',   // 审核状态（默认 published）
source: 'auto' | 'manual',             // 来源
sourceSite: String,                    // 来源平台名（展示"信息来源于XX"用）
sourceUrl: String,                     // 来源页 URL（去重键）
sourceId: String,                      // 来源平台内 ID（URL 变化兜底）
firstSeenAt: Date,                     // 首次被发现
lastAutoFetchAt: Date,                 // 最近一次自动更新
autoFetchedCount: Number,              // 自动更新次数（排查用）
confirmedBy: String,                   // 管理员确认者
confirmedAt: Date,                     // 确认时间
```

### 6.2 `race_fetch_log`（采集日志）

```js
{
  _id,
  date: String,          // 'YYYY-MM-DD'（东八区）
  source: String,        // 源 key
  fetched: Number,       // 抓取条数
  created: Number,       // 新建草稿数
  updated: Number,       // 更新草稿数
  skipped: Number,       // 跳过（已发布）数
  failed: Number,        // 失败数
  errors: Array,         // 失败明细（源内单条）
  durationMs: Number,
  createTime: Date,
}
```

---

## 7. 可见性控制

所有用户端查询统一加 `publishStatus: 'published'` 过滤：

- `getRaceEvents`（赛事列表/日历）
- `getEventDetail`（赛事详情）
- `queryEvents`（如有全量查询）
- 管理端不受限（能看到草稿）

---

## 8. 管理端（赛事管理页）

- 新增**「草稿」页签/筛选**，草稿卡片显示「⏳ 待确认」标签 + 来源平台
- 草稿操作：**查看/编辑**（发布前可修正）、**确认发布**、**删除**（清理垃圾数据）
- 确认发布：`publishStatus='published'` + 写 `confirmedBy/At`，此后定时任务冻结该条
- **批量发布**
- **「立即抓取」按钮**：手动触发 `raceAutoFetch`，方便测试/补数据

---

## 9. 兼容与迁移

- **存量数据**：上线时一次性把现有 `race_events` 置 `publishStatus='published'`（人工数据不受影响）
- 管理员新增/编辑赛事：写入 `publishStatus='published'`、`source='manual'`
- 新增索引：
  - `race_events { publishStatus: 1, date: -1 }`（草稿/发布 + 日期排序）
  - `race_events { sourceUrl: 1 }`（去重查询）
  - `race_fetch_log { date: 1 }`

---

## 10. 接口设计

### 10.1 云函数 `raceAutoFetch`

| 入参 | 说明 |
|------|------|
| `sources`（可选） | 指定只跑某几个源（默认全部），用于"立即抓取"指定源 |
| `dryRun`（可选） | 试跑不写库，仅返回将新建/更新/跳过的数量（测试用） |

### 10.2 管理端

- 赛事管理页：草稿列表 / 确认发布 / 批量发布 / 删除（走 `getRaceEvents` 云函数扩展 action 或直接 DB 操作）

---

## 11. 涉及文件

| 文件 | 改动 |
|------|------|
| `cloudfunctions/raceAutoFetch/` | 新增：主流程 + `sources/zuicool.js` + `sources/athletics.js` + 标准化/去重/入库 + config.json 定时触发器 |
| `cloudfunctions/raceSourceProbe/` | 新增：P0 源探测（开发辅助，保留） |
| `cloudfunctions/getRaceEvents/index.js` | 用户端列表加 `publishStatus='published'` 过滤；管理端新增草稿查询/发布 action |
| `cloudfunctions/getEventDetail/index.js` | 详情加过滤 |
| `cloudfunctions/queryEvents/index.js` | 加过滤（如有） |
| `cloudfunctions/initDB/index.js` | 创建 `race_fetch_log` 集合（可选） |
| `miniprogram/utils/raceEvents.js` | 新增管理端草稿相关方法（发布/批量发布） |
| `miniprogram/pages/admin/races/*` | 草稿页签/确认发布/删除/立即抓取/批量发布 |

---

## 12. 部署清单

1. 部署云函数：`raceAutoFetch`（含定时触发器，每天 02:00）、更新 `getRaceEvents`/`getEventDetail`
2. 执行一次 `initDB` 或手动建 `race_fetch_log` 集合
3. 存量 `race_events` 批量置 `publishStatus='published'`
4. 控制台添加索引（见 9）
5. 发布小程序前端（赛事管理页）

---

## 13. 异常场景与风险

| 场景 | 处理 |
|------|------|
| 采集源改版/反爬 | 单源适配器隔离，失败写日志不阻塞其它源；连续失败可告警（可选） |
| 源返回脏数据（重复/缺字段） | 批内去重；缺关键字段（名称/日期）的记录丢弃并记日志 |
| 同一场被多源抓到 | 按 `sourceUrl → sourceId → name` 合并成一条 |
| 定时任务超时 | timeout 60s；按源分批执行，超时未完成部分下次续跑（日志记录进度） |
| 管理员误发布脏数据 | 已发布仍可人工编辑/删除（只是定时任务不再自动改） |
| 抓取合规 | 只抓公开信息、每天低频 1 次；展示"信息来源于 XX，请以官方为准"（可选） |