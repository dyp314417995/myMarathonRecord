# PRD 产品需求文档 v2.4 — 每日签到 + 连续奖励 + 补签卡

> 版本：V2.4 | 状态：迭代四 | 模块：签到积分系统

---

## 1. 概述

新增「每日签到」功能，与现有积分体系打通：
- 每日可签到 1 次（自然日，0 点~24 点），基础积分由超管在「积分规则」中配置名称为 **签到** 的规则（未配置时兜底 +1 分）
- 连续签到阶梯奖励：7 的倍数天额外 +5，30 的倍数天额外 +20，同时命中可叠加
- 补签卡体系：注册赠送 2 张 / 连续 7 天里程碑获赠 1 张 / 30 积分兑换（每月最多 3 张）
- **所有时间判断强制使用服务器时间（东八区）**，签到/兑换/补签均在云函数内通过**数据库事务**完成，防篡改、防并发刷分

---

## 2. 签到规则

| 项目 | 规则 |
|------|------|
| 周期 | 每日 1 次，自然日（0 点~24 点，按服务器东八区时间） |
| 基础分 | 读取积分规则中名称为「签到」的 `points`；未配置/禁用时兜底 **+1** |
| 连续判定 | `last_sign_date == 昨天` → 连续天数 +1；否则重置为 1 |
| 重复签到 | `last_sign_date == 今天` → 拦截「今日已签到」 |

### 2.1 连续奖励（阶梯式）

| 连续天数 | 额外奖励 |
|------|------|
| 7 的倍数（7/14/21/28/35…） | +5 |
| 30 的倍数（30/60/90…） | +20 |
| 同时命中（如第 210 天） | +5 +20 叠加 |

> 说明：方案原文中「第 37 天」为笔误，按「7 的倍数」规则实际为第 35 天触发。

### 2.2 断签与补签

| 场景 | 处理 |
|------|------|
| 昨天已签，今天签 | 连续 +1，正常发放奖励 |
| 昨天未签（仅断昨天），今天签 | 弹窗询问是否使用补签卡：使用则补签昨天（+基础分，连续天数不变）后今天仍为连续；跳过则连续重置为 1 |
| 前天及更早断签 | 无法挽回，补签卡仅限补昨天；连续重置为 1 |
| 今天已签，再次点击 | 拦截 |

---

## 3. 补签卡规则

| 项目 | 规则 |
|------|------|
| 有效期 | 30 天（自获得/兑换时刻起算），`expire_at > NOW()` 视为有效（不包含等于） |
| 使用顺序 | 优先使用即将过期的（`expire_at` 最早） |
| 临期提醒 | 剩余 ≤3 天时，签到页补签卡入口显示小红点 |
| 补签范围 | 仅限补签昨天（前天已签、昨天无签到记录；今天未签或今天已签均可补） |
| 补签收益 | 仅 +基础分，不触发任何额外奖励；今天未签时 `continuous_days` 不变，今天已签时连续天数补齐为「昨天+今天」=2 |
| 持有上限 | 10 张（有效卡），达上限后不再获得（含里程碑赠送与兑换） |

### 3.1 获取方式

| 途径 | 数量 | 说明 |
|------|------|------|
| 新用户注册 | 2 张 | 仅首次注册发放 |
| 连续签到满 7 天（7 的倍数里程碑） | 1 张 | 每次触发附带赠送 |
| 积分兑换 | 1 张 | 30 积分/张，每月最多 3 张（按自然月 `YYYY-MM` 统计），先扣积分再发卡（同一事务） |
| 运营活动 | - | 预留 `source=4`，后台手动发放 |

### 3.2 老用户补发
- 功能上线前已注册、且从未获得过补签卡的用户（`users.signin_cards_granted != true`），在首页首次加载时一次性补发 2 张（仅一次，发后写标记）

---

## 4. 数据模型

### 4.1 `user_signin`（签到汇总，userId 为主键）

```js
{
  _id: String,               // = userId
  userId: String,
  total_score: Number,       // 签到累计获得积分
  continuous_days: Number,   // 当前连续签到天数
  last_sign_date: String,    // 'YYYY-MM-DD'（东八区自然日）
  max_continuous_days: Number, // 历史最高连续天数
  updated_at: Date,
  createTime: Date,
}
```

### 4.2 `signin_detail`（签到明细）

```js
{
  _id: String,
  userId: String,
  sign_date: String,        // 'YYYY-MM-DD'
  score_earned: Number,     // 本次获得总积分
  base_score: Number,       // 基础分
  bonus_score: Number,      // 额外奖励分（0/5/20）
  is_continuous: Number,    // 0/1
  is_makeup: Number,        // 0/1 是否补签
  created_at: Date,
}
```

