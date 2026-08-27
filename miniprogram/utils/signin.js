// utils/signin.js - 签到 / 补签卡 云函数封装
const FUNC = 'signin';

async function call(action, data = {}) {
  const res = await wx.cloud.callFunction({ name: FUNC, data: { action, ...data } });
  return res.result || {};
}

function getInfo() { return call('info'); }
function doSign(useCard) { return call('sign', { useCard: !!useCard }); }
function getCards() { return call('cards'); }
function exchangeCard() { return call('exchange'); }
function useCard(cardId) { return call('useCard', { cardId }); }

module.exports = { call, getInfo, doSign, getCards, exchangeCard, useCard };