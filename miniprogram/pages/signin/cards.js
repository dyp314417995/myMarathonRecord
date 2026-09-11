// pages/signin/cards.js - 补签卡列表
const signinUtil = require('../../utils/signin');

const SOURCE = { 1: '注册赠送', 2: '连续签到奖励', 3: '积分兑换', 4: '运营活动' };
const STATUS = { 0: '可使用', 1: '已使用', 2: '已过期' };

Page({
  data: {
    list: [],
    loading: true,
    usable: 0,
    using: false,
    makeupDays: [],   // 可补签的漏签日列表
    showPickDate: false, // 日期选择弹窗
    activeCardId: '',  // 当前要使用的补签卡
  },

  async onShow() {
    await this.load();
    await this.loadMakeupDays();
  },

  async load() {
    this.setData({ loading: true });
    const res = await signinUtil.getCards();
    const list = ((res && res.list) || []).map(c => ({
      ...c,
      source_text: SOURCE[c.source] || '未知来源',
      status_text: STATUS[c.status] || '',
      fmt_create: this.fmtDate(c.created_at),
      fmt_expire: this.fmtDate(c.expire_at),
      is_usable: c.status === 0,
    }));
    this.setData({ list, loading: false, usable: (res && res.usable) || 0 });
  },

  // 加载可补签的漏签日
  async loadMakeupDays(force) {
    try {
      const res = await signinUtil.getInfo(!!force);
      if (res && res.ok) {
        const days = (res.makeup_days || []).map(d => ({
          date: d,
          label: this.fmtDayLabel(d),
        }));
        this.setData({ makeupDays: days });
      }
    } catch (e) { /* 忽略 */ }
  },

  fmtDayLabel(dateStr) {
    // 转成 M月D日 星期几
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const week = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];
    return `${m}月${d}日 周${week}`;
  },

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    const M = String(dt.getMonth() + 1).padStart(2, '0');
    const D = String(dt.getDate()).padStart(2, '0');
    const h = String(dt.getHours()).padStart(2, '0');
    const m = String(dt.getMinutes()).padStart(2, '0');
    return `${dt.getFullYear()}-${M}-${D} ${h}:${m}`;
  },

  // 点「使用」→ 弹出日期选择
  onUse(e) {
    if (this.data.using) return;
    const id = e.currentTarget.dataset.id;
    if (this.data.makeupDays.length === 0) {
      wx.showToast({ title: '没有可补签的漏签日', icon: 'none' });
      return;
    }
    this.setData({ showPickDate: true, activeCardId: id });
  },

  // 选择某个日期补签
  onPickDate(e) {
    const date = e.currentTarget.dataset.date;
    if (this.data.using) return;
    this.setData({ showPickDate: false, using: true });
    const cardId = this.data.activeCardId;
    wx.showModal({
      title: '确认补签',
      content: `补签 ${this.fmtDayLabel(date)}（+1基础积分）？`,
      success: async (res) => {
        if (!res.confirm) {
          this.setData({ using: false });
          return;
        }
        const r = await signinUtil.useCard(cardId, date);
        this.setData({ using: false });
        if (!r || !r.ok) {
          wx.showToast({ title: (r && r.msg) || '使用失败', icon: 'none' });
        } else {
          // 清缓存，避免补签后拿到旧的漏签日列表
          signinUtil.clearCache();
          const msg = r.continuous > 0
            ? `补签成功 +${r.base} 积分\n已连续签到 ${r.continuous} 天`
            : `补签成功 +${r.base} 积分`;
          wx.showModal({ title: '补签成功', content: msg, showCancel: false });
        }
        await this.load();
        await this.loadMakeupDays(true);
      },
    });
  },

  onHidePickDate() { this.setData({ showPickDate: false }); },
  noop() {},
});
