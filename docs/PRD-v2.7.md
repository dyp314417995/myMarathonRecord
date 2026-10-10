# PRD 产品需求文档 v2.7 — 管理员省份 / 群二维码 / 通知闭环

> 版本：V2.7 | 状态：迭代七 | 模块：管理员配置升级 + 赛事群二维码运维

---

## 1. 概述

V2.7 在 V2.6（赛事数据自动化 + 字段级保护）基础上，补齐**赛事群二维码**从"上传→展示→过期→通知"的完整运维闭环，并把超管→管理员的**省份分配**作为正式能力落定。

### 核心闭环

```
超管分配省份 → 管理员负责某省赛事 → 赛事展示二维码 →
  ↓
  客户端用户/系统定时检测异常 →
  ↓
  通知管理员 → 管理员上传/更新 → 二维码时间戳刷新
```

---

## 2. 需求详述

### 2.1 管理员按省份分配

**痛点**：V2.6 之前，管理员是单一身份，未做"省"维度的责任划分；任何管理员都能看到/编辑所有赛事，权责不清。

**功能**：

| 项 | 要求 |
|----|------|
| 配置入口 | 超管 → 首页 → 管理 → 管理员配置 |
| 字段 | `admins.provinces`（数组，空数组=全国） |
| 多选 | 支持多选，**同一省可被多个管理员同时负责**（无唯一性约束） |
| 列表展示 | 管理员卡片下方显示负责省份 chip；空=全国 |
| 添加表单 | 新增弹窗底部"负责省份"多选 + 全选/清空 |
| 过滤规则 | 普通管理员进"赛事管理"页默认仅看自己负责省的赛事（`provinceScope='my'`）；超管默认看全部 |
| **撤销过滤** | 已 `revoked` 的管理员**不在列表显示**（不再需要"灰显+撤销"两态） |

**数据模型**（沿用 V2.6 末已加入的字段）：
```js
// admins
{
  userId, validFrom, validTo,
  permissions: ['approve_points','remove_user'],
  provinces: ['北京', '上海'],  // ← V2.7 显式化
  status: 'active' | 'expired' | 'revoked',
  ...
}
```

**前端派生**：管理员赛事列表展示「👤 负责人」tag——按赛事 `province` 反查 `admins`（provinces 含该省 + active + 有效期内）。一个赛事可有多个负责人；兜底：负责全国（provinces=[]）的也算。

---

### 2.2 赛事群二维码（v2.7 核心）

**背景**：参赛者找比赛群依赖二维码，但二维码有 7 天失效期（A 群、B 群、C 群等会定期更新）。当前问题：
- 找不到最新群
- 客户端无法自助反馈
- 管理员不知道谁负责更新

**功能矩阵**：

