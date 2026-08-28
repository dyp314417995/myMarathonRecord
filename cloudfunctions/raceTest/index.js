// raceTest - 极简测试函数（临时，定位 -3 报错用）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  return { ok: true, now: Date.now(), openid: (cloud.getWXContext() || {}).OPENID || '' };
};