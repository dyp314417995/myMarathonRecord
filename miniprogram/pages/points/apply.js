// pages/points/apply.js - 提交积分申请
const pointsUtil = require('../../utils/points');

Page({
  data: {
    rules: [],
    selectedCat: '',
    description: '',
    images: [],
    monthlyCount: 0,
    monthlyLimit: 0,
    submitting: false,
    userId: '',
  },

  async onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return wx.redirectTo({ url: '/pages/login/login' });
    this.setData({ userId: userInfo._id });
    const res = await pointsUtil.getRules();
    // 用户可申请的类别（排除集体活动）
    const userRules = res.data.filter(r => r.category !== '集体活动');
    this.setData({ rules: userRules });
  },

  onSelectCat(e) {
    const cat = e.currentTarget.dataset.cat;
    this.setData({ selectedCat: cat });
    this.loadMonthlyCount(cat);
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
      count: 4, mediaType: ['image'], sourceType: ['album', 'camera'],
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
    const { selectedCat, description, images, submitting, monthlyCount, monthlyLimit } = this.data;
    if (submitting) return;
    if (!selectedCat) return wx.showToast({ title: '请选择类型', icon: 'none' });
    if (monthlyLimit && monthlyCount >= monthlyLimit) return wx.showToast({ title: '本月已达上限', icon: 'none' });
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

      // 获取规则积分值
      const rule = this.data.rules.find(r => r.category === selectedCat);
      const points = rule ? rule.points : 3;

      await pointsUtil.addRecord({
        userId: this.data.userId,
        type: 'earn', category: selectedCat,
        points: points,
        description: description || selectedCat,
        images: fileIDs,
        monthlyIndex: monthlyCount + 1,
        earnDate: new Date(),
        expireDate: new Date(Date.now() + 365 * 86400000),
        status: 'pending',
      });

      wx.hideLoading();
      wx.showToast({ title: '提交成功，等待审批', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
