# 我的跑马记录 — PRD 产品需求文档 v1.0

> 版本：V1.0 | 日期：2026-06-05 | 模块：用户管理

## 基本信息

- 小程序名称：我的跑马记录
- AppID：`wx07a1eccd2cbf673e`
- 云环境 ID：`cloud1-d5gy0iuiba5f9300f`
- 代码仓库：`https://github.com/dyp314417995/myMarathonRecord.git`
- 目标用户：马拉松爱好者

---

## 1. 用户角色

| 角色 | 说明 | 标识字段 |
|------|------|----------|
| 超级管理员 | 系统唯一，可配置管理员 | `users.role = 'super_admin'` |
| 管理员 | 由超管配置，有有效期和权限范围 | `admins` 集合管理 |
| 普通用户 | 默认角色，可多选加入跑群 | `users.role = 'user'` |

---

## 2. 功能模块

### 2.1 用户注册/登录

- 打开小程序即进入登录页
- 授权获取微信头像、昵称
- 手机号：支持微信一键获取（需认证）+ 手动输入
- 城市：省-市-区三级联动选择器
- PB 成绩（选填）：10公里/半马/全马，HH:MM:SS 时间选择器
- 选择所属群（可多选）：☑ 勾选任意群，可同时加入多个
- 选择群组后 status=pending，需管理员逐个审批
- 已注册用户再次打开自动跳首页

### 2.2 超管功能

- 配置管理员：选择用户 → 设有效期 → 勾选权限范围
- 权限范围：审批加入 / 移除用户
- 同样拥有管理员的所有权限

### 2.3 管理员功能

- 审批用户加群申请（通过/拒绝）
- 用户管理（查看列表、移出群组）
- 群组管理（增删改、上移/下移排序、上传群二维码）

### 2.4 普通用户功能

- 查看/编辑个人资料
- 多选修改所属群

---

## 3. 数据库设计

### 3.1 users 集合

| 字段 | 类型 | 说明 |
|------|------|------|
| _openid | String | 微信标识（自动） |
| nickName | String | 微信昵称 |
| avatarUrl | String | 微信头像 |
| phoneNumber | String | 手机号 |
| city | String | 省-市-区，如 "广东省-深圳市-南山区" |
| pb10k | String | 10公里PB，如 "0:50:00" |
| pbHalf | String | 半马PB，如 "2:00:00" |
| pbFull | String | 全马PB，如 "3:30:00" |
| role | String | super_admin / admin / user |
| groupIds | Array | 所属群 ID 数组，`[]` = 未加入 |
| status | String | pending / approved / rejected |
| createTime | Date | 创建时间 |
| updateTime | Date | 更新时间 |

### 3.2 admins 集合

| 字段 | 类型 | 说明 |
|------|------|------|
| userId | String | 关联 users._id |
| validFrom | Date | 有效期开始 |
| validTo | Date | 有效期结束 |
| permissions | Array | ['approve_join', 'remove_user'] |
| status | String | active / expired / revoked |
| createTime | Date | 创建时间 |

### 3.3 groups 集合

| 字段 | 类型 | 说明 |
|------|------|------|
| name | String | 一群 / 二群 / 分舵群 |
| description | String | 群描述 |
| qrCode | String | 群二维码云存储 fileID（可选） |
| memberCount | Number | 成员数 |
| sort | Number | 排序 |
| createTime | Date | 创建时间 |

### 3.4 join_requests 集合

| 字段 | 类型 | 说明 |
|------|------|------|
| userId | String | 申请人 |
| groupId | String | 目标群 |
| status | String | pending / approved / rejected |
| reviewedBy | String | 审核人 |
| reviewTime | Date | 审核时间 |
| createTime | Date | 申请时间 |

---

## 4. 页面架构

```
pages/login/login              → 登录注册页（首页）
pages/home/home                → 角色面板（根据角色显示不同功能入口）
pages/profile/profile          → 个人资料（查看/编辑）
pages/admin/approval/approval  → 审批加入（管理员）
pages/admin/users/users        → 用户管理（管理员）
pages/admin/groups/groups      → 群组管理（管理员）
pages/super-admin/manage       → 管理员配置（超管）
```

### 页面流程图

```
[打开小程序]
     ↓
[login 登录注册]
     ↓ 提交
[home 首页面板]
  ├─ 超管 ──→ manage（配置管理员）
  │         → approval（审批）
  │         → users（用户管理）
  │         → groups（群组管理）
  ├─ 管理员 → approval / users / groups
  └─ 普通用户 → profile（个人资料）
```

---

## 5. 组件清单

| 组件 | 路径 | 用途 |
|------|------|------|
| city-picker | components/city-picker | 省市区三级联动选择器 |
| time-picker | components/time-picker | HH:MM:SS 时间选择器 |

---

## 6. 云函数

| 函数 | 用途 |
|------|------|
| getPhoneNumber | 微信手机号解密 |
| initDB | 首次部署时初始化默认群组数据 |
