# 部署文档 v2.7 — 管理员省份 + 群二维码 + 通知负责人

> 适用版本：V2.7 | 基于 V2.6 已部署环境 | 模块：管理员配置升级 / 赛事群二维码 / 二维码自动通知

---

## 概述

V2.7 在 V2.6 基础上增加三块能力：

1. **管理员按省份分配** — 超管可在添加/编辑管理员时分配多省，已撤销的管理员不在列表显示
2. **赛事群二维码** — 赛事增加 `qrCode` + `qrCodeUpdatedAt` 字段，管理员上传/更新后自动记录更新时间（≥7天视为失效）
3. **二维码通知闭环**
   - 客户端：用户发现二维码过期/缺失 → 点击通知负责该省的管理员
   - 定时：每天 10:00 扫描全量赛事，按省合并后通知负责人（多条赛事一次推完）

---

## 一、新增内容

| 类型 | 名称 | 说明 |
|------|------|------|
| 云函数 | `notifyRaceQrOwner` | 客户端触发：按赛事 province 找负责人 → 发订阅消息 |
| 云函数 | `raceQrExpireNotify` | 每天 10:00 定时：扫描过期/缺失二维码 → 按省合并通知 |
| 集合 | `qr_owner_notify_log` | 客户端通知日志（去重：同赛事同原因一天只通知一次） |
| 集合 | `race_qr_expire_notify_log` | 定时任务日志 |
| 字段 | `race_events.qrCode` | 群二维码 cloud:// fileID |
| 字段 | `race_events.qrCodeUpdatedAt` | 上传/更新时间（≥7天视为过期） |
| 字段 | `race_events.province` | 举办省份（CSV/表单写入，**必填**） |
| 字段 | `admins.provinces` | 管理员负责省份数组（空数组=全国） |

> ⚠️ `provinces` 字段在 V2.6 末已加入 `admins` 集合并可读写，本次只是配套 UI/逻辑补齐。

---

## 二、部署步骤

### 2.1 上传两个新云函数

微信开发者工具右键对应目录 → **「上传并部署：云端安装依赖」**：

- `cloudfunctions/notifyRaceQrOwner/`
- `cloudfunctions/raceQrExpireNotify/`

部署完成后，云开发控制台 → 云函数 应能看到这两个函数的状态为「部署成功」。

`raceQrExpireNotify` 的定时触发器（每天 10:00）会自动随 `config.json` 创建，无需手动配置。可在 控制台 → 云函数 → raceQrExpireNotify → 触发管理 确认 cron 表达式为 `0 0 10 * * * *`。

### 2.2 新集合（首次调用时自动建）

`qr_owner_notify_log` 和 `race_qr_expire_notify_log` 在云函数首次执行 `db.collection(...).add(...)` 时会自动创建，**无需手动**。如需提前建：

| 集合名 | 权限建议 |
|--------|:---:|
| `qr_owner_notify_log` | 仅创建者可读写 |
| `race_qr_expire_notify_log` | 仅创建者可读写 |

### 2.3 存量数据省份补刷

V2.7 之前导入的赛事，CSV 已带省份字段，存量数据应该已带 `province`。如发现某条赛事 `province` 为空：

- **方案 A（手动）**：管理端 → 赛事管理 → 编辑该赛事 → 选省份 → 保存
- **方案 B（批量）**：云开发控制台 → 数据库 → 高级查询：

```js
db.collection('race_events').where({
  province: _.in(['', null])
}).update({
  data: { /* 按名称匹配省份，或人工筛 */ }
})
```

> 建议先 `getRaceEvents` 按 `publishFilter='all'` 导出缺失省份的列表人工补完，再批量回写。

### 2.4 字段索引（可选，建议）

控制台 → 数据库 → race_events → 索引管理：

| 索引字段 | 用途 |
|---------|------|
| `{ province: 1 }` | 按省份过滤 |
| `{ qrCodeUpdatedAt: 1 }` | 过期扫描 |
| `{ province: 1, qrCodeUpdatedAt: 1 }` | 复合索引（按省查过期） |

`admins` 集合：
| `{ status: 1, validTo: 1 }` | 查找有效期内管理员 |

### 2.5 订阅消息模板

V2.7 **复用**现有模板 `xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew`（赛事倒计时三字段模板：`date1` / `thing2` / `time3`），文案适配：

| 场景 | thing2 文案 | time3 |
|------|------------|------|
| 二维码过期 | `<赛事名>二维码过期啦` | 请尽快更新 |
| 二维码未上传 | `<赛事名>还没上传二维码` | 请尽快上传 |
| 定时合并通知 | `<省> 缺N个/过期M个群二维码` | 点此处理 |

> thing2 限 20 字，赛事名称过长会截断。如需要更精准的提示，可在微信公众平台申请专用模板（仅推荐有现成模板时复用）。

### 2.6 本地 PowerShell 自动登录脚本（修复遗留问题）

V2.7 修复了 10:00 自动导入链路"登录态过期后无法继续"的问题：

