// pages/points/apply.js - 提交积分申请
const pointsUtil = require('../../utils/points');

Page({
  data: {
    rules: [],
    selectedCat: '',
    selectedPoints: 0,
    description: '',
    images: [],
    quantity: 1,
    maxQty: 1,
    usedCount: 0,
    limitCount: 0,
    periodText: '',
    submitting: false,
    userId: '',
    isAdmin: false,
  },

  async onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return wx.navigateTo({ url: '/pages/login/login' });
    const role = userInfo.role || 'user';
    const isAdmin = role === 'super_admin' || role === 'admin';
    this.setData({ userId: userInfo._id, isAdmin });
    const res = await pointsUtil.getRules();
    const userRules = res.data.filter(r => {
      if (r.status !== 'active') return false;
      // 无需用户提交（自动发放/管理员录入）的规则不出现在申请页
      if (!pointsUtil.isNeedSubmit(r)) return false;
      return true;
    }).map(r => ({ ...r, limitText: pointsUtil.getRuleLimitText(r) }));
    this.setData({ rules: userRules });
  },

  onSelectCat(e) {
    const name = e.currentTarget.dataset.cat;
    const rule = this.data.rules.find(r => r.name === name);
    const maxQty = rule && rule.maxQty > 1 ? rule.maxQty : 1;
    this.setData({ selectedCat: name, quantity: 1, maxQty, selectedPoints: rule ? rule.points : 3 });
    this.loadRuleLimit(name);
  },

  onQtyDown() {
    const { quantity } = this.data;
    if (quantity <= 1) return;
    this.setData({ quantity: quantity - 1 });
  },
  onQtyUp() {
    const { quantity, maxQty } = this.data;
    if (quantity >= maxQty) return;
    this.setData({ quantity: quantity + 1 });
  },

  async loadRuleLimit(cat) {
    const rule = this.data.rules.find(r => r.name === cat);
    const { period, limitCount } = pointsUtil.parseRuleLimit(rule);
    if (!period || !limitCount) {
      this.setData({ usedCount: 0, limitCount: 0, periodText: '' });
      return;
    }
    const used = await pointsUtil.getPeriodCount(this.data.userId, cat, period);
    const pText = { day: '今天', week: '本周', month: '本月' }[period] || '';
    this.setData({ usedCount: used, limitCount, periodText: pText });
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value });
  },

  onChooseImage() {
    wx.chooseMedia({
      count: 9, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: (res) => {
        const newImgs = res.tempFiles.map(f => f.tempFilePath);
        this.setData({ images: [...this.data.images, ...newImgs] });
      },
    });
  },

  onRemoveImage(e) {
    const idx = e.currentTarget.dataset.idx;
    const images = [...this.data.images];
    images.splice(idx, 1);
    this.setData({ images });
  },

  async onSubmit() {
    const { selectedCat, description, images, submitting, usedCount, limitCount, quantity } = this.data;
    if (submitting) return;
    if (!selectedCat) return wx.showToast({ title: '请选择类型', icon: 'none' });
    if (limitCount && usedCount + quantity > limitCount) {
      return wx.showToast({ title: (this.data.periodText || '') + '已达上限（本次提交 ' + quantity + ' 次将超限）', icon: 'none' });
    }
    if (images.length === 0) return wx.showToast({ title: '请上传图片', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...' });

    try {
      // 上传图片
      const fileIDs = [];
      for (const img of images) {
        const res = await wx.cloud.uploadFile({
          cloudPath: `points/${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
          filePath: img,
        });
        fileIDs.push(res.fileID);
      }

      // 获取规则积分值，单次可提交数量>1 时按数量累计
      const rule = this.data.rules.find(r => r.name === selectedCat);
      const perPoint = rule ? rule.points : 3;
      const maxQty = rule && rule.maxQty > 1 ? rule.maxQty : 1;
      const isMulti = maxQty > 1;
      const points = isMulti ? perPoint * quantity : perPoint;

      await pointsUtil.addRecord({
        userId: this.data.userId,
        type: 'earn', category: selectedCat,
        points,
        qty: isMulti ? quantity : 1,
        description: isMulti ? `${selectedCat} ×${quantity}（${description || ''}）`.trim() : (description || selectedCat),
        images: fileIDs,
        monthlyIndex: usedCount + quantity,
        earnDate: new Date(),
        expireDate: new Date(Date.now() + 365 * 86400000),
        status: this.data.isAdmin ? 'approved' : 'pending',
      });

      wx.hideLoading();
      wx.showToast({ title: this.data.isAdmin ? '录入成功' : '提交成功，等待审批', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
