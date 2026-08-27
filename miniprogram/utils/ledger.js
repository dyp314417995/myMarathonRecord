// utils/ledger.js - 跑步账本
const BIG_CATS = [
  { key: 'daily', label: '日常开支' },
  { key: 'race', label: '比赛开支' },
];
const DAILY_SUBS = ['跑鞋', '衣服', '买补给', '手表', '耳机', '眼镜', '其他'];
const RACE_SUBS = ['补给品', '吃喝', '纪念品', '报名费', '交通', '住宿', '旅行', '钞能力名额', '其他'];

function subsOf(bigCategory) {
  return bigCategory === 'race' ? RACE_SUBS : DAILY_SUBS;
}

function labelOf(bigCategory) {
  return bigCategory === 'race' ? '比赛开支' : '日常开支';
}

async function call(action, data = {}) {
  try {
    const res = await wx.cloud.callFunction({ name: 'ledger', data: { action, ...data } });
    return res.result || { ok: false, msg: '调用失败' };
  } catch (e) {
    console.error('ledger.call error', action, e);
    return { ok: false, msg: (e && e.errMsg) || '网络异常，请重试', errMsg: (e && e.errMsg) || String(e) };
  }
}

module.exports = { BIG_CATS, DAILY_SUBS, RACE_SUBS, subsOf, labelOf, call };