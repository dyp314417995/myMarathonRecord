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
    monthlyCount: 0,
    monthlyLimit: 0,
    submitting: false,
    userId: '',
    isAdmin: false,
  },

  async onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return wx.redirectTo({ url: '/pages/login/login' });
    const role = userInfo.role || 'user';
    const isAdmin = role === 'super_admin' || role === 'admin';
    this.setData({ userId: userInfo._id, isAdmin });
    const res = await pointsUtil.getRules();
    const userRules = res.data.filter(r => {
      if (r.status !== 'active') return false;
      if (r.category === '集体活动') return false;
      if (r.category === '赛事评分奖励') return false;
      return true;
    });
    this.setData({ rules: userRules });
  },

  onSelectCat(e) {
    const cat = e.currentTarget.dataset.cat;
    const rule = this.data.rules.find(r => r.category === cat);
    this.setData({ selectedCat: cat, quantity: 1, selectedPoints: rule ? rule.points : 3 });
    if (cat !== '拉新' && cat !== '自媒体') this.loadMonthlyCount(cat);
  },

  onQtyDown() {
    const { quantity } = this.data;
    if (quantity <= 1) return;
    this.setData({ quantity: quantity - 1 });
  },
  onQtyUp() {
    const { quantity, selectedCat } = this.data;
    const max = selectedCat === '拉新' ? 10 : 4;
    if (quantity >= max) return;
    this.setData({ quantity: quantity + 1 });
  },

  async loadMonthlyCount(cat) {
    const rule = this.data.rules.find(r => r.category === cat);
    const count = await pointsUtil.getMonthlyCount(this.data.userId, cat);
    this.setData({ monthlyCount: count, monthlyLimit: rule ? rule.monthlyLimit : 0 });
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
    const { selectedCat, description, images, submitting, monthlyCount, monthlyLimit, quantity } = this.data;
    if (submitting) return;
    if (!selectedCat) return wx.showToast({ title: '请选择类型', icon: 'none' });
    if (selectedCat !== '拉新' && selectedCat !== '自媒体' && monthlyLimit && monthlyCount >= monthlyLimit) return wx.showToast({ title: '本月已达上限', icon: 'none' });
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

      // 获取规则积分值，拉新/自媒体 × 数量
      const rule = this.data.rules.find(r => r.category === selectedCat);
      const perPoint = rule ? rule.points : 3;
      const isMulti = selectedCat === '拉新' || selectedCat === '自媒体';
      const points = isMulti ? perPoint * quantity : perPoint;

      await pointsUtil.addRecord({
        userId: this.data.userId,
        type: 'earn', category: selectedCat,
        points,
        qty: isMulti ? quantity : 1,
        description: isMulti ? `${selectedCat} ×${quantity}（${description || ''}）`.trim() : (description || selectedCat),
        images: fileIDs,
        monthlyIndex: monthlyCount + quantity,
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
