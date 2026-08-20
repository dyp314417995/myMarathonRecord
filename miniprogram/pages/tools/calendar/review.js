// pages/tools/calendar/review.js - 赛事评分
const raceUtil = require('../../../utils/raceEvents');
const pointsUtil = require('../../../utils/points');

Page({
  data: {
    eventId: '',
    eventName: '',
    scores: { difficulty: 5, atmosphere: 5, supply: 5, transport: 5 },
    selectedTags: [],
    hotTags: [],         // 已有标签及次数 [{name, count}]
    customTag: '',
    description: '',
    submitting: false,
    existingId: '',
    isEdit: false,
    eventTypes: ['full'],   // 赛事支持的项目类型
    reviewRaceType: 'full', // 本次评价的项目类型
    hasFull: true,          // 是否支持全马
    hasHalf: false,         // 是否支持半马
    hasBoth: false,         // 同时有全马和半马
    raceGroup: '',          // 赛事组
    reviewYear: new Date().getFullYear(),
    dims: [
      { key: 'difficulty', name: '赛道', desc: '赛道越好，评分越高' },
      { key: 'atmosphere', name: '氛围', desc: '观众热情、加油氛围' },
      { key: 'supply', name: '补给', desc: '补给站数量与质量' },
      { key: 'transport', name: '交通', desc: '到达赛场的便利性' },
    ],
  },

  async onLoad(options) {
    if (!options.id) return;
    wx.showLoading({ title: '加载中...' });

    // 并行加载赛事信息、已有评价、热门标签
    const [event, myReviewData, stats] = await Promise.all([
      raceUtil.getAll({ limit: 200 }).then(res => (res.list || []).find(r => r._id === options.id)).catch(() => null),
      this._loadMyReview(options.id),
      raceUtil.getReviewStats(options.id).catch(() => ({ tagStats: {} })),
    ]);

    const data = { eventId: options.id, eventName: options.name || '' };

    if (event) {
      const types = event.raceTypes || [event.raceType || 'full'];
      data.eventTypes = types;
      data.reviewRaceType = types[0] || 'full';
      data.raceGroup = event.raceGroup || '';
      data.hasFull = types.includes('full');
      data.hasHalf = types.includes('half');
      data.hasBoth = types.includes('full') && types.includes('half');
      data.reviewYear = new Date(event.date).getFullYear();
    }

    // 热门标签
    const tagStats = stats.tagStats || {};
    data.hotTags = Object.entries(tagStats)
      .sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([name, count]) => ({ name, count }));

    // 已有评价回显
    if (myReviewData) Object.assign(data, myReviewData);

    this.setData(data);
    wx.hideLoading();
  },

  onShow() {
    if (this.data.eventId) this.loadHotTags();
  },

  onTypeSel(e) { this.setData({ reviewRaceType: e.currentTarget.dataset.v }); },
  onYearSel(e) { this.setData({ yearIdx: e.detail.value }); },

  // 加载已有评价数据（返回数据对象，不调 setData，避免闪烁）
  async _loadMyReview(eventId) {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return null;
    try {
      const db = require('../../../utils/db').db;
      const exist = await db.collection('race_reviews').where({
        eventId, userId: userInfo._id
      }).get();
      if (exist.data.length > 0) {
        const r = exist.data[0];
        return {
          isEdit: true, existingId: r._id,
          scores: r.scores || { difficulty: 5, atmosphere: 5, supply: 5, transport: 5 },
          selectedTags: r.tags || [],
          description: r.description || '',
          reviewRaceType: r.raceType || 'full',
          reviewYear: r.year || new Date().getFullYear(),
        };
      }
    } catch (e) { console.error('loadMyReview error:', e); }
    return null;
  },

  async loadHotTags() {
    try {
      const stats = await raceUtil.getReviewStats(this.data.eventId);
      const tagStats = stats.tagStats || {};
      const tags = Object.entries(tagStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([name, count]) => ({ name, count }));
      this.setData({ hotTags: tags });
    } catch {}
  },

  onScoreTap(e) {
    const { dim, val } = e.currentTarget.dataset;
    this.setData({ [`scores.${dim}`]: parseInt(val) });
  },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag;
    let tags = [...this.data.selectedTags];
    const idx = tags.indexOf(tag);
    if (idx >= 0) tags.splice(idx, 1); else tags.push(tag);
    this.setData({ selectedTags: tags });
  },

  onCustomTagInput(e) { this.setData({ customTag: e.detail.value }); },

  onCustomTag() {
    const tag = this.data.customTag.trim();
    if (!tag) return;
    if (this.data.selectedTags.includes(tag)) {
      wx.showToast({ title: '标签已存在', icon: 'none' });
      return;
    }
    this.setData({
      selectedTags: [...this.data.selectedTags, tag],
      customTag: '',
    });
  },

  onDescInput(e) { this.setData({ description: e.detail.value }); },

  async onSubmit() {
    if (this.data.submitting) return;
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return wx.navigateTo({ url: '/pages/login/login' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中' });

    try {
      const db = require('../../../utils/db').db;
      const year = this.data.reviewYear || new Date().getFullYear();

      // 服务端防重复：再查一次是否已有评价
      if (!this.data.isEdit) {
        const check = await db.collection('race_reviews').where({
          eventId: this.data.eventId, userId: userInfo._id
        }).limit(1).get();
        if (check.data.length > 0) {
          this.setData({ isEdit: true, existingId: check.data[0]._id, submitting: false });
          wx.hideLoading();
          wx.showToast({ title: '已评价，改为编辑模式', icon: 'none' });
          return;
        }
      }

      const updateData = {
        scores: this.data.scores,
        tags: this.data.selectedTags,
        description: this.data.description.trim(),
        raceType: this.data.reviewRaceType,
        year,
      };

      if (this.data.isEdit) {
        await db.collection('race_reviews').doc(this.data.existingId).update({
          data: { ...updateData, updateTime: new Date() }
        });
      } else {
        await db.collection('race_reviews').add({
          data: { ...updateData, eventId: this.data.eventId, userId: userInfo._id, raceGroup: this.data.raceGroup, status: 'approved', createTime: new Date() }
        });

        const reviewPoints = await pointsUtil.getRulePoints('赛事评分奖励', 10);
        await pointsUtil.addRecord({
          userId: userInfo._id,
          type: 'earn',
          category: '赛事评分奖励',
          points: reviewPoints,
          description: `赛事"${this.data.eventName}"体验评分奖励`,
          images: [],
          earnDate: new Date(),
          expireDate: new Date(Date.now() + 365 * 86400000),
          status: 'approved',
        });
      }

      // 更新统计
      const stats = await raceUtil.getReviewStats(this.data.eventId);
      const tagStats = {};
      Object.keys(stats.tagStats).forEach(k => { tagStats[k] = stats.tagStats[k]; });
      await db.collection('race_events').doc(this.data.eventId).update({
        data: { avgScore: stats.avgScore, reviewCount: stats.count, tagStats }
      });

      wx.hideLoading();
      wx.showToast({ title: this.data.isEdit ? '已更新' : '提交成功，+' + reviewPoints + '积分', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '提交失败: ' + err.message, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onDelete() {
    const reviewPoints = await pointsUtil.getRulePoints('赛事评分奖励', 10);
    wx.showModal({
      title: '删除评价',
      content: '将扣除' + reviewPoints + '积分，重新评价可再获得积分',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        const db = require('../../../utils/db').db;
        const userInfo = wx.getStorageSync('userInfo');

        await db.collection('race_reviews').doc(this.data.existingId).remove();

        if (userInfo) {
          await pointsUtil.addRecord({
            userId: userInfo._id, type: 'use', category: '消耗', points: -reviewPoints,
            description: `删除"${this.data.eventName}"评价，扣减${reviewPoints}积分`,
            images: [], earnDate: new Date(), expireDate: null, status: 'approved',
          });
          const balance = await pointsUtil.getBalance(userInfo._id);
          await db.collection('users').doc(userInfo._id).update({ data: { points: balance } });
        }

        const stats = await raceUtil.getReviewStats(this.data.eventId);
        const tagStats = {};
        Object.keys(stats.tagStats).forEach(k => { tagStats[k] = stats.tagStats[k]; });
        await db.collection('race_events').doc(this.data.eventId).update({
          data: { avgScore: stats.avgScore, reviewCount: stats.count, tagStats }
        });

        wx.showToast({ title: '已删除，-' + reviewPoints + '积分', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 1500);
      }
    });
  },
});
