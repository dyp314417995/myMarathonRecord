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
  },

  async onShow() {
    await this.load();
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

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    const M = String(dt.getMonth() + 1).padStart(2, '0');
    const D = String(dt.getDate()).padStart(2, '0');
    const h = String(dt.getHours()).padStart(2, '0');
    const m = String(dt.getMinutes()).padStart(2, '0');
    return `${dt.getFullYear()}-${M}-${D} ${h}:${m}`;
  },

  onUse(e) {
    if (this.data.using) return;
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '使用补签卡',
      content: '将补签最早的漏签日（+1基础积分），确定使用？',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ using: true });
        const r = await signinUtil.useCard(id);
        this.setData({ using: false });
        if (!r || !r.ok) {
          wx.showToast({ title: (r && r.msg) || '使用失败', icon: 'none' });
        } else {
          wx.showToast({ title: `补签成功 +${r.base} 积分`, icon: 'success' });
        }
        await this.load();
      },
    });
  },
});