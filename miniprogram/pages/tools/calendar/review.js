// pages/tools/calendar/review.js - 赛事评分
const raceUtil = require('../../../utils/raceEvents');
const pointsUtil = require('../../../utils/points');

Page({
  data: {
    eventId: '',
    eventName: '',
    scores: { difficulty: 5, atmosphere: 5, supply: 5, transport: 5, scenery: 5, org: 5, medal: 5, value: 5 },
    elevation: '',
    equipment: '',
    selectedTags: [],
    submitting: false,
  },

  dims: [
    { key: 'difficulty', name: '赛道难度', desc: '1=轻松 10=极难' },
    { key: 'atmosphere', name: '赛道氛围', desc: '观众热情、加油氛围' },
    { key: 'supply', name: '补给', desc: '补给站数量与质量' },
    { key: 'transport', name: '交通', desc: '到达赛场的便利性' },
    { key: 'scenery', name: '赛道风景', desc: '沿途风景质量' },
    { key: 'org', name: '组织水平', desc: '赛事组织、引导、存包' },
    { key: 'medal', name: '完赛奖牌', desc: '奖牌设计与质量' },
    { key: 'value', name: '性价比', desc: '报名费与体验匹配度' },
  ],

  allTags: [
    'PB赛道', '新手友好', '坡多', '风景好',
    '值得一游', '美食多', '补给丰富', '住宿方便',
    '性价比高', '推荐参赛', '不推荐', '组织混乱',
  ],

  onLoad(options) {
    if (!options.id) return;
    this.setData({ eventId: options.id, eventName: options.name || '' });
  },

  onScoreTap(e) {
    const { dim, val } = e.currentTarget.dataset;
    const scores = { ...this.data.scores, [dim]: parseInt(val) };
    this.setData({ scores });
  },

  onElevInput(e) { this.setData({ elevation: e.detail.value }); },
  onEquipInput(e) { this.setData({ equipment: e.detail.value }); },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag;
    let tags = [...this.data.selectedTags];
    const idx = tags.indexOf(tag);
    if (idx >= 0) tags.splice(idx, 1); else tags.push(tag);
    this.setData({ selectedTags: tags });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return wx.showToast({ title: '请先登录', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中' });

    try {
      const db = require('../../../utils/db').db;

      // 创建评分记录（直接生效）
      const reviewRes = await db.collection('race_reviews').add({
        data: {
          eventId: this.data.eventId,
          userId: userInfo._id,
          scores: this.data.scores,
          elevation: this.data.elevation.trim(),
          equipment: this.data.equipment.trim(),
          tags: this.data.selectedTags,
          status: 'approved',
          createTime: new Date(),
        }
      });

      // 自动发放 10 积分
      await pointsUtil.addRecord({
        userId: userInfo._id,
        type: 'earn',
        category: '赛事评分奖励',
        points: 10,
        description: `赛事"${this.data.eventName}"体验评分奖励`,
        images: [],
        earnDate: new Date(),
        expireDate: new Date(Date.now() + 365 * 86400000),
        status: 'approved',
      });

      // 更新赛事评分统计
      const raceUtil = require('../../../utils/raceEvents');
      const stats = await raceUtil.getReviewStats(this.data.eventId);
      const tagStats = {};
      Object.keys(stats.tagStats).forEach(k => { tagStats[k] = stats.tagStats[k]; });
      await db.collection('race_events').doc(this.data.eventId).update({
        data: { avgScore: stats.avgScore, reviewCount: stats.count, tagStats }
      });

      wx.hideLoading();
      wx.showToast({ title: '提交成功，+10积分', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
