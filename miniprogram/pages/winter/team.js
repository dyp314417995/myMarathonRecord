// pages/winter/team.js - 我的组（名单 + KPI 区间 + 队长管理）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, group: null, members: [], kpiRange: null, me: {},
    weekIndex: 0, weekText: '', frozen: false, frozenText: '',
    leader: null, coach: null, mates: [],
    isLeader: false, isBoss: false,
    pendingApplies: [],
    sloganImage: '',            // 队伍照片（fileID 转成的 https 临时链接）
    shareImageUrl: '',          // 转发卡片配图
    showGroupEdit: false,       // 队长/教练编辑宣言与照片
    groupEdit: { slogan: '', sloganImage: '', sloganImagePreview: '' },
    busy: false,
  },

  async onShow() {
    await this.load();
  },

  // 分享：邀请好友加入本组，带上宣言与队伍照片
  onShareAppMessage() {
    const g = this.data.group || {};
    const title = g.slogan
      ? `${g.emblem || ''}${g.name}｜${g.slogan} · 一起冬训 100 天`
      : `邀请你加入 ${g.emblem || ''}${g.name}，一起冬训 100 天`;
    return {
      title,
      path: `/pages/winter/index?gid=${g._id || ''}`,
      imageUrl: this.data.shareImageUrl || undefined,
    };
  },

  onShareTimeline() {
    const g = this.data.group || {};
    return {
      title: g.slogan ? `${g.name}｜${g.slogan}` : `${g.name}｜一起冬训`,
      query: `gid=${g._id || ''}`,
      imageUrl: this.data.shareImageUrl || undefined,
    };
  },

  async onPreviewSlogan() {
    const url = this.data.sloganImage;
    if (url) wx.previewImage({ urls: [url] });
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    const r = await w.api.myGroup();
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    // 头像 cloud:// 需转成 https 临时链接，否则 image 组件加载失败
    const members = await w.resolveAvatars(r.members || []);
    const leader = members.find(m => m.role === 'leader') || null;
    const coach = members.find(m => m.role === 'coach') || null;
    const me = r.me || {};
    const isLeader = me.role === 'leader' && me.status === 'approved';
    const isBoss = (me.role === 'leader' || me.role === 'coach') && me.status === 'approved';

    // 队长：拉取本组待审批入队申请
    let pendingApplies = [];
    if (isLeader) {
      const ap = await w.api.leaderApplies();
      if (ap.ok) pendingApplies = ap.list || [];
    }

    // 队伍照片同样是 cloud://，转成 https 才能渲染；顺带给转发卡片当配图
    const sloganImage = (r.group && r.group.sloganImage)
      ? await w.toTempUrl(r.group.sloganImage) : '';

    this.setData({
      loading: false,
      group: r.group,
      sloganImage,
      shareImageUrl: sloganImage,
      members,
      kpiRange: r.kpiRange,
      me,
      isLeader,
      isBoss,
      pendingApplies,
      weekIndex: r.weekIndex,
      // 未开营（第 0 周）显示「试运行」，不显示 0 或负数周
      weekText: r.weekIndex > 0 ? ('第 ' + r.weekIndex + ' 周') : '试运行',
      frozen: r.frozen,
      frozenText: w.FROZEN_TEXT[r.frozenReason] || (r.frozen ? '本周不考核，打卡照常开放' : ''),
      leader, coach,
      mates: members.filter(m => m.role === 'member'),
      kpiRangeText: r.kpiRange
        ? `${r.kpiRange.type === 'distance' ? '跑量' : '出勤'} ${r.kpiRange.min} ~ ${r.kpiRange.max}${r.kpiRange.type === 'distance' ? ' 公里/周' : ' 天/周'}${r.kpiRange.minDuration ? (' · 单次≥' + r.kpiRange.minDuration + '分钟') : ''}`
        : '教练尚未设定 KPI 区间',
      // 文案放在 JS 里拼，避免 WXML 里嵌套三元 + 全角括号被解析器吞字符
      // 只显示数值，不再带「（已锁定）」标记
      kpiBtnText: (() => {
        if (!me.kpiValue || me.kpiValue <= 0) return '填报我的 KPI';
        const unit = me.kpiType === 'attendance' ? ' 天' : ' 公里';
        return `我的 KPI：${me.kpiValue}${unit}`;
      })(),
    });
  },

  onGoKpi() { wx.navigateTo({ url: '/pages/winter/kpi' }); },
  onGoCheckin() { wx.navigateTo({ url: '/pages/winter/checkin' }); },
  onGoRecords() { wx.navigateTo({ url: '/pages/winter/records' }); },

  // 主动退组：退出后可重新报名加入其他组
  onQuitGroup() {
    const me = this.data.me || {};
    if (me.role === 'leader') {
      return wx.showModal({
        title: '队长不可直接退组',
        content: '请先在成员列表把队长职务转让给其他队员，再联系管理组处理。',
        showCancel: false,
      });
    }
    wx.showModal({
      title: '退出本组',
      content: '退出后需要重新报名才能加入其他组。本组打卡记录会保留，本周 KPI 会清空，加入新组后按新区间重新填报。',
      confirmText: '确认退出',
      confirmColor: '#e74c3c',
      success: async (m) => {
        if (!m.confirm) return;
        wx.showLoading({ title: '处理中' });
        const r = await w.api.quitGroup();
        wx.hideLoading();
        if (!r.ok) return wx.showToast({ title: r.error || '退组失败', icon: 'none' });
        wx.showToast({ title: '已退出本组', icon: 'success' });
        setTimeout(() => wx.reLaunch({ url: '/pages/winter/index' }), 900);
      },
    });
  },

  // 队长：切换某成员缴费状态
  async onToggleFee(e) {
    if (this.data.busy) return;
    const uid = e.currentTarget.dataset.uid;
    const fee = e.currentTarget.dataset.fee;
    // 三态循环：未缴费 → 已缴费 → 免费 → 未缴费
    const next = fee === 'paid' ? 'free' : (fee === 'free' ? 'unpaid' : 'paid');
    this.setData({ busy: true });
    const r = await w.api.setFeeStatus({ userId: uid, feeStatus: next });
    this.setData({ busy: false });
    if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
    const txt = next === 'paid' ? '已缴费' : (next === 'free' ? '免费（无需缴费）' : '未缴费');
    wx.showToast({ title: '已标记：' + txt, icon: 'none' });
    this.load();
  },

  // ===== 队长/教练：编辑本组宣言与照片 =====
  // 管理后台只有超管能进，队长平时进不去，所以放在这里维护
  onEditGroupInfo() {
    const g = this.data.group || {};
    this.setData({
      showGroupEdit: true,
      groupEdit: {
        slogan: g.slogan || '',
        sloganImage: g.sloganImage || '',
        sloganImagePreview: this.data.sloganImage || '',
      },
    });
  },
  onCloseGroupEdit() { this.setData({ showGroupEdit: false }); },
  onGroupEditInput(e) {
    this.setData({ ['groupEdit.' + e.currentTarget.dataset.f]: e.detail.value });
  },
  async onChooseGroupPhoto() {
    let res;
    try {
      res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] });
    } catch (e) { return; }
    const file = res.tempFiles && res.tempFiles[0];
    if (!file) return;
    wx.showLoading({ title: '上传中' });
    try {
      const up = await wx.cloud.uploadFile({
        cloudPath: `winter_group/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
        filePath: file.tempFilePath,
      });
      const preview = await w.toTempUrl(up.fileID);
      this.setData({ 'groupEdit.sloganImage': up.fileID, 'groupEdit.sloganImagePreview': preview });
    } catch (e) {
      wx.showToast({ title: '上传失败，请重试', icon: 'none' });
    }
    wx.hideLoading();
  },
  onRemoveGroupPhoto() {
    this.setData({ 'groupEdit.sloganImage': '', 'groupEdit.sloganImagePreview': '' });
  },
  onPreviewGroupPhoto() {
    const url = this.data.groupEdit.sloganImagePreview;
    if (url) wx.previewImage({ urls: [url] });
  },
  async onSaveGroupInfo() {
    if (this.data.busy) return;
    const f = this.data.groupEdit;
    this.setData({ busy: true });
    const r = await w.api.leaderSaveGroup({ slogan: f.slogan, sloganImage: f.sloganImage });
    this.setData({ busy: false });
    if (!r.ok) return wx.showToast({ title: r.error || '保存失败', icon: 'none' });
    wx.showToast({ title: '队伍信息已更新', icon: 'success' });
    this.setData({ showGroupEdit: false });
    this.load();
  },

  // 队长：通过 / 驳回入队申请
  async onLeaderReview(e) {
    if (this.data.busy) return;
    const uid = e.currentTarget.dataset.uid;
    const pass = e.currentTarget.dataset.pass === true || e.currentTarget.dataset.pass === 'true';
    if (!pass) {
      wx.showModal({
        title: '驳回申请',
        editable: true,
        placeholderText: '填写驳回原因（选填）',
        success: async (res) => {
          if (!res.confirm) return;
          const r = await w.api.leaderReviewApply({ userId: uid, pass: false, note: res.content || '' });
          if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
          wx.showToast({ title: '已驳回', icon: 'none' });
          this.load();
        },
      });
      return;
    }
    this.setData({ busy: true });
    const r = await w.api.leaderReviewApply({ userId: uid, pass: true });
    this.setData({ busy: false });
    if (!r.ok) {
      // 常见原因：名额已满、本组已有教练
      return wx.showModal({ title: '无法通过', content: r.error || '操作失败', showCancel: false });
    }
    wx.showToast({ title: '已通过', icon: 'success' });
    this.load();
  },

  // 队长/教练：把角色转让给某队员（无需审批）
  onTransferRole(e) {
    const uid = e.currentTarget.dataset.uid;
    const nick = e.currentTarget.dataset.nick || '该队员';
    const roleName = this.data.me.roleText || '';
    wx.showModal({
      title: '转让' + roleName,
      content: `确认把「${roleName}」转让给 ${nick}？转让后你将成为普通队员，操作不可撤销。`,
      confirmText: '确认转让',
      confirmColor: '#e6a23c',
      success: async (res) => {
        if (!res.confirm) return;
        const r = await w.api.transferRole({ userId: uid });
        if (!r.ok) return wx.showToast({ title: r.error || '转让失败', icon: 'none' });
        wx.showToast({ title: '已转让', icon: 'success' });
        this.load();
      },
    });
  },

  // 头像加载失败：置空，改用文字头像兜底
  onAvatarError(e) {
    const k = e.currentTarget.dataset.k;
    if (k === 'mates') {
      const i = Number(e.currentTarget.dataset.i);
      if (this.data.mates[i]) this.setData({ [`mates[${i}].avatarUrl`]: '' });
    } else if (k === 'leader' && this.data.leader) {
      this.setData({ 'leader.avatarUrl': '' });
    } else if (k === 'coach' && this.data.coach) {
      this.setData({ 'coach.avatarUrl': '' });
    }
  },
});
