// pages/signin/index.js - 每日签到页
const signinUtil = require('../../utils/signin');
const shareUtil = require('../../utils/share');

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

Page({
  data: {
    loading: true,
    signed: false,
    continuousDays: 0,
    maxDays: 0,
    lastSignDate: '',
    today: '',
    basePoints: 1,
    ruleDescription: '',
    preview: { base: 1, bonus: 0, total: 1 },
    reward: { gap: 7, bonus: 5 },
    canMakeup: false,
    usableCards: 0,
    expiringCards: 0,
    holdLimit: 10,
    balance: 0,
    exchange: { used: 0, limit: 3, cost: 30 },
    calendarDays: [],
    calTitle: '',
    weeks: WEEK,
    showExchange: false,
    exchangeBusy: false,
    signing: false,
    ruleDisabled: false,
  },

  onLoad(options) {
    shareUtil.enableShareMenu();
    this.autoExchange = !!(options && options.exchange === '1');
    this.hasPromptedMakeup = false;
  },

  onShareAppMessage() {
    return {
      title: `九州战马每日签到 · 已连续签到 ${this.data.continuousDays} 天`,
      path: '/pages/signin/index',
    };
  },

  async onShow() {
    await this.loadInfo();
  },

  async loadInfo() {
    this.setData({ loading: true });
    const res = await signinUtil.getInfo();
    if (!res || !res.ok) {
      this.setData({ loading: false });
      wx.showToast({ title: (res && res.msg) || '加载失败', icon: 'none' });
      return;
    }
    const [y, m] = res.today.split('-').map(Number);
    this.setData({
      loading: false,
      signed: !!res.signed,
      continuousDays: res.continuous_days,
      maxDays: res.max_continuous_days,
      lastSignDate: res.last_sign_date,
      today: res.today,
      basePoints: res.base_points,
      ruleDescription: res.rule_description || '',
      preview: res.preview,
      reward: res.reward,
      canMakeup: !!res.can_makeup,
      usableCards: res.usable_cards,
      expiringCards: res.expiring_cards,
      holdLimit: res.hold_limit,
      balance: res.balance,
      exchange: res.exchange,
      ruleDisabled: !!res.rule_disabled,
      calTitle: `${y} 年 ${m} 月`,
      calendarDays: this.buildCalendar(res.today, res.signed_dates || [], res.makeup_dates || []),
    });

    // 断签提醒：昨天断签且持有补签卡
    if (res.can_makeup && !this.hasPromptedMakeup && !res.signed) {
      this.hasPromptedMakeup = true;
      this.showMakeupPrompt();
    }
    if (this.autoExchange) {
      this.autoExchange = false;
      this.onOpenExchange();
    }
  },

  buildCalendar(todayStr, signedDates, makeupDates) {
    const [y, m] = todayStr.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const leading = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一开头
    const cells = [];
    for (let i = 0; i < leading; i++) cells.push({ empty: true, date: "empty-" + i });
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({
        day: d,
        date: ds,
        signed: signedDates.indexOf(ds) >= 0,
        makeup: makeupDates.indexOf(ds) >= 0,
        isToday: ds === todayStr,
        future: ds > todayStr,
      });
    }
    return cells;
  },

  // ========== 签到 ==========
  async onSign() {
    if (this.data.signing || this.data.signed) return;
    if (this.data.canMakeup) {
      this.showMakeupPrompt();
      return;
    }
    await this.doSignNow(false);
  },

  showMakeupPrompt() {
    wx.showModal({
      title: '昨天忘签了？',
      content: `使用 1 张补签卡可保住连续签到记录（补签仅得基础积分，不触发额外奖励）`,
      confirmText: '使用补签卡',
      cancelText: '跳过（重新开始）',
      success: async (res) => {
        if (res.confirm) await this.doSignNow(true);
        else await this.doSignNow(false);
      },
    });
  },

  async doSignNow(useCard) {
    this.setData({ signing: true });
    const res = await signinUtil.doSign(useCard);
    this.setData({ signing: false });
    if (!res || !res.ok) {
      wx.showModal({
        title: '提示',
        content: (res && res.msg) || '签到失败，请稍后重试',
        showCancel: false,
      });
      await this.loadInfo();
      return;
    }
    let msg = res.total > 0 ? `今日获得 +${res.total} 积分` : '签到积分规则已停用，本次未获得积分';
    if (res.bonus > 0) msg += `\n（含连续奖励 +${res.bonus}）`;
    if (res.is_makeup && res.base > 0) msg += `\n已用补签卡补签昨天 +${res.base} 积分`;
    msg += `\n已连续签到 ${res.continuous} 天`;
    if (res.card_granted) msg += `\n🎁 连续签到满 ${res.continuous} 天，补签卡 +1 张`;
    wx.showModal({ title: '签到成功 🎉', content: msg, showCancel: false });
    await this.loadInfo();
  },

  // ========== 补签卡 ==========
  onGoCards() {
    wx.navigateTo({ url: '/pages/signin/cards' });
  },

  // ========== 兑换 ==========
  onOpenExchange() {
    const { exchange, usableCards, holdLimit, balance } = this.data;
    if (usableCards >= holdLimit) {
      wx.showToast({ title: `补签卡已达上限 ${holdLimit} 张`, icon: 'none' });
      return;
    }
    if (exchange.used >= exchange.limit) {
      wx.showToast({ title: `本月兑换已达上限 ${exchange.limit} 张`, icon: 'none' });
      return;
    }
    if (balance < exchange.cost) {
      wx.showToast({ title: `积分不足，兑换需 ${exchange.cost} 分`, icon: 'none' });
      return;
    }
    this.setData({ showExchange: true });
  },

  onCloseExchange() {
    this.setData({ showExchange: false });
  },

  async onConfirmExchange() {
    if (this.data.exchangeBusy) return;
    this.setData({ exchangeBusy: true });
    const res = await signinUtil.exchangeCard();
    this.setData({ exchangeBusy: false, showExchange: false });
    if (!res || !res.ok) {
      wx.showToast({ title: (res && res.msg) || '兑换失败', icon: 'none' });
    } else {
      wx.showToast({ title: '兑换成功 +1 张', icon: 'success' });
    }
    await this.loadInfo();
  },

  noop() {},
});