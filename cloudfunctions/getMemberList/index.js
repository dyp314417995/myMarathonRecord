// 云函数 getMemberList - 跑友名录：一次返回全量成员（含头像临时URL、群组名）
// 解决客户端循环拉取+逐个转头像导致的 6-7 秒慢加载
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAGE = 100; // 云函数单次查询上限

exports.main = async (event) => {
  const full = !!(event && event.full); // full=true 返回完整字段（用户管理用）
  try {
    // 1. 拉全量群组，建 id→name 映射
    const groupsRes = await db.collection('groups').get();
    const groupMap = {};
    groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });

    // 2. 分页拉全量用户（用 _id 游标，避免 skip 越往后越慢）
    const allUsers = [];
    let lastId = '';
    while (true) {
      let query = {};
      if (lastId) query._id = _.gt(lastId);
      const res = await db.collection('users')
        .where(query)
        .orderBy('_id', 'asc')
        .limit(PAGE)
        .get();
      const users = res.data || [];
      if (users.length === 0) break;
      allUsers.push(...users);
      if (users.length < PAGE) break;
      lastId = users[users.length - 1]._id;
    }

    // 3. 批量转换 cloud:// 头像（getTempFileURL 单次上限 50 个）
    const cloudIds = allUsers
      .map(u => u.avatarUrl || '')
      .filter(url => url.startsWith('cloud://'));
    const uniqueCloudIds = [...new Set(cloudIds)];
    const urlMap = {};
    for (let i = 0; i < uniqueCloudIds.length; i += 50) {
      try {
        const r = await cloud.getTempFileURL({ fileList: uniqueCloudIds.slice(i, i + 50) });
        (r.fileList || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch (e) {
        console.error('getTempFileURL batch failed:', e.message);
      }
    }

    // 4. 组装最终数据
    const list = allUsers.map(u => {
      const raw = u.avatarUrl || '';
      let avatar = raw;
      if (raw.startsWith('cloud://')) avatar = urlMap[raw] || raw; // 转换失败保留 cloud:// 原值
      // 其他格式（wxfile://、过期 https 等）保持原样，由前端 onAvatarError 回退默认图

      const groupName = (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入';

      if (full) {
        // 用户管理：返回完整字段
        return { ...u, avatarUrl: avatar, groupName };
      }
      // 跑友名录：只返回列表需要的字段
      return {
        _id: u._id,
        nickName: u.nickName || '',
        avatarUrl: avatar,
        city: u.city || '',
        pb10k: u.pb10k || '',
        pbHalf: u.pbHalf || '',
        pbFull: u.pbFull || '',
        groupName,
        createTime: u.createTime || null,
      };
    });

    return { ok: true, list, total: list.length };
  } catch (err) {
    console.error('getMemberList error:', err);
    return { ok: false, msg: err.message };
  }
};