- `race-data/update_saishi.js` — 新增 `fetchJsonWithRetry` 包装层；遇 401/403 自动调用 `重新登录.ps1`，5 分钟内等用户扫码后自动重试
- `race-data/重新登录.ps1` — 浏览器窗口置顶 + 系统通知 + 写 `relogin.log`；捕获完成后 `update_saishi.js` 自动继续

新增命令行参数：

```bash
node update_saishi.js                  # 增量（默认开启自动重登录）
node update_saishi.js --force          # 强制全量
node update_saishi.js --no-relogin     # 关闭自动重登录（回到旧行为）
```

无需额外部署。

---

## 三、功能验收 Checklist

### 3.1 管理员按省份

- [ ] 超管可添加管理员并多选省份
- [ ] 同一省份可被多个管理员选择
- [ ] 管理员卡片显示负责的省份（无负责省显示"全国"）
- [ ] 撤销管理员后，从列表消失
- [ ] 普通管理员进赛事管理页，默认看到的是自己负责省的赛事

### 3.2 群二维码

- [ ] 赛事表单有"群二维码"上传入口（最多 1 张）
- [ ] 上传后 `qrCodeUpdatedAt` 自动写入当前日期
- [ ] 编辑赛事时"二维码更新时间"在表单中**不展示**（仅在赛事列表状态栏内可见）
- [ ] 赛事列表筛选"📱 无二维码"显示无二维码赛事
- [ ] 赛事列表筛选"📱 失效"显示 `qrCodeUpdatedAt` 距今 ≥7 天的赛事
- [ ] 任何 `provinces` 包含赛事所在省的 active 管理员都能上传/更新二维码（不限于"负责人"）

### 3.3 客户端通知负责人

- [ ] 客户端赛事详情页在 `qrStatus==='expired'` 或 `qrStatus==='none'` 时显示橙色提示卡
- [ ] 点击「🔔 通知负责人处理」弹出订阅消息授权
- [ ] 同意授权后，云函数 `notifyRaceQrOwner` 被调用
- [ ] 当天重复点同一赛事会收到"今日已通知过负责人"
- [ ] `qr_owner_notify_log` 集合有对应记录

### 3.4 10:00 自动通知

- [ ] 云开发控制台 → raceQrExpireNotify → 触发管理 可见 cron `0 0 10 * * * *`
- [ ] 手动触发一次（控制台 → 测试），`race_qr_expire_notify_log` 写入记录
- [ ] 收到订阅消息的文案为「`<省> 缺N个/过期M个群二维码`」
- [ ] 一个管理员一次只收到一条合并通知（即使负责多个省也会按省分多条）
- [ ] 通知点击后跳到 `/pages/admin/races/races?province=<省>`

---

## 四、涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `cloudfunctions/notifyRaceQrOwner/{index.js,config.json,package.json}` | 新增 | 客户端通知云函数 |
| `cloudfunctions/raceQrExpireNotify/{index.js,config.json,package.json}` | 新增 | 10:00 定时通知 |
| `miniprogram/pages/super-admin/manage.js` | 修改 | 撤销过滤、列表只展示 active |
| `miniprogram/pages/admin/races/races.js` | 修改 | 负责人派生 + raceList 加 responsibleAdminName |
| `miniprogram/pages/admin/races/races.wxml` | 修改 | 列表卡片加负责人 tag |
| `miniprogram/pages/admin/races/races.wxss` | 修改 | owner-tag 样式 |
| `miniprogram/pages/tools/calendar/detail.js` | 修改 | qrStatus 派生 + onNotifyOwner |
| `miniprogram/pages/tools/calendar/detail.wxml` | 修改 | 通知负责人卡片 |
| `miniprogram/pages/tools/calendar/detail.wxss` | 修改 | qr-notice 样式 |
| `race-data/update_saishi.js` | 修改 | 自动重登录逻辑 |
| `race-data/重新登录.ps1` | 修改 | 浏览器置顶 + 系统通知 + 日志 |

---

## 五、回滚方案

如新功能上线后出问题：

1. **客户端通知失效**：把 `detail.wxml` 的 qr-notice 卡片 `wx:if` 改为 `false`，不影响其他功能
2. **10:00 通知失效**：云开发控制台 → raceQrExpireNotify → 触发管理 → 禁用触发器
3. **管理员省份问题**：超管可在「管理员配置」页直接编辑/撤销，问题数据不会扩散（仅影响列表过滤）
4. **自动重登录无效**：`node update_saishi.js --no-relogin` 关闭，或临时手动跑 `重新登录.ps1`

---

## 六、已知限制

| 限制 | 说明 |
|------|------|
| thing2 字数 | 微信订阅消息 thing2 限 20 字，赛事名过长会被截断（如"2027 哥本哈根半程马拉松2026" → 截到 9 字+提示语） |
| 订阅消息授权 | 每个用户每个模板只能授权一次，长期使用需引导用户在订阅中心保持开启 |
| 自动重登录依赖桌面会话 | Windows 计划任务在锁屏/无人值守时弹出浏览器可能看不到，建议配合系统通知 + 不锁屏策略 |

---

更新时间：2026-10-10 · v2.7
