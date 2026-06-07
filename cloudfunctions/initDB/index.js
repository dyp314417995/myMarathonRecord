// 云函数：initDB - 初始化数据库集合和索引
// 部署后在小程序端调用一次即可
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const results = [];

  // 1. 创建 groups 集合（添加默认群组）
  try {
    const groupsCol = db.collection('groups');
    const countRes = await groupsCol.count();
    if (countRes.total === 0) {
      const defaultGroups = [
        { name: '一群', description: '官方一群', sort: 1, memberCount: 0, createTime: new Date() },
        { name: '二群', description: '官方二群', sort: 2, memberCount: 0, createTime: new Date() },
        { name: '分舵群', description: '分舵群', sort: 3, memberCount: 0, createTime: new Date() },
      ];
      for (const g of defaultGroups) {
        await groupsCol.add({ data: g });
      }
      results.push('groups 初始化完成：已添加 3 个默认群组');
    } else {
      results.push('groups 已存在，跳过初始化');
    }
  } catch (err) {
    results.push(`groups 初始化失败: ${err.message}`);
  }

  // 2. 检查 users 集合
  try {
    await db.collection('users').count();
    results.push('users 集合已就绪');
  } catch (err) {
    results.push(`users 集合检查: ${err.message}`);
  }

  // 3. 检查 admins 集合
  try {
    await db.collection('admins').count();
    results.push('admins 集合已就绪');
  } catch (err) {
    results.push(`admins 集合检查: ${err.message}`);
  }

  // 4. 检查 join_requests 集合
  try {
    await db.collection('join_requests').count();
    results.push('join_requests 集合已就绪');
  } catch (err) {
    results.push(`join_requests 集合检查: ${err.message}`);
  }

  return { success: true, results };
};