### 4.3 `makeup_card`（补签卡）

```js
{
  _id: String,
  userId: String,
  source: Number,           // 1注册赠送 2连续签到奖励 3积分兑换 4运营活动
  expire_at: Date,          // 获得时间 + 30 天
  status: Number,           // 0可使用 1已使用 2已过期
  used_at: Date,            // null=未使用
  created_at: Date,
}
```

### 4.4 `score_exchange`（积分兑换记录）

```js
{
  _id: String,
  userId: String,
  exchange_type: Number,    // 1=补签卡
  score_cost: Number,       // 30
  quantity: Number,         // 1
  month: String,            // 'YYYY-MM'，用于月度限额统计
  created_at: Date,
}
```

### 4.5 与现有积分体系打通
- 签到/补签积分写入 `points_records`（`category='签到'`，`type='earn'`，`status='approved'`，有效期 365 天，与注册赠送/集体活动一致）
- 兑换扣减写入 `points_records`（`category='兑换补签卡'`，`type='use'`，`points=-30`）
- 同步增量更新 `users.points` 余额，积分首页/明细页直接可见

> 建议在云数据库控制台为 `makeup_card(userId,status)`、`signin_detail(userId,sign_date)`、`score_exchange(userId,month)` 添加组合索引。

---

## 5. 接口设计（云函数 `signin`）

| action | 入参 | 说明 |
|--------|------|------|
| `info` | - | 签到页数据：今日状态/连续天数/预览/补签卡数量/临期数量/余额/本月兑换/本月签到日历 |
| `sign` | `useCard` | 签到（含补签分支）；事务保证不重复签到、里程碑赠卡 |
| `cards` | - | 补签卡列表（含有效状态换算） |
| `exchange` | - | 积分兑换补签卡；事务：先扣积分再发卡 |
| `useCard` | `cardId` | 单独使用补签卡补签昨天 |

所有 action 通过 `cloud.getWXContext().OPENID` 定位用户，禁止客户端传 userId（防伪造）。

---

## 6. 涉及文件

| 文件 | 改动 |
|------|------|
| `cloudfunctions/signin/index.js` / `package.json` | 新增签到云函数（服务器时间、事务、防刷） |
| `cloudfunctions/makeupCardExpireCheck/index.js` / `package.json` / `config.json` | 新增每日 00:05 定时任务：过期补签卡标记 status=2 |
| `cloudfunctions/initDB/index.js` | 新增创建 user_signin / signin_detail / makeup_card / score_exchange 集合 |
| `miniprogram/utils/signin.js` | 新增客户端封装 |
| `miniprogram/pages/signin/index.*` | 新增签到页（连续天数/签到按钮/月历/补签卡入口/兑换弹窗） |
| `miniprogram/pages/signin/cards.*` | 新增补签卡列表页 |
| `miniprogram/app.json` | 注册两个新页面 |
| `miniprogram/pages/home/home.wxml` / `home.js` | 「小工具」新增每日签到入口；老用户补发补签卡 |
| `miniprogram/pages/login/login.js` | 新用户注册赠送 2 张补签卡 |
| `miniprogram/pages/points/index.wxml` / `index.js` / `index.wxss` | 新增「每日签到」「兑换补签卡」入口 |

---

## 7. 部署清单

1. 部署云函数：`signin`、`makeupCardExpireCheck`（含定时触发器）
2. 执行一次 `initDB`（或首次调用 `signin` 会自动建集合）
3. 超管在「积分管理 → 规则」新增名称为 **签到** 的规则并配置积分值/描述
4. 发布小程序前端
5. （可选）控制台添加组合索引

---

## 8. 异常场景

| 场景 | 处理 |
|------|------|
| 23:59 签到跨日 | 以服务器东八区自然日为准，`sign_date` 与 `last_sign_date` 均为日期字符串 |
| 并发重复签到 | `sign` 事务内二次校验 `last_sign_date`，事务冲突返回「签到处理中，请勿重复操作」 |
| 补签卡刚好在 00:00 过期 | 有效性判断 `expire_at > NOW()`，不包含等于 |
| 兑换时扣积分后发卡失败 | 同一数据库事务，全成功或全回滚 |
| 持有 10 张时触发里程碑 | 不发放，提示「库存已满」；兑换同样拦截 |
| 老用户无卡 | 首页一次性补发 2 张（写 `signin_cards_granted` 标记防重复） |