| 能力 | 字段/接口 | 触发方 |
|------|-----------|--------|
| 上传/更新二维码 | `race_events.qrCode` (cloud://) + `qrCodeUpdatedAt` (Date) | 管理员（任何 `provinces` 含赛事所在省） |
| 列表筛选 | `qrScope`: 全部 / 无 / 失效 | 管理端 |
| 客户端展示 | 不展示（避免群号被爬） | - |
| 用户主动通知 | `notifyRaceQrOwner` 云函数 | 客户端 |
| 系统定时通知 | `raceQrExpireNotify` 每天 10:00 | 云函数 |

**字段定义**：

```js
// race_events 新增
qrCode: 'cloud://cloud1-xxx/race_qrcode/xxx.png',  // 上传后写入
qrCodeUpdatedAt: new Date(),                        // 任何上传/更新都会刷新
```

**上传策略**：
- 上传一次 → 写入 `qrCode` + `qrCodeUpdatedAt=now()`
- 清空二维码 → `qrCode=''`，`qrCodeUpdatedAt=null`（不视为过期，仅视为"未上传"）
- **权限检查**：所有 `status='active'` 且 `provinces` 含 `race.province` 的管理员都能上传（不限于"唯一负责人"）

**过期判定**（前后端共用算法）：

```js
function calcQrStatus(qrCode, qrCodeUpdatedAt) {
  if (!qrCode || qrCode === '') return 'none';
  if (!qrCodeUpdatedAt) return 'ok';
  const days = (Date.now() - new Date(qrCodeUpdatedAt)) / 86400000;
  if (days >= 7) return 'expired';
  if (days >= 3) return 'ok';
  return 'fresh';  // 0~3 天视为新鲜
}
```

> **页面不展示更新时间字段**：二维码列表卡片只展示 `qrStatusText`（如"已过期 12 天"），表单中"二维码更新时间"仅作为编辑提示，不强制展示。

---

### 2.3 客户端"通知负责人"

**场景**：用户访问赛事详情页，发现：
- 二维码缺失（群还没建/上传）
- 二维码过期（截图已是 7 天前）

→ 一键通知负责人处理。

**UI 规范**：

| 元素 | 内容 |
|------|------|
| 位置 | 赛事详情页"我的状态"卡之后 |
| 触发条件 | `qrStatus === 'expired' \|\| qrStatus === 'none'` |
| 文案 | "⚠️ 群二维码已过期 / 📭 该赛事还未上传群二维码" |
| 按钮 | 「🔔 通知负责人处理」橙色按钮 |
| 点击行为 | 1. 请求订阅消息授权；2. 调用 `notifyRaceQrOwner`；3. toast 反馈结果 |

**文案**（订阅消息 thing2 限 20 字）：

| reason | 文案 | 含义 |
|--------|------|------|
| `expired` | `<赛事名>二维码过期啦` | 赛事名截断到 10 字 |
| `missing` | `<赛事名>还没上传二维码` | 同上 |

**去重**：同一赛事 + 同一 reason + 同一天 只通知一次（`qr_owner_notify_log` 集合）。

**订阅消息模板**：复用现有三字段模板 `xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew`（赛事倒计时模板）。

---

### 2.4 自动定时通知（10:00）

**为什么是 10:00**：避开 9:00 已有 `checkRaceNotify` 推送（用户赛事倒计时），并给 9:00 拉取的数据留落地时间。

**触发器**：

```json
// cloudfunctions/raceQrExpireNotify/config.json
{
  "triggers": [{
    "name": "dailyQrExpireNotify",
    "type": "timer",
    "config": "0 0 10 * * * *"
  }]
}
```

**扫描范围**：`race_events` 中所有 `status != 'finished'`（即将开始/进行中的赛事）。

**合并策略**：按 `province` 分组，每个 province 合并成一条通知推给该省所有 active 管理员。一个管理员负责多个省 → 收多条（每个省一条）。

**文案**：

```
thing2 = "<省> 缺N个/过期M个群二维码"   // N+M 触发缺/过期计数
time3  = "点此处理"
date1  = 今天日期
```

**点击行为**：跳 `/pages/admin/races/races?province=<省>`（管理端列表自动定位到该省筛选）。

**去重 / 防骚扰**：
- 一天只跑一次（`race_qr_expire_notify_log` 集合 dayKey 标记）
- 仅给 `status='active'` 且在有效期内的管理员推
- 找不到匹配负责人则写日志但不抛错

---

### 2.5 自动登录态恢复（修复遗留问题）

**痛点**：腾讯文档 cookie 2 小时过期，原 `update_saishi.js` 直接退出。Windows 计划任务在 10:00 触发时，用户若不在电脑前，cookie 必失效，整个链路阻塞。

**解决方案**：

1. **Node 层（`update_saishi.js`）**：新增 `fetchJsonWithRetry` 包装层
   - 检测 401/403 → 自动调用 `重新登录.ps1`
   - 等 5 分钟扫码窗口 → 重读 cookies.txt → 自动重试
   - 退出码：成功/超时分别打印

2. **PowerShell 层（`重新登录.ps1`）**：
   - 启动 Edge 调试模式 + 文档登录页
   - **浏览器窗口置顶**（AppActivate）
   - **系统通知**（Wscript.Shell.Popup，10 秒）
   - **写日志** `race-data/relogin.log`
   - 完成后通知用户"登录成功，自动导入将继续"

3. **命令行参数**：
   - 默认开启自动重登录
   - `node update_saishi.js --no-relogin` 关闭（恢复旧行为）

**适用场景**：
- ✅ 用户在家，电脑开着，10:00 自动跑 → cookie 过期 → 弹浏览器 + 系统通知 → 用户看到后扫码 → 自动继续
- ⚠️ 用户不在电脑前 → 浏览器弹窗无人扫码 → 5 分钟后放弃 → 写日志 → 第二天再试
- ❌ 电脑锁屏 → 浏览器可能看不到（建议配合"不锁屏"组策略）

---

## 3. 数据模型变更

| 集合 | 字段 | 类型 | 说明 |
|------|------|------|------|
| `race_events` | `qrCode` | String (cloud://) | 群二维码 fileID，可空 |
| `race_events` | `qrCodeUpdatedAt` | Date | 上传/更新时间，≥7天视为过期 |
| `race_events` | `province` | String | 举办省份，**新增/编辑赛事必填** |
| `admins` | `provinces` | Array of String | 负责省份数组（V2.6 末已加，V2.7 显式化使用） |
| `qr_owner_notify_log` | _new_ | - | 客户端通知日志，含 dayKey 去重 |
| `race_qr_expire_notify_log` | _new_ | - | 定时任务日志 |

> 赛事"负责人"字段（`responsibleAdminIds`）**未冗余存储**——按 province 反查 admins 派生。

---

## 4. 接口设计

### 4.1 `notifyRaceQrOwner`（客户端触发）

```js
// 入参
{ eventId, reporterId, reason: 'expired'|'missing' }

// 返回
{ success, sentCount, adminCount, deduped?, message?, error? }
```

**流程**：
1. 查赛事 → 取 province
2. 查 admins（provinces 含 province + active + 有效期内），找不到时兜底到 `provinces=[]`（全国组）
3. 查 users 取 openid → 调 `sendSubscribeMsg`
4. 写 `qr_owner_notify_log`（同 dayKey 去重）

### 4.2 `raceQrExpireNotify`（10:00 定时）

**触发方式**：cron `0 0 10 * * * *`

**入参**：无（由云函数自动触发）

**返回**：
```js
{ success, total, sentCount, provinces, deduped?, error? }
```

**流程**：
1. 查赛事 → 拆 `missing`（qrCode 为空）和 `expired`（qrCodeUpdatedAt ≥ 7 天前）两组
2. 按 province 分组，统计 `缺N个/过期M个`
3. 给每个 province 匹配管理员 + 兜底全国组 → 合并推送
4. 写 `race_qr_expire_notify_log`（按 dayKey 防重跑）

---

## 5. UI 规范

### 5.1 管理端赛事列表（`pages/admin/races/races.wxml`）

| 元素 | 变更 |
|------|------|
| 卡片 meta 行 | `省份 · 类型 · 等级 · 标牌 · 规模 · 报名状态`（不变） |
| 卡片 tag 行 | 新增 `👤 <负责人名>` tag（蓝色，超出 360rpx 截断省略号） |
| 筛选条 | 二维码筛选：`📱 全部二维码 / 无二维码 / 失效（≥7天）` |
| 默认 scope | 普通管理员 `provinceScope='my'`；超管 `='all'` |

### 5.2 客户端赛事详情（`pages/tools/calendar/detail.wxml`）

| 元素 | 变更 |
|------|------|
| 新增卡片 | 橙色边框 + 浅橙底，`qrStatus ∈ {'expired','none'}` 时显示 |
| 文案 | "⚠️ 群二维码已过期" 或 "📭 该赛事还未上传群二维码" |
| 按钮 | 「🔔 通知负责人处理」橙色按钮，点击触发订阅授权 + 云函数 |
| 点击反馈 | toast：`已通知 N 位负责人` / `今日已通知过负责人` / `暂无负责人在管此省` |

### 5.3 管理员配置（`pages/super-admin/manage.wxml`）

| 元素 | 变更 |
|------|------|
| 列表 | 仅 `status='active'` 的管理员展示；`revoked` 不展示 |
| 省份 chip | 沿用 V2.6 末 |
| 添加弹窗 | "负责省份"多选 + 全选/清空按钮 |

---

## 6. 兼容与迁移

- **存量数据省份补刷**：CSV 已带省份字段，绝大多数存量赛事应有 province；缺失的可走管理端手动补或云开发控制台批量回写
- **二维码字段**：存量赛事 `qrCode=''`、`qrCodeUpdatedAt=null`，状态 = `none`；管理员按需上传
- **管理员 provinces**：存量管理员 `provinces=[]`（=全国），行为兼容 V2.6

---

## 7. 涉及文件清单

| 文件 | 改动 |
|------|------|
| `cloudfunctions/notifyRaceQrOwner/{index.js,config.json,package.json}` | 新增 |
| `cloudfunctions/raceQrExpireNotify/{index.js,config.json,package.json}` | 新增 |
| `miniprogram/pages/super-admin/manage.js` | 撤销过滤 |
| `miniprogram/pages/admin/races/races.js` | 负责人派生 |
| `miniprogram/pages/admin/races/races.wxml` | 负责人 tag |
| `miniprogram/pages/admin/races/races.wxss` | owner-tag 样式 |
| `miniprogram/pages/tools/calendar/detail.js` | qrStatus + onNotifyOwner |
| `miniprogram/pages/tools/calendar/detail.wxml` | 通知卡片 |
| `miniprogram/pages/tools/calendar/detail.wxss` | qr-notice 样式 |
| `race-data/update_saishi.js` | 自动重登录 |
| `race-data/重新登录.ps1` | 浏览器置顶 + 通知 + 日志 |
| `docs/DEPLOY-v2.7.md` | 新增（部署文档） |
| `docs/PRD-v2.7.md` | 新增（本文件） |

---

## 8. 异常场景与风险

| 场景 | 处理 |
|------|------|
| 订阅消息用户未授权 | `wx.requestSubscribeMessage` 用户拒绝 → 云函数仍被调用但 `sendSubscribeMsg` 返回错误 → 日志记录 |
| 负责人多人/无 | 多人推送/无人则写日志，下一次 10:00 再推 |
| thing2 超 20 字 | 截断 + ellipsis（赛事名优先） |
| 自动重登录 5 分钟超时 | 写日志退出，第二天再跑 |
| 浏览器被锁屏挡住 | 配合系统通知 + 不锁屏组策略；否则靠用户主动发现 |
| 多管理员同时编辑同一赛事 | 现有架构允许（race_events 无锁）；上传二维码仅刷 `qrCodeUpdatedAt`，最后写赢 |
| 用户点 N 次"通知负责人" | `qr_owner_notify_log` dayKey 去重，今天只发一次 |

---

## 9. 后续迭代（v2.8 候选）

- 二维码失效前 1 天提前提醒（避免被动发现）
- 二维码上传后客户端立即可用（无需等 10:00 推送）
- 多管理员协作：一个省一个"主负责人"+若干"协助"
- 管理员手动标记"二维码已确认有效"作为快速响应通道
- 客户端赛事详情页可选展示"上传二维码"入口（仅在已关注且完赛后），提升用户参与度

---

更新时间：2026-10-10 · v2.7
