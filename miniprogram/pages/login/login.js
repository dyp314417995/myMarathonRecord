// pages/login/login.js - 登录即注册
const dbUtil = require('../../utils/db');
const pointsUtil = require('../../utils/points');
const app = getApp();

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    phoneNumber: '',
    city: '',
    showCityPicker: false,
    showTimePicker: false,
    timeField: '',
    timeLabel: '',
    timeDefault: '0:00:00',
    timeValue: '',
    pb10k: '',
    pbHalf: '',
    pbFull: '',
    groups: [],
    selectedGroupIds: [],
    selectedGroupMap: {},
    submitting: false,
  },

  async onLoad() {
    // 退出过的用户：检测是否有账号，让用户一键登录
    if (wx.getStorageSync('_logged_out')) {
      wx.removeStorageSync('_logged_out');
      const user = await dbUtil.getCurrentUser();
      if (user) {
        if (!this.ensureApproved(user)) { this.loadGroups(); return; }
        await this.grantRegisterGifts(user);
        const res = await new Promise(resolve => {
          wx.showModal({
            title: '已有账号',
            content: `欢迎回来，${user.nickName || '跑友'}！是否直接登录？`,
            confirmText: '直接登录',
            cancelText: '重新注册',
            success: (r) => resolve(r.confirm),
          });
        });
        if (res) {
          wx.setStorageSync('userInfo', user);
          app.globalData.isGuest = false;
          app.globalData.userInfo = user;
          const pending = getApp().globalData.pendingActivityId;
          if (pending) {
            getApp().globalData.pendingActivityId = '';
            wx.reLaunch({ url: `/pages/tools/activity/detail?id=${pending}` });
          } else if (getCurrentPages().length > 1) {
            // 强制重建上一页，确保完全刷新
            const prev = getCurrentPages()[getCurrentPages().length - 2];
            const id = (prev && (prev.options.scene || prev.options.id)) || (prev && prev.data && prev.data.activityId);
            if (prev && id) {
              wx.reLaunch({ url: `/${prev.route}?id=${encodeURIComponent(id)}` });
            } else {
              wx.reLaunch({ url: '/pages/home/home' });
            }
          } else {
            wx.reLaunch({ url: '/pages/home/home' });
          }
          return;
        }
      }
      this.loadGroups();
      return;
    }

    // 有扫码待跳转的活动时，直接跳转
    const pending = getApp().globalData.pendingActivityId;
    if (pending) {
      getApp().globalData.pendingActivityId = '';
      const cached = wx.getStorageSync('userInfo');
      if (cached && cached._id) {
        wx.reLaunch({ url: `/pages/tools/activity/detail?id=${pending}` });
        return;
      }
      const user = await dbUtil.getCurrentUser();
      if (user) {
        if (!this.ensureApproved(user)) { this.loadGroups(); return; }
        await this.grantRegisterGifts(user);
        wx.setStorageSync('userInfo', user);
        wx.reLaunch({ url: `/pages/tools/activity/detail?id=${pending}` });
        return;
      }
      this.loadGroups();
      return;
    }

    // 已注册用户：仅审核通过的能直接进入；待审核/被驳回的留在本页，可补充群组后重新提交
    const fresh = await dbUtil.getCurrentUser();
    if (fresh && (fresh.status === 'pending' || fresh.status === 'rejected')) {
      wx.showModal({
        title: fresh.status === 'pending' ? '注册审核中' : '注册未通过',
        content: fresh.status === 'pending'
          ? '你注册时未选择加入任何群，需管理员审核通过后才能使用。也可在下方选择群组后重新提交，选择群组即可立即通过。'
          : '你的注册申请未通过审核，如有疑问请联系管理员。也可在下方选择群组后重新提交，选择群组即可立即通过。',
        showCancel: false,
      });
      this.loadGroups();
      return;
    }
    if (fresh) await this.grantRegisterGifts(fresh);
    const cached = wx.getStorageSync('userInfo');
    if (cached && cached._id) {
      if (getCurrentPages().length > 1) wx.navigateBack();
      else wx.reLaunch({ url: '/pages/home/home' });
      return;
    }
    if (fresh) {
      wx.setStorageSync('userInfo', fresh);
      if (getCurrentPages().length > 1) wx.navigateBack();
      else wx.reLaunch({ url: '/pages/home/home' });
      return;
    }
    this.loadGroups();
  },

  // 获取群组列表
  async loadGroups() {
    const res = await dbUtil.getGroups();
    const enriched = await Promise.all(res.data.map(async (g) => {
      if (g.qrCode) {
        try {
          const urlRes = await wx.cloud.getTempFileURL({ fileList: [g.qrCode] });
          return { ...g, qrCodeUrl: urlRes.fileList[0].tempFileURL };
        } catch { return g; }
      }
      return g;
    }));
    this.setData({ groups: enriched });
  },

  // 预览群二维码
  onPreviewQR(e) {
    const { url } = e.currentTarget.dataset;
    if (url) wx.previewImage({ urls: [url], current: url });
  },

  // 微信授权获取头像和昵称
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({ avatarUrl });
  },

  onNicknameInput(e) {
    this.setData({ nickName: e.detail.value });
  },

  // 通用字段输入
  onInput(e) {
    const { field } = e.currentTarget.dataset;
    if (field) this.setData({ [field]: e.detail.value });
  },

  // 获取手机号（微信官方能力）
  async onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getPhoneNumber',
        data: { cloudID: e.detail.cloudID }
      });
      if (res.result && res.result.phoneNumber) {
        this.setData({ phoneNumber: res.result.phoneNumber });
        wx.showToast({ title: '已获取手机号', icon: 'success' });
      }
    } catch (err) {
      console.error('获取手机号失败:', err);
      wx.showToast({ title: '获取手机号失败，请手动输入', icon: 'none' });
    }
  },

  // 手动输入手机号
  onPhoneInput(e) {
    this.setData({ phoneNumber: e.detail.value });
  },

  // 多选群组
  onToggleGroup(e) {
    const { id } = e.currentTarget.dataset;
    const ids = [...this.data.selectedGroupIds];
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1); else ids.push(id);
    const map = {};
    ids.forEach(id => { map[id] = true; });
    this.setData({ selectedGroupIds: ids, selectedGroupMap: map });
  },

  // 审核状态闸口：pending/rejected 一律不放行（老用户无 status 视为已通过）
  ensureApproved(user) {
    if (!user) return true;
    if (user.status !== 'pending' && user.status !== 'rejected') return true;
    wx.showModal({
      title: user.status === 'pending' ? '注册审核中' : '注册未通过',
      content: user.status === 'pending'
        ? '你注册时未选择加入任何群，需管理员审核通过后才能使用。也可在下方选择群组后重新提交，选择群组即可立即通过。'
        : '你的注册申请未通过审核，如有疑问请联系管理员。也可在下方选择群组后重新提交，选择群组即可立即通过。',
      showCancel: false,
    });
    return false;
  },

  // 注册赠送（积分 + 2 张补签卡）：signin_cards_granted 防重复发放；
  // 未选群的待审核用户注册时不发，审核通过后首次登录/管理员审核通过时补发
  async grantRegisterGifts(user) {
    try {
      if (!user || !user._id || user.signin_cards_granted) return;
      const regPoints = await pointsUtil.getRulePoints('注册赠送');
      if (regPoints > 0) {
        await pointsUtil.addRecord({
          userId: user._id, type: 'earn', category: '注册赠送',
          points: regPoints, description: '新用户注册赠送',
          images: [], earnDate: new Date(),
          expireDate: new Date(Date.now() + 365 * 86400000),
          status: 'approved',
        });
      }
      const now = new Date();
      const expire = new Date(now.getTime() + 30 * 86400000);
      for (let i = 0; i < 2; i++) {
        await dbUtil.db.collection('makeup_card').add({
          data: { userId: user._id, source: 1, expire_at: expire, status: 0, used_at: null, created_at: now },
        }).catch(() => {});
      }
      await dbUtil.updateUser(user._id, { signin_cards_granted: true }).catch(() => {});
    } catch (e) { console.error('注册赠送发放失败:', e); }
  },

  // 提交注册
  async onSubmit() {
    const { avatarUrl, nickName, city, phoneNumber, selectedGroupIds, submitting, pb10k, pbHalf, pbFull } = this.data;
    if (submitting) return;

    // 校验
    if (!nickName.trim()) return wx.showToast({ title: '请输入昵称', icon: 'none' });
    if (!phoneNumber.trim()) return wx.showToast({ title: '请输入手机号', icon: 'none' });
    if (!/^1\d{10}$/.test(phoneNumber.trim())) return wx.showToast({ title: '手机号格式不正确', icon: 'none' });

    // 未选择群组：需管理员审核
    const needReview = selectedGroupIds.length === 0;

    this.setData({ submitting: true });
    wx.showLoading({ title: '注册中...' });

    try {
      // 上传头像到云存储（只要不是 cloud:// 都上传，避免临时路径过期）
      let finalAvatar = avatarUrl;
      if (avatarUrl && !avatarUrl.startsWith('cloud://')) {
        try {
          const upRes = await wx.cloud.uploadFile({
            cloudPath: `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
            filePath: avatarUrl,
          });
          finalAvatar = upRes.fileID;
        } catch (err) {
          console.error('头像上传失败:', err);
          finalAvatar = ''; // 上传失败就清空，用默认头像
        }
      }

      // 获取 openid 用于消息推送
      const openRes = await wx.cloud.callFunction({ name: 'getOpenid' }).catch(() => ({ result: {} }));
      const openid = openRes.result.openid || '';

      // 检查是否已注册
      let user = await dbUtil.getCurrentUser();
      if (user) {
        const patch = {
          openid,
          avatarUrl: finalAvatar, nickName, phoneNumber: phoneNumber.trim(),
          city: city.trim(), pb10k, pbHalf, pbFull,
          groupIds: selectedGroupIds
        };
        // 待审核/被驳回的用户重新提交：选了群 → 直接通过；仍没选群 → 维持待审核。
        // 已通过的老用户不改状态，避免误降级。
        if (user.status === 'pending' || user.status === 'rejected') {
          patch.status = needReview ? 'pending' : 'approved';
        }
        await dbUtil.updateUser(user._id, patch);
        if (patch.status === 'approved') {
          user.status = 'approved';
          await this.grantRegisterGifts(user);
        }
        // 更新群成员数
        for (const gid of selectedGroupIds) {
          dbUtil.db.collection('groups').doc(gid).update({ data: { memberCount: dbUtil._.inc(1) } }).catch(() => {});
        }
      } else {
        // 新用户注册（已注册用户会被 getCurrentUser() 在 onLoad/onSubmit 前置拦截）
        const userData = {
          openid,
          avatarUrl: finalAvatar, nickName, phoneNumber: phoneNumber.trim(),
          city: city.trim(), pb10k, pbHalf, pbFull,
          // 初始余额为 0：注册赠送积分只通过下方 addRecord -> incUserPoints 发放一次，避免重复加积分
          groupIds: selectedGroupIds, points: 0,
          status: needReview ? 'pending' : 'approved',
        };
        const addRes = await dbUtil.createUser(userData);
        const fullUser = await dbUtil.db.collection('users').doc(addRes._id).get();
        user = fullUser.data;
        for (const gid of selectedGroupIds) {
          dbUtil.db.collection('groups').doc(gid).update({ data: { memberCount: dbUtil._.inc(1) } }).catch(() => {});
        }
        // 注册赠送：待审核（未选群）时不发，审核通过首次登录时补发
        if (!needReview) await this.grantRegisterGifts(user);
      }

      // 待审核（未选群）：不缓存登录态、不进入应用，留在登录页等审核或补充群组
      if (needReview) {
        wx.hideLoading();
        wx.showModal({
          title: '已提交申请',
          content: '你未选择加入任何群，需管理员审核通过后才能使用。审核期间无法浏览活动内容；如想立即通过，可在下方选择群组后重新提交。',
          showCancel: false,
        });
        return;
      }

      // 保存到全局和本地
      app.globalData.userInfo = user;
      wx.setStorageSync('userInfo', user);

      wx.hideLoading();
      wx.showToast({ title: '注册成功', icon: 'success' });
      setTimeout(() => {
        const pending = app.globalData.pendingActivityId;
        if (pending) {
          app.globalData.pendingActivityId = '';
          wx.reLaunch({ url: `/pages/tools/activity/detail?id=${pending}` });
        } else if (getCurrentPages().length > 1) {
          wx.navigateBack();
        } else {
          wx.reLaunch({ url: '/pages/home/home' });
        }
      }, 1500);

    } catch (err) {
      console.error('注册失败:', err);
      wx.hideLoading();
      wx.showToast({ title: '注册失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // 城市选择
  onShowCityPicker() { this.setData({ showCityPicker: true }); },
  onCityConfirm(e) {
    this.setData({ city: e.detail.value, showCityPicker: false });
  },
  onCityCancel() { this.setData({ showCityPicker: false }); },

  // 时间选择
  onShowTimePicker(e) {
    const { field, label, def } = e.currentTarget.dataset;
    const val = this.data[field] || def;
    this.setData({ showTimePicker: true, timeField: field, timeLabel: label, timeDefault: def, timeValue: val });
  },
  onTimeConfirm(e) {
    this.setData({ [this.data.timeField]: e.detail.value, showTimePicker: false });
  },
  onTimeCancel() { this.setData({ showTimePicker: false }); },

  // 跳过，稍后填写
  onSkip() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/home/home' });
    }
  },
});
