// pages/admin/races/races.js - 赛事管理
const raceUtil = require('../../../utils/raceEvents');

Page({
  data: {
    tab: 'races',       // races | logs
    logTab: 'import',   // import | update
    logList: [],
    logPage: 0,
    logHasMore: false,
    isAdmin: false,
    raceList: [],
    allRaceList: [],        // 未筛选的完整列表
    adminSearch: '', adminType: '', adminLevel: '', adminLabel: '', adminRegStatus: '',
    showQR: false, qrFileID: '', sharingRaceName: '', sharingRaceInfo: {},
    showQRText: true, // 合成海报后隐藏重复文字
    nameDupStatus: '', // '' | 'checking' | 'ok' | 'dup'
    showPoster: false, posterIdx: 0, posterPreviewUrl: '',
    typeFull: true, typeHalf: false, type10k: false,
    showForm: false,
    gunTimes: [{ zone: 'A', time: '07:00', zoneIdx: 0 }],
    zoneOptions: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
    editingId: '',
    form: { name: '', raceGroup: '', date: '', province: '', city: '', raceTypes: ['full'], raceLevel: 'A', label: '', scale: '', subScale: '', fee: '', organizer: '', operator: '', contactPhone: '', contactEmail: '', wechatAccount: '', website: '', mechanism: '抽签', payment: '报名时缴费', signupChannels: '', medicalReport: '', finishRequirement: '', refundRule: '', startPoint: '', medalImage: '', routeMap: '', regStatus: '', posters: [], timeline: [] },
    posterTemp: [],
    showPaste: false,    // 粘贴全文面板
    pasteText: '',       // 粘贴的全文
    parsing: false,      // 解析中
    // 评价管理
    showReviews: false,
    reviewEventId: '',
    reviewEventName: '',
    reviewList: [],
    timelineNodes: [
      { label: '报名开启', date: '', time: '12:00' },
      { label: '报名截止', date: '', time: '12:00' },
      { label: '退费截止', date: '', time: '12:00' },
      { label: '出签时间', date: '', time: '12:00' },
      { label: '缴费截止', date: '', time: '12:00' },
      { label: '候补时间', date: '', time: '12:00' },
      { label: '二抽出签', date: '', time: '12:00' },
      { label: '鸣枪开跑', date: '', time: '07:00' },
    ],
  },

  labels: ['白金标', '金标', '精英标', '普通标'],
  mechanisms: ['抽签', '先到先得'],
  payments: ['报名时缴费', '中签后缴费'],

  onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    const role = userInfo.role || 'user';
    this.setData({ isAdmin: role === 'super_admin' || role === 'admin', tab: 'races', adminPage: 0, adminHasMore: true, allRaceList: [], raceList: [] });
    if (this.data.isAdmin) { this.loadRaces(); this.loadLogs(); }
  },

  onAdminTab(e) {
    const t = e.currentTarget.dataset.t;
    if (this.data.tab === t) return;
    this.setData({ tab: t });
    if (t === 'logs') this.loadLogs();
  },

  onLogTab(e) {
    const lt = e.currentTarget.dataset.lt;
    if (this.data.logTab === lt) return;
    this.setData({ logTab: lt, logPage: 0, logList: [] });
    this.loadLogs();
  },

  async loadLogs() {
    const skip = this.data.logPage * 20;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getRaceEvents',
        data: { action: 'logs', type: this.data.logTab, skip, limit: 20 }
      });
      const r = res.result || {};
      const list = (r.list || []).map(x => ({
        ...x,
        _type: x._type || this.data.logTab,
        fmtTime: this.fmtLogTime(x.createTime),
        itemNames: (x.items || []).slice(0, 20).map(i => i.name).join('、')
      }));
      const merged = this.data.logPage === 0 ? list : [...this.data.logList, ...list];
      this.setData({ logList: merged, logHasMore: r.hasMore || false });
    } catch (e) {
      console.error('loadLogs error:', e);
      this.setData({ logList: [], logHasMore: false });
    }
  },

  onLoadMoreLogs() {
    if (!this.data.logHasMore) return;
    this.setData({ logPage: this.data.logPage + 1 }, () => this.loadLogs());
  },

  fmtLogTime(d) {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return dt.getFullYear() + '-' + p(dt.getMonth()+1) + '-' + p(dt.getDate()) + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  },

  async loadRaces() {
    const userInfo = wx.getStorageSync('userInfo');
    const userId = userInfo ? (userInfo._id || userInfo.openid) : null;
    const skip = this.data.adminPage * 20;
    const search = this.data.adminSearch || '';
    const res = await raceUtil.getAll({ skip, limit: 20, userId, search: search || undefined, publishFilter: 'all' });
    const all = res.list;
    all.forEach(r => {
      if (r.raceType && !r.raceTypes) r.raceTypes = [r.raceType];
      if (!r.raceTypes || !r.raceTypes.length) r.raceTypes = ['full'];
    });
    const list = all.map(r => ({
      ...r, fmtDate: this.fmtDate(r.date),
      raceTypesStr: r.raceTypes.map(t => ({ full: '全马', half: '半马', '10k': '10K' }[t] || t)).join('/'),
      countdown: this.calcCountdown(r.date, r.status, r.timeline, r.gunTimes),
      publishStatus: r.publishStatus || 'published',
    }));
        const merged = skip === 0 ? list : [...this.data.allRaceList, ...list];
    this.setData({ allRaceList: merged, adminHasMore: res.hasMore });
    this.applyAdminFilter();
  },

  onLoadMoreRaces() {
    if (!this.data.adminHasMore) return;
    this.setData({ adminPage: this.data.adminPage + 1 }, () => this.loadRaces());
  },

  applyAdminFilter() {
    let list = [...this.data.allRaceList];
    // 方案B：全部已发布，无草稿过滤
    if (this.data.adminSearch) list = list.filter(r => (r.name||'').includes(this.data.adminSearch));
    if (this.data.adminType) list = list.filter(r => (r.raceTypes || [r.raceType]).includes(this.data.adminType));
    if (this.data.adminLevel) list = list.filter(r => r.raceLevel === this.data.adminLevel);
    if (this.data.adminLabel) list = list.filter(r => r.label === this.data.adminLabel);
    if (this.data.adminRegStatus) list = list.filter(r => r.regStatus === this.data.adminRegStatus);
    this.setData({ raceList: list });
  },

  onAdminSearch(e) {
    this.setData({ adminSearch: e.detail.value, adminPage: 0 }, () => {
      this.loadRaces();
    });
  },

  onAdminFilter(e) {
    const { field, v } = e.currentTarget.dataset;
    const key = field === 'type' ? 'adminType' : field === 'level' ? 'adminLevel' : field === 'regStatus' ? 'adminRegStatus' : 'adminLabel';
    this.setData({ [key]: this.data[key] === v ? '' : v });
    this.applyAdminFilter();
  },

  // 点击卡片跳用户详情
  onRaceDetailAdmin(e) {
    const id = e.currentTarget.dataset.id;
    const r = this.data.raceList.find(x => x._id === id);
    wx.navigateTo({ url: `/pages/tools/calendar/detail?id=${id}` });
  },

  calcCountdown(d, status, timeline, gunTimes) {
    const now = new Date();
    const toDate = (v) => v instanceof Date ? v : new Date(v);

    // 找最早发枪时间
    let firstGun = null;
    if (gunTimes && gunTimes.length) {
      gunTimes.forEach(g => {
        if (!g.time) return;
        const rd = d ? toDate(d) : new Date();
        const [h, m] = g.time.split(':');
        rd.setHours(+h || 0, +m || 0, 0, 0);
        if (!firstGun || rd < firstGun) firstGun = rd;
      });
    }

    // 优先找最近的下一个时间节点（含发枪时间）
    let nearestLabel = '', nearestMs = Infinity;
    if (timeline && timeline.length) {
      timeline.forEach(t => {
        if (!t.date) return;
        const td = toDate(t.date);
        if (isNaN(td.getTime())) return;
        if (t.label === '鸣枪开跑' && firstGun) {
          const diffMs = firstGun - now;
          if (diffMs >= 0 && diffMs < nearestMs) { nearestMs = diffMs; nearestLabel = '鸣枪开跑'; }
          return;
        }
        if (t.time) { const [h, m] = t.time.split(':'); td.setHours(+h || 0, +m || 0, 0, 0); }
        else td.setHours(0, 0, 0, 0);
        const diffMs = td - now;
        if (diffMs >= 0 && diffMs < nearestMs) { nearestMs = diffMs; nearestLabel = t.label; }
      });
    }
    if (!nearestLabel && firstGun) {
      const diffMs = firstGun - now;
      if (diffMs >= 0) { nearestMs = diffMs; nearestLabel = '鸣枪开跑'; }
    }

    if (nearestLabel) {
      const label = nearestLabel.replace('时间', '');
      const diffHours = Math.round(nearestMs / 3600000);
      if (diffHours < 1) return `即将${label}`;
      if (diffHours < 24) return `距${label} ${diffHours} 小时`;
      return `距${label} ${Math.ceil(nearestMs / 86400000)} 天`;
    }

    if (!d) return '';
    const rd = toDate(d);
    if (isNaN(rd.getTime())) return '';
    const diffMs = rd - now;
    if (diffMs > 0) return `距鸣枪开跑 ${Math.ceil(diffMs / 86400000)} 天`;
    if (Math.abs(diffMs) < 86400000) return '今天鸣枪开跑';
    return `已举办 ${Math.ceil(Math.abs(diffMs) / 86400000)} 天`;
  },

  fmtDate(d) {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  },

  onAdd() {
    this.setData({
      showForm: true, editingId: '', posterTemp: [], showPaste: false, pasteText: '', parsing: false, nameDupStatus: '',
      typeFull: true, typeHalf: false, type10k: false,
      form: { name: '', raceGroup: '', date: '', province: '', city: '', raceTypes: ['full'], raceLevel: 'A', label: '', scale: '', subScale: '', fee: '', organizer: '', operator: '', contactPhone: '', contactEmail: '', wechatAccount: '', website: '', mechanism: '抽签', payment: '报名时缴费', signupChannels: '', medicalReport: '', finishRequirement: '', refundRule: '', startPoint: '', medalImage: '', routeMap: '', regStatus: '', posters: [], timeline: [] },
      gunTimes: [{ zone: 'A', time: '07:00', zoneIdx: 0 }],
    zoneOptions: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
      timelineNodes: [
        { label: '报名开启', date: '', time: '12:00' }, { label: '报名截止', date: '', time: '12:00' }, { label: '退费截止', date: '', time: '12:00' },
        { label: '出签时间', date: '', time: '12:00' }, { label: '缴费截止', date: '', time: '12:00' }, { label: '候补时间', date: '', time: '12:00' },
        { label: '二抽出签', date: '', time: '12:00' }, { label: '鸣枪开跑', date: '', time: '07:00' },
      ]
    });
  },

  onEdit(e) {
    const r = this.data.raceList.find(x => x._id === e.currentTarget.dataset.id);
    if (!r) return;
    const existingTimeline = (r.timeline || []).map(t => {
      const labelMap = { '开启报名': '报名开启', '截止报名': '报名截止', '截止退费': '退费截止', '缴费截止时间': '缴费截止', '举办日期': '鸣枪开跑' };
      return { ...t, label: labelMap[t.label] || t.label };
    });
    const tNodes = [
      { label: '报名开启', date: '', time: '12:00' }, { label: '报名截止', date: '', time: '12:00' }, { label: '退费截止', date: '', time: '12:00' },
      { label: '出签时间', date: '', time: '12:00' }, { label: '缴费截止', date: '', time: '12:00' }, { label: '候补时间', date: '', time: '12:00' },
      { label: '二抽出签', date: '', time: '12:00' }, { label: '鸣枪开跑', date: '', time: '07:00' },
    ];
    tNodes.forEach(node => {
      const found = existingTimeline.find(t => t.label === node.label);
      if (found) {
        node.date = found.date;
        node.time = found.time ?? (node.label === '鸣枪开跑' ? '07:00' : '12:00');
      } else {
        // 不在 timeline 中说明被清掉了，保持空
        node.date = '';
        node.time = '';
      }
    });
    // 如果 timeline 中没有鸣枪开跑，用赛事日期填充
    const gunNode = tNodes[tNodes.length - 1];
    if (!gunNode.date && r.date) {
      gunNode.date = this.fmtDate(r.date);
    }

    const raceTypes = r.raceTypes || [r.raceType || 'full'];
    const initPosters = ((r.posters || []).filter(Boolean).length ? r.posters.filter(Boolean) : (r.poster ? [r.poster] : [])).filter(p => p && typeof p === 'string');
    (async () => {
      if (initPosters.length > 0) {
        const cld = initPosters.filter(p => p.startsWith('cloud://'));
        if (cld.length > 0) {
          try {
            const ur = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: cld } });
            const m = {}; (ur.result || []).forEach(f => { if (f.tempFileURL) m[f.fileID] = f.tempFileURL; });
            this.setData({ posterTemp: initPosters.map(p => p.startsWith('cloud://') ? (m[p] || p) : p) });
          } catch { this.setData({ posterTemp: initPosters }); }
        } else { this.setData({ posterTemp: initPosters }); }
      }
    })();
    this.setData({
      showForm: true, editingId: r._id, nameDupStatus: '',
      typeFull: raceTypes.includes('full'), typeHalf: raceTypes.includes('half'), type10k: raceTypes.includes('10k'),
      form: { name: r.name||'', raceGroup: r.raceGroup || '', date: this.fmtDate(r.date), province: r.province||'', city: r.city||'', raceTypes, raceLevel: r.raceLevel||'', label: r.label||'', scale: r.scale||'', subScale: r.subScale||'', fee: r.fee||'', organizer: r.organizer||'', operator: r.operator||'', contactPhone: r.contactPhone||'', contactEmail: r.contactEmail||'', wechatAccount: r.wechatAccount||'', website: r.website||'', mechanism: r.mechanism||'', payment: r.payment||'', signupChannels: r.signupChannels||'', medicalReport: r.medicalReport||'', finishRequirement: r.finishRequirement||'', refundRule: r.refundRule||'', startPoint: r.startPoint||'', medalImage: r.medalImage||'', routeMap: r.routeMap||'', regStatus: r.regStatus||'', posters: initPosters, timeline: existingTimeline },
      gunTimes: (r.gunTimes && r.gunTimes.length) ? r.gunTimes.map((g, i) => ({ ...g, zoneIdx: i })) : [{ zone: 'A', time: '07:00', zoneIdx: 0 }],
      timelineNodes: tNodes,
    });
  },

  onDel(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除赛事', content: '确定删除？', confirmColor: '#ff4d4f', success: async (res) => {
      if (!res.confirm) return;
      await raceUtil.remove(id);
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadRaces();
    }});
  },

  async onDup(e) {
    const id = e.currentTarget.dataset.id;
    const r = this.data.raceList.find(x => x._id === id);
    if (!r) return wx.showToast({ title: '赛事不存在', icon: 'none' });

    // 构建复制数据，名称后加"2"
    const dupData = {
      name: r.name + '2',
      raceGroup: r.raceGroup || '',
      date: r.date,
      city: r.city || '',
      province: r.province || '',
      raceTypes: r.raceTypes || [r.raceType || 'full'],
      raceLevel: r.raceLevel || '',
      label: r.label || '',
      scale: r.scale || '',
      subScale: r.subScale || '',
      fee: r.fee || '',
      organizer: r.organizer || '',
      operator: r.operator || '',
      contactPhone: r.contactPhone || '',
      contactEmail: r.contactEmail || '',
      wechatAccount: r.wechatAccount || '',
      website: r.website || '',
      mechanism: r.mechanism || '',
      payment: r.payment || '',
            signupChannels: r.signupChannels || '',
      medicalReport: r.medicalReport || '',
      finishRequirement: r.finishRequirement || '',
      refundRule: r.refundRule || '',
      startPoint: r.startPoint || '',
      medalImage: r.medalImage || '',
      routeMap: r.routeMap || '',
      regStatus: r.regStatus || '',
      posters: r.posters || (r.poster ? [r.poster] : []),
      timeline: (r.timeline || []).map(t => ({ label: t.label, date: t.date, time: t.time || '' })),
      status: r.status || 'upcoming',
      source: 'manual',
      publishStatus: 'published',
      tagStats: {}, reviewCount: 0, avgScore: 0,
    };

    wx.showLoading({ title: '复制中' });
    try {
      await raceUtil.create(dupData);
      wx.hideLoading();
      wx.showToast({ title: '已复制', icon: 'success' });
      this.loadRaces();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '复制失败', icon: 'none' });
    }
  },

  async onManageReviews(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '';
    this.setData({ showReviews: true, reviewEventId: id, reviewEventName: name, reviewList: [] });
    const res = await wx.cloud.callFunction({ name: 'getRaceReviews', data: { action: 'all', eventId: id } });
    const enriched = [];
    for (const r of (res.result || [])) {
      try {
        const db = require('../../../utils/db').db;
        const u = await db.collection('users').doc(r.userId).get();
        enriched.push({
          ...r,
          userName: u.data ? (u.data.nickName || '未知') : '已删除',
          fmtTime: this.fmtReviewDate(r.createTime),
          fmtScores: Object.keys(r.scores||{}).map(k => {
            const lb = { difficulty:'难度',atmosphere:'氛围',supply:'补给',transport:'交通',scenery:'风景',org:'组织',medal:'奖牌',value:'性价比' };
            return `${lb[k]}${r.scores[k]}`;
          }).join(' '),
        });
      } catch {}
    }
    this.setData({ reviewList: enriched });
  },

  fmtReviewDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getMonth()+1}-${dt.getDate()} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2,'0')}`;
  },

  onHideReviews() { this.setData({ showReviews: false }); },

  async onDelReview(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除评价', content: '确定删除？', confirmColor: '#ff4d4f', success: async (res) => {
      if (!res.confirm) return;
      const db = require('../../../utils/db').db;
      await db.collection('race_reviews').doc(id).remove();
      // 更新统计
      const stats = await raceUtil.getReviewStats(this.data.reviewEventId);
      const tagStats = {};
      Object.keys(stats.tagStats).forEach(k => { tagStats[k] = stats.tagStats[k]; });
      await db.collection('race_events').doc(this.data.reviewEventId).update({
        data: { avgScore: stats.avgScore, reviewCount: stats.count, tagStats }
      });
      wx.showToast({ title: '已删除', icon: 'success' });
      this.onManageReviews({ currentTarget: { dataset: { id: this.data.reviewEventId, name: this.data.reviewEventName } } });
    }});
  },

  onInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [`form.${k}`]: e.detail.value });
    if (k === 'name') this.setData({ nameDupStatus: '' });
  },

  async onNameBlur(e) {
    const name = (e.detail.value || '').trim();
    if (!name) { this.setData({ nameDupStatus: '' }); return; }
    // 编辑时名字没改则不校验
    if (this.data.editingId) {
      const orig = this.data.raceList.find(x => x._id === this.data.editingId);
      if (orig && orig.name === name) { this.setData({ nameDupStatus: '' }); return; }
    }
    this.setData({ nameDupStatus: 'checking' });
    try {
      const dupRes = await raceUtil.getAll({ search: name, limit: 200 });
      const dup = (dupRes.list || []).find(r => r.name === name && r._id !== this.data.editingId);
      this.setData({ nameDupStatus: dup ? 'dup' : 'ok' });
    } catch {
      this.setData({ nameDupStatus: '' });
    }
  },

  onChoosePoster() {
    const remain = 9 - this.data.posterTemp.length;
    if (remain <= 0) return wx.showToast({ title: '最多上传9张图片', icon: 'none' });
    wx.chooseImage({ count: remain, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: async (res) => {
      wx.showLoading({ title: '上传中' });
      const newIDs = [];
      for (const fp of res.tempFilePaths) {
        try {
          const up = await wx.cloud.uploadFile({ cloudPath: `races/poster-${Date.now()}-${Math.random().toString(36).slice(2,8)}.png`, filePath: fp });
          if (up.fileID) newIDs.push(up.fileID);
        } catch {}
      }
      if (!newIDs.length) return wx.hideLoading();
      const urlR = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: newIDs } });
      const map = {};
      (urlR.result || []).forEach(f => { if (f.tempFileURL) map[f.fileID] = f.tempFileURL; });
      const newUrls = newIDs.map(id => map[id] || id);
      this.setData({
        posterTemp: [...this.data.posterTemp, ...newUrls],
        'form.posters': [...this.data.form.posters, ...newIDs]
      });
      wx.hideLoading();
    }});
  },
  onPreviewPoster(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ showPoster: true, posterIdx: idx });
  },
  onHidePoster() { this.setData({ showPoster: false }); },
  onPosterSwiperChange(e) {
    this.setData({ posterIdx: e.detail.current });
  },
  onDelPosterSmall(e) {
    const idx = e.currentTarget.dataset.idx;
    const imgs = [...this.data.posterTemp];
    const fids = [...this.data.form.posters];
    imgs.splice(idx, 1);
    fids.splice(idx, 1);
    this.setData({ posterTemp: imgs, 'form.posters': fids });
  },
  onMovePosterLeft(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    if (idx <= 0) return;
    const imgs = [...this.data.posterTemp];
    const fids = [...this.data.form.posters];
    [imgs[idx - 1], imgs[idx]] = [imgs[idx], imgs[idx - 1]];
    [fids[idx - 1], fids[idx]] = [fids[idx], fids[idx - 1]];
    this.setData({ posterTemp: imgs, 'form.posters': fids });
  },
  onMovePosterRight(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    if (idx >= this.data.posterTemp.length - 1) return;
    const imgs = [...this.data.posterTemp];
    const fids = [...this.data.form.posters];
    [imgs[idx], imgs[idx + 1]] = [imgs[idx + 1], imgs[idx]];
    [fids[idx], fids[idx + 1]] = [fids[idx + 1], fids[idx]];
    this.setData({ posterTemp: imgs, 'form.posters': fids });
  },

  onTogglePaste() { this.setData({ showPaste: !this.data.showPaste, pasteText: '', parsing: false }); },
  onPasteInput(e) { this.setData({ pasteText: e.detail.value }); },

  onPasteParse() {
    const text = this.data.pasteText.trim();
    if (!text) return wx.showToast({ title: '请先粘贴全文', icon: 'none' });
    this.setData({ parsing: true });

    const now = new Date();
    const year = now.getFullYear();
    const nextYear = year + 1;

    // 从文本提取日期 "2026年10月18日" | "10月18日" | "2026-10-18"
    const extractDate = (str) => {
      let m = str.match(/(\d{4})[年\-\/](\d{1,2})[月\-\/](\d{1,2})日?/);
      if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
      m = str.match(/(\d{1,2})[月\-\/](\d{1,2})日?/);
      if (m) return `${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
      return null;
    };

    // 从文本提取时间 "7:30" | "07：30"
    const extractTime = (str) => {
      const m = str.match(/(\d{1,2})[:：](\d{2})/);
      if (m) return `${m[0].padStart(2,'0')}:${m[2]}`;
      return null;
    };

    // 关键词 → 标签名映射
    const keywordMap = [
      { key: '报名开启', kw: ['报名开启', '开启报名', '开始报名', '报名时间', '报名启动'] },
      { key: '报名截止', kw: ['报名截止', '截止报名', '报名结束'] },
      { key: '退费截止', kw: ['退费截止', '截止退费'] },
      { key: '出签时间', kw: ['出签', '中签公布', '抽签结果', '公布中签'] },
      { key: '缴费截止', kw: ['缴费截止', '截止缴费'] },
      { key: '候补时间', kw: ['候补'] },
      { key: '二抽出签', kw: ['二抽', '二轮抽签'] },
      { key: '鸣枪开跑', kw: ['鸣枪开跑', '比赛时间', '竞赛时间', '开赛时间', '开跑'] },
    ];

    const nodes = this.data.timelineNodes;
    let name = '';

    keywordMap.forEach(({ key, kw }) => {
      const node = nodes.find(n => n.label === key);
      if (!node || node.date) return; // 已有值就跳过
      for (const k of kw) {
        const idx = text.indexOf(k);
        if (idx === -1) continue;
        const context = text.substring(Math.max(0, idx - 20), Math.min(text.length, idx + 100));
        const date = extractDate(context);
        if (date) {
          node.date = date;
          node.time = extractTime(context) || (key === '鸣枪开跑' ? '07:00' : '12:00');
          break;
        }
      }
    });

    // 顺便提取赛事名
    const nameMatch = text.match(/(.{2,20})(?:马拉松|半程马拉松)/);
    if (nameMatch) name = nameMatch[0].trim();

    const filled = nodes.filter(n => n.date).length;

    const setObj = { timelineNodes: nodes, parsing: false, showPaste: false };
    if (name) setObj['form.name'] = name;
    this.setData(setObj);

    wx.showToast({ title: `已提取 ${filled} 个时间节点`, icon: 'success', duration: 1500 });
  },
  onFormType(e) {
    const v = e.currentTarget.dataset.v;
    const types = [...(this.data.form.raceTypes || ['full'])];
    if (v === 'full' || v === 'half') {
      // 全马半马多选：先清掉 10K，然后切换
      const filtered = types.filter(t => t === 'full' || t === 'half');
      const idx = filtered.indexOf(v);
      if (idx >= 0) filtered.splice(idx, 1);
      else filtered.push(v);
      const result = filtered.length ? filtered : ['full'];
      this.setData({
        'form.raceTypes': result,
        typeFull: result.includes('full'), typeHalf: result.includes('half'),
        type10k: false,
      });
    } else {
      // 10K：已选中则取消回到全马，否则单选
      if (types.length === 1 && types[0] === v) {
        this.setData({
          'form.raceTypes': ['full'],
          typeFull: true, typeHalf: false, type10k: false,
        });
      } else {
        this.setData({
          'form.raceTypes': [v],
          typeFull: false, typeHalf: false, type10k: v === '10k',
        });
      }
    }
  },
  onFormLevel(e) { this.setData({ 'form.raceLevel': e.currentTarget.dataset.v }); },
  onFormMechanism(e) { this.setData({ 'form.mechanism': e.currentTarget.dataset.v }); },
  onFormLabel(e) { this.setData({ 'form.label': e.currentTarget.dataset.v }); },
  onFormPayment(e) { this.setData({ 'form.payment': e.currentTarget.dataset.v }); },

  onAddGunTime() {
    const list = this.data.gunTimes;
    const last = list[list.length - 1];
    // 分区：上一个的字母 +1；非单字母则默认 A
    let nextZone = 'A';
    if (last && last.zone && /^[A-Za-z]$/.test(last.zone)) {
      const code = last.zone.toUpperCase().charCodeAt(0);
      if (code < 90) nextZone = String.fromCharCode(code + 1);
    }
    // 时间：上一个 +5 分钟，否则 07:00
    let nextTime = '07:00';
    if (last && last.time) {
      const [h, m] = last.time.split(':').map(Number);
      let total = h * 60 + (m || 0) + 5;
      if (total >= 1440) total = 0;
      nextTime = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }
    this.setData({ gunTimes: [...list, { zone: nextZone, time: nextTime }] });
  },
  onDelGunTime(e) {
    const idx = e.currentTarget.dataset.idx;
    if (this.data.gunTimes.length <= 1) return;
    const arr = [...this.data.gunTimes]; arr.splice(idx, 1);
    this.setData({ gunTimes: arr });
  },
  onGunTimeZone(e) {
    const idx = e.currentTarget.dataset.idx;
    const arr = [...this.data.gunTimes];
    arr[idx] = { ...arr[idx], zone: this.data.zoneOptions[e.detail.value], zoneIdx: e.detail.value };
    this.setData({ gunTimes: arr });
  },
  onGunTimeInput(e) {
    const { idx, field } = e.currentTarget.dataset;
    const arr = [...this.data.gunTimes];
    arr[idx] = { ...arr[idx], [field]: e.detail.value };
    this.setData({ gunTimes: arr });
  },
  onGunTimeTime(e) {
    const idx = e.currentTarget.dataset.idx;
    const arr = [...this.data.gunTimes];
    arr[idx] = { ...arr[idx], time: e.detail.value };
    this.setData({ gunTimes: arr });
  },
  onTimelineDate(e) {
    const idx = e.currentTarget.dataset.idx;
    const nodes = [...this.data.timelineNodes];
    nodes[idx].date = e.detail.value;
    // 如果是鸣枪开跑节点，同步更新 form.date
    if (nodes[idx].label === '鸣枪开跑') {
      this.setData({ timelineNodes: nodes, 'form.date': e.detail.value });
    } else {
      this.setData({ timelineNodes: nodes });
    }
  },
  onTimelineTime(e) {
    const idx = e.currentTarget.dataset.idx;
    const nodes = [...this.data.timelineNodes];
    nodes[idx].time = e.detail.value;
    this.setData({ timelineNodes: nodes });
  },
  onClearTime(e) {
    const idx = e.currentTarget.dataset.idx;
    const nodes = [...this.data.timelineNodes];
    // 一次清掉日期和时间
    if (nodes[idx].label === '鸣枪开跑') {
      nodes[idx].date = '';
      nodes[idx].time = '';
      this.setData({ timelineNodes: nodes, 'form.date': '' });
    } else {
      nodes[idx].date = '';
      nodes[idx].time = '';
      this.setData({ timelineNodes: nodes });
    }
  },
    onFormRegStatus(e) { this.setData({ 'form.regStatus': e.currentTarget.dataset.v }); },
  onDateChange(e) { this.setData({ 'form.date': e.detail.value }); },
  onHideForm() { this.setData({ showForm: false }); },

  async onSave() {
    const f = this.data.form;
    if (!f.name.trim()) return wx.showToast({ title: '请输入赛事名称', icon: 'none' });
    if (this.data.nameDupStatus === 'dup') return wx.showToast({ title: '同名赛事已存在，请修改名称', icon: 'none' });
    if (!f.date) return wx.showToast({ title: '请选择鸣枪开跑日期', icon: 'none' });
    const raceDate = new Date(f.date);
    if (!this.data.editingId && raceDate < new Date(new Date().toDateString())) return wx.showToast({ title: '赛事日期不能早于今天', icon: 'none' });
    wx.showLoading({ title: '保存中' });

    // 海报使用 posters 数组
    const posters = (f.posters || []).filter(Boolean) || [];

    const data = {
      name: f.name.trim(), raceGroup: (f.raceGroup || '').trim() || f.name.trim().replace(/^20\d{2}\s*/, '').replace(/[「·\s]?(20\d{2})$/, '').trim(),
      date: new Date(f.date), province: f.province.trim(), city: f.city.trim(),
      raceTypes: (f.raceTypes || ['full']).filter(Boolean),
      raceLevel: f.raceLevel, label: f.label,
      scale: (f.scale || '').toString().trim(), subScale: (f.subScale || '').toString().trim(), fee: (f.fee || '').toString().trim(),
      organizer: (f.organizer || '').trim(), operator: (f.operator || '').trim(),
      contactPhone: (f.contactPhone || '').trim(), contactEmail: (f.contactEmail || '').trim(), wechatAccount: (f.wechatAccount || '').trim(), website: f.website.trim(),
      mechanism: f.mechanism, payment: f.payment, signupChannels: (f.signupChannels || '').trim(),
      medicalReport: (f.medicalReport || '').trim(), finishRequirement: (f.finishRequirement || '').trim(), refundRule: (f.refundRule || '').trim(), startPoint: (f.startPoint || '').trim(),
      medalImage: (f.medalImage || '').trim(), routeMap: (f.routeMap || '').trim(),
      regStatus: f.regStatus,
      gunTimes: this.data.gunTimes.filter(g => g.time),
      timeline: this.data.timelineNodes.filter(n => n.date).map(n => ({ label: n.label, date: n.date, time: n.time || '' })),
      posters,
      status: new Date(f.date) < new Date() ? 'finished' : 'upcoming',
      tagStats: {}, reviewCount: 0, avgScore: 0,
      publishStatus: 'published',
      source: this.data.editingId
        ? (((this.data.allRaceList.find(r => r._id === this.data.editingId) || {}).source) || 'manual')
        : 'manual',
    };

    // 字段级保护：编辑时对比新旧值，把人工改过的字段写入 manualFields（导入时保留，不覆盖）
    if (this.data.editingId) {
      const old = this.data.allRaceList.find(r => r._id === this.data.editingId) || {};
      const manual = new Set(old.manualFields || []);
      const COMPARE_FIELDS = ['name','raceGroup','date','province','city','raceTypes','raceLevel','label','scale','subScale','fee','organizer','operator','contactPhone','contactEmail','wechatAccount','website','mechanism','payment','signupChannels','medicalReport','finishRequirement','refundRule','startPoint','medalImage','routeMap','regStatus','gunTimes','timeline','posters'];
      const toStr = (v) => {
        if (v instanceof Date) {
          const p = n => String(n).padStart(2, '0');
          return v.getFullYear() + '-' + p(v.getMonth()+1) + '-' + p(v.getDate());
        }
        return v;
      };
      const norm = (v) => {
        if (v instanceof Date) return toStr(v);
        if (Array.isArray(v)) {
          return JSON.stringify(v.map(x => {
            if (x instanceof Date) return toStr(x);
            if (x && typeof x === 'object') {
              const o = {};
              for (const k of Object.keys(x)) o[k] = x[k] instanceof Date ? toStr(x[k]) : x[k];
              return o;
            }
            return x;
          }));
        }
        return v === undefined || v === null ? '' : v;
      };
      COMPARE_FIELDS.forEach(k => {
        if (norm(old[k]) !== norm(data[k])) manual.add(k);
      });
      data.manualFields = [...manual];
    }

    if (this.data.editingId) {
      await raceUtil.update(this.data.editingId, data);
      // 直接更新本地缓存
      const list = this.data.allRaceList.slice();
      const idx = list.findIndex(r => r._id === this.data.editingId);
      if (idx > -1) {
        list[idx] = { ...list[idx], ...data, fmtDate: this.fmtDate(data.date), raceTypesStr: (data.raceTypes||[]).map(t => ({ full:'全马', half:'半马', '10k':'10K' }[t]||t)).join('/'), countdown: this.calcCountdown(data.date, data.status, data.timeline, data.gunTimes) };
        this.setData({ allRaceList: list, showForm: false });
        this.applyAdminFilter();
      }
    } else {
      const addRes = await raceUtil.create(data);
      // 新记录加到本地缓存
      const newItem = { _id: addRes._id, ...data, fmtDate: this.fmtDate(data.date), raceTypesStr: (data.raceTypes||[]).map(t => ({ full:'全马', half:'半马', '10k':'10K' }[t]||t)).join('/'), countdown: this.calcCountdown(data.date, data.status, data.timeline, data.gunTimes) };
      const list = [newItem, ...this.data.allRaceList];
      this.setData({ allRaceList: list, showForm: false });
      this.applyAdminFilter();
    }
    wx.hideLoading();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  genRacePoster(qrTempURL, raceInfo) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: qrTempURL,
        success: (imgInfo) => {
          const query = wx.createSelectorQuery();
          query.select('#qrPosterCanvas').fields({ node: true, size: true }).exec((res) => {
            try {
              if (!res || !res[0]) return reject(new Error('canvas not found'));
              const canvas = res[0].node;
              const ctx = canvas.getContext('2d');
              const dpr = wx.getSystemInfoSync().pixelRatio || 2;
              const W = 400, H = 520;
              canvas.width = W * dpr;
              canvas.height = H * dpr;
              ctx.scale(dpr, dpr);

              // 白色背景
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, W, H);

              // 赛事名称（截断防溢出）
              ctx.fillStyle = '#333333';
              ctx.font = 'bold 24px sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              let displayName = raceInfo.name || '';
              if (displayName.length > 14) displayName = displayName.slice(0, 12) + '…';
              ctx.fillText(displayName, W / 2, 24);

              // 日期 · 城市
              ctx.fillStyle = '#888888';
              ctx.font = '18px sans-serif';
              const metaParts = [raceInfo.date, raceInfo.city].filter(Boolean);
              if (metaParts.length) ctx.fillText(metaParts.join(' · '), W / 2, 56);

              // 类型 · 等级 · 标牌
              const typeParts = [];
              if (raceInfo.type) typeParts.push(raceInfo.type);
              if (raceInfo.level) typeParts.push(raceInfo.level + '级');
              if (raceInfo.label) typeParts.push(raceInfo.label);
              if (typeParts.length) ctx.fillText(typeParts.join(' · '), W / 2, 80);

              // 加载二维码图片并绘制
              const img = canvas.createImage();
              img.src = imgInfo.path;
              img.onload = () => {
                const qrSize = 280;
                const qrX = (W - qrSize) / 2;
                const qrY = 112;
                ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

                // 底部提示
                ctx.fillStyle = '#aaaaaa';
                ctx.font = '14px sans-serif';
                ctx.fillText('扫码查看赛事详情、标记和评分', W / 2, 415);

                // 导出为临时文件
                wx.canvasToTempFilePath({
                  canvas,
                  x: 0, y: 0,
                  width: W * dpr, height: H * dpr,
                  destWidth: W * dpr, destHeight: H * dpr,
                  fileType: 'png',
                  quality: 1,
                  success: (r) => resolve(r.tempFilePath),
                  fail: (e) => reject(e),
                });
              };
              img.onerror = () => reject(new Error('canvas image load failed'));
            } catch (e) { reject(e); }
          });
        },
        fail: () => reject(new Error('getImageInfo failed')),
      });
    });
  },

  async onShare(e) {
    const id = e.currentTarget.dataset.id;
    const r = this.data.raceList.find(x => x._id === id);
    const name = r ? r.name : (e.currentTarget.dataset.name || '');
    const city = r ? (r.city || '') : '';
    const dateStr = r ? r.fmtDate || this.fmtDate(r.date) : '';
    const rtStr = r ? r.raceTypesStr || (r.raceTypes || [r.raceType || 'full']).map(t => ({ full:'全马', half:'半马', '10k':'10K' }[t]||t)).join('/') : '';
    const levelStr = r ? (r.raceLevel || '') : '';
    const labelStr = r && r.label ? r.label : '';
    const raceInfo = { name, city, date: dateStr, type: rtStr, level: levelStr, label: labelStr };
    wx.showLoading({ title: '生成中' });
    try {
      const res = await wx.cloud.callFunction({ name: 'genRaceQR', data: { raceId: id, raceName: name } });
      const fileID = (res.result || {}).fileID;
      const r2 = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: [fileID] } });
      const url = (r2.result || [])[0];
      const qrUrl = url ? url.tempFileURL : fileID;

      // 尝试合成带赛事信息的海报图
      try {
        const posterPath = await this.genRacePoster(qrUrl, raceInfo);
        const upRes = await wx.cloud.uploadFile({
          cloudPath: `qrcode/race_${id}_poster.png`,
          filePath: posterPath,
        });
        if (upRes.fileID) {
          const r3 = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: [upRes.fileID] } });
          const posterUrl = (r3.result || [])[0];
          this.setData({ showQR: true, qrFileID: posterUrl ? posterUrl.tempFileURL : upRes.fileID, sharingRaceName: name, sharingRaceInfo: raceInfo, showQRText: false });
          wx.hideLoading();
          return;
        }
      } catch (posterErr) {
        console.warn('poster composition failed, fallback to plain QR', posterErr);
      }

      // 兜底：显示原始二维码
      this.setData({ showQR: true, qrFileID: qrUrl, sharingRaceName: name, sharingRaceInfo: raceInfo, showQRText: true });
    } catch (e) {
      console.error('genRaceQR error:', e);
      wx.showToast({ title: '生成失败', icon: 'none' });
    }
    wx.hideLoading();
  },
  onHideQR() { this.setData({ showQR: false, showQRText: true }); },
});
