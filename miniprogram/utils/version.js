// utils/version.js - 版本号与更新检测
// 本地版本号（每次发版时手动递增）
const LOCAL_VERSION = '2.6.1';

/** 获取本地版本号 */
function getLocalVersion() {
  return LOCAL_VERSION;
}

/** 从数据库读取最新版本信息（app_config 集合） */
async function getRemoteVersion() {
  try {
    const db = wx.cloud.database();
    const res = await db.collection('app_config').where({ key: 'version' }).limit(1).get();
    if (res.data && res.data.length > 0) {
      const cfg = res.data[0];
      return {
        version: cfg.value || LOCAL_VERSION,
        updateTime: cfg.updateTime || '',
      };
    }
  } catch (e) { /* 集合不存在或读取失败，返回本地版本 */ }
  return { version: LOCAL_VERSION, updateTime: '' };
}

/** 比较版本号：a > b 返回 1，a < b 返回 -1，相等返回 0 */
function compareVersion(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 检测是否有新版本（云端版本 > 本地版本） */
async function checkUpdate() {
  const remote = await getRemoteVersion();
  const hasNew = compareVersion(remote.version, LOCAL_VERSION) > 0;
  return { ...remote, localVersion: LOCAL_VERSION, hasNew };
}

module.exports = { getLocalVersion, getRemoteVersion, compareVersion, checkUpdate, LOCAL_VERSION };
