// utils/db.js - 数据库操作工具

const db = wx.cloud.database();
const _ = db.command;

/**
 * 数据库集合设计:
 * 
 * ┌─────────────────────────────────────────────────────┐
 * │ users 集合 - 用户表                                   │
 * ├──────────────┬──────────────────────────────────────┤
 * │ _openid      │ 微信自动生成的用户标识 (String)         │
 * │ nickName     │ 微信昵称 (String)                     │
 * │ avatarUrl    │ 微信头像 (String)                     │
 * │ phoneNumber  │ 手机号 (String)                       │
 * │ city         │ 城市 (String)                         │
 * │ pb10k        │ 10公里PB, 格式1:32:59 (String,选填)    │
 * │ pbHalf       │ 半马PB (String,选填)                   │
 * │ pbFull       │ 全马PB (String,选填)                   │
 * │ role         │ 角色: 'super_admin'|'admin'|'user'   │
 * │ groupIds     │ 所属群ID数组, []=未加入 (Array)         │
 * │ status       │ 状态: 'pending'|'approved'|'rejected' │
 * │ createTime   │ 创建时间 (Date)                       │
 * │ updateTime   │ 更新时间 (Date)                       │
 * ├──────────────┴──────────────────────────────────────┤
 * │ groups 集合 - 群组表                                  │
 * ├──────────────┬──────────────────────────────────────┤
 * │ name         │ 群名称                                │
 * │ description  │ 群介绍 (String)                       │
 * │ remark       │ 备注, 默认"群已满，请联系管理员邀请加入" │
 * │ qrCode       │ 二维码 cloud:// fileID                │
 * │ memberCount  │ 成员数                                │
 * │ sort         │ 排序                                  │
 * │ createTime   │ 创建时间                              │
 * ├──────────────┴──────────────────────────────────────┤
 * │ 安全规则: doc._openid == auth.openid (用户仅读写自己) │
 * └─────────────────────────────────────────────────────┘
 * 
 * ┌─────────────────────────────────────────────────────┐
 * │ admins 集合 - 管理员配置表 (仅超管可读写)              │
 * ├──────────────┬──────────────────────────────────────┤
 * │ _id          │ 自动生成                              │
 * │ userId       │ 关联 users._id (String)               │
 * │ validFrom    │ 有效期开始 (Date)                     │
 * │ validTo      │ 有效期结束 (Date)                     │
 * │ permissions  │ 权限: ['approve_join','remove_user']  │
 * │ status       │ 'active'|'expired'|'revoked'          │
 * │ createTime   │ 创建时间 (Date)                       │
 * │ createdBy    │ 创建者(超管) _openid                   │
 * ├──────────────┴──────────────────────────────────────┤
 * │ 安全规则: 仅创建者可读写                              │
 * └─────────────────────────────────────────────────────┘
 * 
 * ┌─────────────────────────────────────────────────────┐
 * │ groups 集合 - 群组表 (仅管理员可读写)                  │
 * ├──────────────┬──────────────────────────────────────┤
 * │ _id          │ 自动生成                              │
 * │ name         │ 群名称 (String): 一群/二群/分舵群      │
 * │ description  │ 群描述 (String)                       │
 * │ memberCount  │ 成员数 (Number)                       │
 * │ sort         │ 排序 (Number)                         │
 * │ createTime   │ 创建时间 (Date)                       │
 * └─────────────────────────────────────────────────────┘
 * 
 * ┌─────────────────────────────────────────────────────┐
 * │ join_requests 集合 - 加群申请表                       │
 * ├──────────────┬──────────────────────────────────────┤
 * │ _id          │ 自动生成                              │
 * │ userId       │ 申请人 users._id                      │
 * │ groupId      │ 申请加入的群 groups._id               │
 * │ status       │ 'pending'|'approved'|'rejected'       │
 * │ reviewedBy   │ 审核人 users._id                      │
 * │ reviewTime   │ 审核时间 (Date)                       │
 * │ createTime   │ 申请时间 (Date)                       │
 * └─────────────────────────────────────────────────────┘
 */

