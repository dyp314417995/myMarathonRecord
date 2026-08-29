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
    nextRegular: { gap: 7, points: 1 },
    nextGoal: { gap: 88, points: 25 },
    canMakeup: false,
    makeupDays: [],
    usableCards: 0,
    expiringCards: 0,
    holdLimit: 10,
    balance: 0,
    exchange: { used: 0, limit: 5, cost: 10, in_window: false, day_from: 1, day_to: 10 },
    calendarDays: [],
    calTitle: '',
    weeks: WEEK,
    showExchange: false,
    exchangeBusy: false,
    signing: false,
    ruleDisabled: false,
    cycleDays: 88,
    cycleProgress: 0,
    cycleCount: 0,
    firstSignPoints: 5,
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
    // 签到页是主入口，每次进来强制刷新（其他页面走缓存）
    await this.loadInfo(true);
  },

  async loadInfo(forceRefresh) {
    this.setData({ loading: true });
    const res = await signinUtil.getInfo(forceRefresh);
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
      basePoints: 1,
      preview: res.preview,
      nextRegular: res.next_regular,
      nextGoal: res.next_goal,
      canMakeup: !!res.can_makeup,
      makeupDays: res.makeup_days || [],
      usableCards: res.usable_cards,
      expiringCards: res.expiring_cards,
      holdLimit: res.hold_limit,
      balance: res.balance,
      exchange: res.exchange,
      ruleDisabled: !!res.rule_disabled,
      cycleDays: res.cycle_days || 88,
      cycleProgress: res.cycle_progress || 0,
      cycleCount: res.cycle_count || 0,
      firstSignPoints: res.first_sign_points || 5,
      calTitle: `${y} 年 ${m} 月`,
      calendarDays: this.buildCalendar(res.today, res.signed_dates || [], res.makeup_dates || []),
    });

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
    const leading = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < leading; i++) cells.push({ empty: true, date: "empty-" + i });
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({
        day: d, date: ds,
        signed: signedDates.indexOf(ds) >= 0,
        makeup: makeupDates.indexOf(ds) >= 0,
        isToday: ds === todayStr,
        future: ds > todayStr,
      });
    }
    return cells;
  },

  async onSign() {
    if (this.data.signing || this.data.signed) return;
    await this.doSignNow();
  },

  showMakeupPrompt() {
    wx.showModal({
      title: '有漏签可补',
      content: `使用补签卡可补过去30天内的漏签日（连补最多3天，从最早开始）`,
      confirmText: '去补签',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) this.onGoCards();
      },
    });
  },

  async doSignNow() {
    this.setData({ signing: true });
    const res = await signinUtil.doSign(false);
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
    let msg = res.total > 0 ? `今日获得 +${res.total} 积分` : '本次未获得积分';
    if (res.first_reward > 0) msg += `\n🎉 首签奖励 +${res.first_reward}`;
    if (res.regular_reward > 0) msg += `\n🎁 常规奖励 +${res.regular_reward}`;
    if (res.goal_reward > 0) msg += `\n🏆 目标奖励 +${res.goal_reward}`;
    msg += `\n已连续签到 ${res.continuous} 天`;
    signinUtil.clearCache();
    wx.showModal({ title: '签到成功 🎉', content: msg, showCancel: false });
    await this.loadInfo(true);
  },

  onGoCards() {
    wx.navigateTo({ url: '/pages/signin/cards' });
  },

  onGoRule() {
    wx.navigateTo({ url: '/pages/signin/rule' });
  },

  onOpenExchange() {
    const { exchange, usableCards, holdLimit, balance } = this.data;
    if (!exchange.in_window) {
      return;
    }
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
    signinUtil.clearCache();
    if (!res || !res.ok) {
      wx.showToast({ title: (res && res.msg) || '兑换失败', icon: 'none' });
    } else {
      wx.showToast({ title: '兑换成功 +1 张', icon: 'success' });
    }
    await this.loadInfo(true);
  },

  noop() {},
});