// ============ 用户操作 ============

/** 根据 openid 获取当前用户 */
async function getCurrentUser() {
  const res = await db.collection('users').where({
    _openid: '{openid}'
  }).get();
  return res.data.length > 0 ? res.data[0] : null;
}

/** 创建/注册用户 */
async function createUser(data) {
  const now = new Date();
  return await db.collection('users').add({
    data: {
      ...data,
      role: 'user',
      status: 'approved',
      createTime: now,
      updateTime: now,
    }
  });
}

/** 更新用户信息 */
async function updateUser(userId, data) {
  return await db.collection('users').doc(userId).update({
    data: { ...data, updateTime: new Date() }
  });
}

/** 获取用户列表 (管理员用) */
async function getUserList(condition = {}, skip = 0, limit = 100) {
  return await db.collection('users').where(condition).orderBy('createTime', 'desc').orderBy('_id', 'desc').skip(skip).limit(limit).get();
}

/** 获取用户总数 */
async function getUserCount(condition = {}) {
  const res = await db.collection('users').where(condition).count();
  return res.total;
}

// ============ 群组操作 ============

/** 获取所有群组 */
async function getGroups() {
  return await db.collection('groups').orderBy('sort', 'asc').get();
}

/** 创建群组 */
async function createGroup(data) {
  return await db.collection('groups').add({
    data: { ...data, memberCount: 0, createTime: new Date() }
  });
}

/** 删除群组 */
async function deleteGroup(groupId) {
  return await db.collection('groups').doc(groupId).remove();
}

/** 更新群组 */
async function updateGroup(groupId, data) {
  return await db.collection('groups').doc(groupId).update({ data });
}

// ============ 管理员操作 ============

/** 获取管理员列表 */
async function getAdminList() {
  return await db.collection('admins').orderBy('createTime', 'desc').get();
}

/** 创建管理员配置 */
async function createAdmin(data) {
  return await db.collection('admins').add({
    data: { ...data, createTime: new Date() }
  });
}

/** 更新管理员配置 */
async function updateAdmin(adminId, data) {
  return await db.collection('admins').doc(adminId).update({ data });
}

/** 检查用户是否为管理员 (有效期内) */
async function checkIsAdmin(userId) {
  const now = new Date();
  const res = await db.collection('admins').where({
    userId: userId,
    status: 'active',
    validFrom: _.lte(now),
    validTo: _.gte(now),
  }).get();
  return res.data.length > 0 ? res.data[0] : null;
}

/** 检查用户是否为超管 */
async function checkIsSuperAdmin(userId) {
  const res = await db.collection('users').doc(userId).get();
  return res.data && res.data.role === 'super_admin';
}

// ============ 审批操作 ============

/** 创建加群申请 */
async function createJoinRequest(userId, groupId) {
  return await db.collection('join_requests').add({
    data: {
      userId, groupId,
      status: 'pending',
      createTime: new Date()
    }
  });
}

/** 获取待审批列表 */
async function getPendingRequests() {
  return await db.collection('join_requests')
    .where({ status: 'pending' })
    .orderBy('createTime', 'asc')
    .get();
}

/** 审批加群申请 */
async function reviewRequest(requestId, status, reviewerId) {
  return await db.collection('join_requests').doc(requestId).update({
    data: { status, reviewedBy: reviewerId, reviewTime: new Date() }
  });
}

module.exports = {
  db, _,
  getCurrentUser, createUser, updateUser, getUserList, getUserCount,
  getGroups, createGroup, updateGroup, deleteGroup,
  getAdminList, createAdmin, updateAdmin, checkIsAdmin, checkIsSuperAdmin,
  createJoinRequest, getPendingRequests, reviewRequest,
};
