// pages/tools/calendar/detail.js - 赛事详情
const raceUtil = require('../../../utils/raceEvents');
const shareUtil = require('../../../utils/share');
const cache = require('../../../utils/cache');

// 复用日历「关注赛事」已授权过的通用模板，避免跑友再授一次权
const HELP_TMPL_ID = 'xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew';

Page({
  data: {
    eventId: '',
    event: {},
    reviewStats: null,
    topTags: [],
    isMine: false,
    myStatus: '',
    myReview: null,
    otherReviews: [],      // 他人评价列表
    reviewPage: 0,
    reviewTotal: 0,
    reviewHasMore: false,
    raceGroup: '',
    scoreTab: 'all',  // all | full | half
    reviewTypeFilter: '',
    showAllTimeline: false,
    showPoster: false,
    posterIdx: 0,
    showResultModal: false,
    resultInput: '',
    resultRaceType: 'full',
    showResultTimePicker: false,
    showMarkSheet: false,
    qrStatus: 'none',       // none | fresh | ok | expired（qr 状态）
    qrCodeUrl: '',          // 群二维码展示 URL（cloud:// 文件ID 或 http 链接，image 直接渲染）
    qrCodeTempUrl: '',      // 群二维码临时 http 链接（previewImage 用，异步获取）
    raceFinished: false,    // 赛事是否已举办完成（完成后不再提示通知负责人）
    // ===== 催建群进度 =====
    remindCount: 0,         // 已催办人数（按人去重）
    remindTarget: 3,        // 达标人数
    remindPercent: 0,       // 进度百分比
    remindList: [],         // 催办名单
    remindDone: false,      // 是否已达标
    myReminded: false,      // 我是否已催过
    cooldownLeft: 0,        // 我还要等多少秒才能再催（仅对我生效）
    cooldownText: '',       // 冷却文案（分钟/秒）
    notifyingOwner: false,

    // ===== 跑友互助（拼房 / 拼车 / 拼饭 / 旅游 / 组队） =====
    helpList: [],
    helpLoading: false,
    helpTypes: [
      { key: 'room', label: '拼房', icon: '🏠' },
      { key: 'carpool', label: '拼车', icon: '🚗' },
      { key: 'meal', label: '拼饭', icon: '🍜' },
      { key: 'tour', label: '旅游', icon: '🧳' },
      { key: 'team', label: '组队', icon: '👥' },
    ],
    helpToday: '',          // date picker 起始
    helpMaxDate: '',        // date picker 结束
    showHelpForm: false,
    helpSubmitting: false,
    helpForm: { type: 'room', title: '', desc: '', costNote: '', peopleNeeded: '1', deadline: '', deadlineTime: '23:59', wechat: '', ruleAgreed: false },
    showHelpDetail: false,
    curHelp: {},
    applyMessage: '', applyWechat: '', applyPeopleCount: '1',
    applying: false,
    showHelpMine: false,
    helpMineTab: 'mine',    // mine | apply
    myHelps: [],
    myApplies: [],
  },

  // 计算赛事二维码状态：none / fresh(<3d) / ok(<7d) / expired(>=7d)
  calcQrStatus(qrCode, qrCodeUpdatedAt) {
    if (!qrCode || qrCode === '') return 'none';
    if (!qrCodeUpdatedAt) return 'ok';
    const ts = (qrCodeUpdatedAt instanceof Date ? qrCodeUpdatedAt : new Date(qrCodeUpdatedAt)).getTime();
    const days = (Date.now() - ts) / 86400000;
    if (days >= 7) return 'expired';
    if (days >= 3) return 'ok';
    return 'fresh';
  },

  // 赛事是否已举办完成（比赛日早于今天 0 点，或 status='finished'）
  calcRaceFinished(status, date) {
    if (status === 'finished') return true;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return new Date(date).getTime() < startOfToday.getTime();
  },

  onScoreTab(e) { this.setData({ scoreTab: e.currentTarget.dataset.t }); },
  onToggleTimeline() { this.setData({ showAllTimeline: !this.data.showAllTimeline }); },
  onReviewTypeFilter(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ reviewTypeFilter: this.data.reviewTypeFilter === v ? '' : v });
  },

  onPreviewPoster(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ showPoster: true, posterIdx: idx });
  },
  onHidePoster() { this.setData({ showPoster: false }); },
  onPosterSwiperChange(e) {
    this.setData({ posterIdx: e.detail.current });
  },

  onLoad(options) {
    const eventId = options.scene ? decodeURIComponent(options.scene) : options.id;
    if (!eventId) return;
    this.setData({ eventId });
    shareUtil.enableShareMenu();
    // onShow 会负责加载数据，避免重复请求
  },

  onShow() {
    if (this.data.event && this.data.event._id) {
      this.loadEvent(true); // 有缓存，后台静默刷新
    } else {
      this.loadEvent();
    }
  },

  async loadEvent(silent = false) {
    if (!silent) wx.showLoading({ title: '加载中' });
    try {
      const userInfo = wx.getStorageSync('userInfo');
      const uid = userInfo ? (userInfo._id || userInfo.openid) : null;

      const { event, reviewStats, myMarker, myReview } = await raceUtil.getEventDetail(this.data.eventId, uid);
      if (!event) { wx.showToast({ title: '赛事不存在', icon: 'none' }); return; }

      const stats = reviewStats || { count: 0, avgScore: 0, dimensions: {}, tagStats: {} };
      const tagEntries = Object.entries(stats.tagStats || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 10);

      const isMine = !!myMarker;
      const myStatus = myMarker ? myMarker.status : '';

      // 把赛事鸣枪开跑日期注入时间轴（如果还没在 timeline 中）
      let timeline = event.timeline || [];
      const hasRaceDate = timeline.some(t => t.label === '鸣枪开跑' || t.label === '举办日期');
      if (!hasRaceDate && event.date) {
        timeline = [...timeline, { label: '鸣枪开跑', date: event.date, time: '' }];
      }
      // 兼容旧数据"举办日期" → "鸣枪开跑"
      timeline = timeline.map(t => t.label === '举办日期' ? { ...t, label: '鸣枪开跑' } : t);
      // 用最早 gunTime 同步鸣枪开跑时间
      if (event.gunTimes && event.gunTimes.length) {
        const sorted = [...event.gunTimes].filter(g => g.time).sort((a, b) => a.time.localeCompare(b.time));
        if (sorted.length && sorted[0].time) {
          const gunNode = timeline.find(t => t.label === '鸣枪开跑');
          if (gunNode) gunNode.time = sorted[0].time;
        }
      }
      const processedTimeline = this.processTimeline(timeline);

      // 海报cloud://转临时链接，兼容 posters 数组和 poster 单图
      let posterUrl = '';
      let postersArr = [];
      const rawPosters = event.posters && event.posters.length ? event.posters : (event.poster ? [event.poster] : []);
      if (rawPosters.length) {
        const cloudOnes = rawPosters.filter(p => p && p.startsWith('cloud://'));
        const others = rawPosters.filter(p => p && !p.startsWith('cloud://'));
        if (cloudOnes.length) {
          // 先尝试云函数 getImageUrls 批量转换
          let map = {};
          try {
            const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: cloudOnes } });
            (r.result || []).forEach(f => { if (f.tempFileURL) map[f.fileID] = f.tempFileURL; });
          } catch (e) { console.warn('getImageUrls 云函数调用失败，尝试客户端 API', e); }
          // 如果有失败的，用客户端 wx.cloud.getTempFileURL 兜底
          const missing = cloudOnes.filter(id => !map[id]);
          if (missing.length) {
            try {
              const cr = await wx.cloud.getTempFileURL({ fileList: missing });
              (cr.fileList || []).forEach(f => { if (f.tempFileURL) map[f.fileID] = f.tempFileURL; });
            } catch (e) { console.warn('客户端 getTempFileURL 也失败', e); }
          }
          postersArr = rawPosters.map(p => p.startsWith('cloud://') ? (map[p] || '') : p).filter(Boolean);
        } else {
          postersArr = others;
        }
        posterUrl = postersArr[0] || '';
      }
      console.log('[detail] postersArr:', postersArr, 'rawPosters:', rawPosters, 'event.posters:', event.posters);

      // 根据 raceTypes 计算规模/费用展示
      const rt = event.raceTypes || [event.raceType || 'full'];
      const hasBoth = rt.includes('full') && rt.includes('half');
      let scaleDisplay, feeDisplay;
      if (hasBoth) {
        const sp = []; const fp = [];
        if (event.scaleFull) sp.push(`全马 ${event.scaleFull}`);
        if (event.scaleHalf) sp.push(`半马 ${event.scaleHalf}`);
        if (event.feeFull) fp.push(`全马 ${event.feeFull}`);
        if (event.feeHalf) fp.push(`半马 ${event.feeHalf}`);
        scaleDisplay = sp.length ? sp.join(' · ') : event.scale || '';
        feeDisplay = fp.length ? fp.join(' · ') : event.fee || '';
      } else {
        scaleDisplay = event.scaleFull || event.scaleHalf || event.scale || '';
        feeDisplay = event.feeFull || event.feeHalf || event.fee || '';
      }

      this.setData({
        event: {
          ...event,
          poster: posterUrl,
          _posters: postersArr,
          fmtDate: this.fmtDate(event.date),
          countdown: this.calcCountdown(event.date, timeline, event.gunTimes),
          raceTypeName: (rt).map(t => ({ full: '全马', half: '半马', '10k': '10K' }[t] || t)).join('·'),
          timeline: processedTimeline,
          _scaleDisplay: scaleDisplay,
          _feeDisplay: feeDisplay,
        },
        qrStatus: this.calcQrStatus(event.qrCode, event.qrCodeUpdatedAt),
        raceFinished: this.calcRaceFinished(event.status, event.date),
        qrNotifyDisabled: !!event.qrNotifyDisabled, // 兼容老数据：true 视为关闭定时
        qrNotifyMode: event.qrNotifyMode || (event.qrNotifyDisabled ? 'expired' : 'all'), // 'all' 正常 | 'expired' 关闭定时（手动催办仍能送达）
        qrCodeUrl: event.qrCode && String(event.qrCode).indexOf('cloud://') !== 0 ? event.qrCode : '',
        qrCodeTempUrl: '',               // 临时 http 链接（previewImage 用，与 qrCodeUrl 同源）
        raceGroup: event.raceGroup || '',
        reviewStats: stats,
        topTags: tagEntries,
        isMine, myStatus, myReview,
        myReviewTags: myReview ? (myReview.tags || []).join('、') : '',
        'myReview.myAvg': myReview && myReview.scores ? Math.round((myReview.scores.difficulty + myReview.scores.atmosphere + myReview.scores.supply + myReview.scores.transport) / 0.4) / 10 : 0,
      });
      if (!silent) wx.hideLoading();
      this.loadHelps();
      // 群二维码：cloud:// 需转 http 临时链接才能渲染（开发者工具不认 cloud:// 会拼成相对 URL 报错）
      // 优先用云函数 getImageUrls（与管理端编辑弹窗同源，已验证稳定），失败再退回客户端 API，
      // 两者都失败时才直接用 cloud://（真机可渲染，开发者工具会报加载错误）
      if (event.qrCode && String(event.qrCode).indexOf('cloud://') === 0) {
        const stillMine = () => this.data.event && this.data.event._id === event._id;
        const apply = (tUrl) => {
          if (!stillMine()) return;
          if (tUrl) this.setData({ qrCodeUrl: tUrl, qrCodeTempUrl: tUrl });
          else this.setData({ qrCodeUrl: event.qrCode }); // 兜底：真机可直接渲染
        };
        wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: [event.qrCode] } })
          .then(ur => {
            const f = (ur && ur.result || [])[0];
            apply(f && f.tempFileURL);
          })
          .catch(() => {
            wx.cloud.getTempFileURL({ fileList: [event.qrCode] })
              .then(r => apply(r.fileList && r.fileList[0] && r.fileList[0].tempFileURL))
              .catch(() => apply(''));
          });
      }
      // 催建群进度（未建群 / 二维码过期时才显示）
      this.loadRemindStatus();
      // 加载他人评价
      if (event.raceGroup) this.loadOtherReviews();
    } catch (err) {
      if (!silent) wx.hideLoading();
      console.error('详情加载失败:', err);
      wx.showToast({ title: '加载失败: ' + (err.message || err.errMsg || '未知'), icon: 'none', duration: 3000 });
    }
  },

  fmtDate(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  },

  calcCountdown(d, timeline, gunTimes) {
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
    if (diffMs > 0) { const d2 = Math.ceil(diffMs / 86400000); return `距鸣枪开跑 ${d2} 天`; }
    if (Math.abs(diffMs) < 86400000) return '今天鸣枪开跑';
    return `已举办 ${Math.ceil(Math.abs(diffMs) / 86400000)} 天`;
  },

  // 旧标签到新标签的映射
  labelMap: {
    '开启报名': '报名开启', '截止报名': '报名截止', '截止退费': '退费截止', '缴费截止时间': '缴费截止', '举办日期': '鸣枪开跑'
  },

  async loadOtherReviews() {
    const rg = this.data.raceGroup;
    if (!rg) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getRaceReviews',
        data: { action: 'groupPage', raceGroup: rg, skip: 0, limit: 10 }
      });
      const r = res.result;
      const list = (r.list || []).map(item => ({
        ...item,
        myAvg: item.scores ? Math.round((item.scores.difficulty + item.scores.atmosphere + item.scores.supply + item.scores.transport) / 0.4) / 10 : 0,
        tagStr: (item.tags || []).join('、'),
      }));
      this.setData({
        otherReviews: list,
        reviewTotal: r.total || 0,
        reviewHasMore: list.length >= 10,
        reviewPage: 1,
      });
    } catch {}
  },

  async loadMoreReviews() {
    if (!this.data.reviewHasMore) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getRaceReviews',
        data: { action: 'groupPage', raceGroup: this.data.raceGroup, skip: this.data.otherReviews.length, limit: 10 }
      });
      const r = res.result;
      const newItems = (r.list || []).map(item => ({
        ...item,
        myAvg: item.scores ? Math.round((item.scores.difficulty + item.scores.atmosphere + item.scores.supply + item.scores.transport) / 0.4) / 10 : 0,
        tagStr: (item.tags || []).join('、'),
      }));
      const list = [...this.data.otherReviews, ...newItems];
      this.setData({
        otherReviews: list,
        reviewHasMore: list.length < r.total,
        reviewPage: this.data.reviewPage + 1,
      });
    } catch {}
  },

  processTimeline(timeline) {
    if (!timeline || !timeline.length) return [];
    // 兼容旧标签名
    const map = this.labelMap || {};
    timeline = timeline.map(t => ({ ...t, label: map[t.label] || t.label }));
    const now = new Date();

    // 计算每个节点的精确时间
    const withTime = timeline.map(t => {
      let exact = null;
      if (t.date) {
        exact = new Date(t.date);
        if (!isNaN(exact.getTime())) {
          if (t.time) { const [h, m] = t.time.split(':'); exact.setHours(+h || 0, +m || 0, 0, 0); }
          else exact.setHours(0, 0, 0, 0);
        } else { exact = null; }
      }
      return { ...t, _exact: exact };
    });

    // 按精确时间排序
    const sorted = [...withTime].sort((a, b) => {
      if (!a._exact) return 1;
      if (!b._exact) return -1;
      return a._exact - b._exact;
    });

    let nextFound = false;
    return sorted.map(t => {
      let status = 'future';
      if (t._exact) {
        if (t._exact < now) {
          status = 'past';
        } else if (!nextFound) {
          status = 'next';
          nextFound = true;
        }
      }
      const dateStr = t.date ? this.fmtDate(t.date) : '';
      return { ...t, status, fmtDate: dateStr + (t.time ? ' ' + t.time : ''), _exact: undefined };
    });
  },

  onWebsite() {
    const url = this.data.event.website;
    if (url) {
      wx.setClipboardData({
        data: url,
        success: () => {
          wx.showModal({
            title: '链接已复制',
            content: `已复制到剪贴板，请粘贴到浏览器中打开\n\n${url}`,
            confirmText: '知道了',
            showCancel: false,
          });
        }
      });
    }
  },

  onReview() {
    this.setData({ _needRefresh: true });
    wx.navigateTo({ url: `/pages/tools/calendar/review?id=${this.data.eventId}&name=${this.data.event.name}` });
  },

  onShareAppMessage() {
    const { event } = this.data;
    const name = event.name || '这赛事';
    return shareUtil.buildShare({
      title: this.data._shareTitle || `快来看看「${name}」`,
      path: `/pages/tools/calendar/detail?id=${this.data.eventId}`,
      imageUrl: event.poster || '',
    });
  },

  onShareTimeline() {
    const { event } = this.data;
    const name = event.name || '这赛事';
    return shareUtil.buildTimeline({
      title: this.data._shareTitle || `快来看看「${name}」`,
      query: `id=${this.data.eventId}`,
      imageUrl: event.poster || '',
    });
  },

  onMark() {
    const { eventId } = this.data;
    if (!eventId) return wx.showToast({ title: '赛事ID无效', icon: 'none' });

    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || (!userInfo._id && !userInfo.openid)) {
      this.setData({ _needRefresh: true });
      return wx.navigateTo({ url: '/pages/login/login' });
    }

    this.setData({ showMarkSheet: true });
  },

  onMarkSelect(e) {
    const status = e.currentTarget.dataset.status;
    const eventId = this.data.eventId;
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return;

    this.setData({ showMarkSheet: false });

    // 标记已完赛需额外录入成绩
    if (status === 'finished') {
      const evt = this.data.event || {};
      const rt = evt.raceTypes || [evt.raceType || 'full'];
      const primaryType = rt.includes('full') ? 'full' : rt[0];
      this.setData({
        showResultModal: true,
        resultInput: '',
        resultRaceType: primaryType,
      });
      return;
    }

    // 取主参赛类型，与列表页一致
    const evt = this.data.event || {};
    const rt = evt.raceTypes || [evt.raceType || 'full'];
    const primaryType = rt.includes('full') ? 'full' : rt[0];

    // 其他状态直接关注
    wx.showLoading({ title: '关注中' });
    raceUtil.markEvent(userInfo._id, eventId, status, false, primaryType).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '已关注', icon: 'success' });
      this.setData({ myStatus: status, isMine: true, _shareTitle: `我已关注「${this.data.event.name}」，邀请你来关注` });
      cache.invalidate('calendar'); // 列表缓存失效，返回后重新查库
      // 邀请分享：关注赛事
      wx.showModal({
        title: '已关注',
        content: `我已关注「${this.data.event.name}」，邀请你来关注`,
        confirmText: '分享',
        cancelText: '完成',
        success: (r) => { if (r.confirm) wx.showToast({ title: '请点击右上角转发', icon: 'none' }); },
      });
    }).catch(err => {
      wx.hideLoading();
      console.error('关注赛事失败:', err);
      wx.showToast({ title: '关注失败，请重试', icon: 'none' });
    });
  },

  onHideMarkSheet() { this.setData({ showMarkSheet: false }); },

  // 预览群二维码（放大保存）
  onPreviewRaceQr() {
    const url = this.data.qrCodeTempUrl || this.data.qrCodeUrl; // 优先用已转好的临时链接
    if (!url) return;
    if (url.indexOf('cloud://') === 0) {
      // previewImage 不认云文件 ID，先转临时链接
      wx.cloud.getTempFileURL({ fileList: [url] })
        .then(r => {
          const f = r.fileList && r.fileList[0];
          if (f && f.tempFileURL) wx.previewImage({ urls: [f.tempFileURL] });
          else wx.showToast({ title: '二维码加载中，稍后再试', icon: 'none' });
        })
        .catch(() => wx.showToast({ title: '二维码加载失败', icon: 'none' }));
    } else {
      wx.previewImage({ urls: [url] });
    }
  },

  // 查该赛事的催建群进度（谁催过、还差几人）
  // 进度只在「还没建群」时展示；二维码过期是直接提醒，不看进度
  async loadRemindStatus() {
    const { eventId, qrStatus, raceFinished } = this.data;
    if (!eventId || raceFinished) return;
    if (qrStatus !== 'none') {
      this.setData({ remindCount: 0, remindTarget: 3, remindPercent: 0, remindList: [], remindDone: false, myReminded: false });
      return;
    }
    const userInfo = wx.getStorageSync('userInfo') || {};
    const reporterId = userInfo._id || userInfo.openid || '';
    try {
      const r = await wx.cloud.callFunction({
        name: 'notifyRaceQrOwner',
        data: { action: 'status', eventId, reporterId, reason: 'missing' },
      });
      const res = (r && r.result) || {};
      if (res.success) this.applyRemindStatus(res);
    } catch (e) {
      console.warn('loadRemindStatus fail', e);
    }
  },

  // 把云函数返回的进度写到页面，并顺带把分享标题改成带进度的话术
  applyRemindStatus(res) {
    const left = res.cooldownLeft || 0;
    this.setData({
      remindCount: res.count || 0,
      remindTarget: res.target || 3,
      remindPercent: res.percent || 0,
      remindList: res.list || [],
      remindDone: !!res.done,
      myReminded: !!res.myReminded,
      cooldownLeft: left,
      // 只有「我」有冷却，别人随时能催
      cooldownText: left > 0
        ? (left >= 60 ? `${Math.ceil(left / 60)} 分钟后可再催` : `${left} 秒后可再催`)
        : '',
    });
    const count = res.count || 0;
    const name = (this.data.event && this.data.event.name) || '这赛事';
    const expired = this.data.qrStatus === 'expired';
    if (expired) {
      // 过期不展示进度，分享标题也不带人数
      this.setData({ _shareTitle: `「${name}」群二维码过期了，有跑友在等管理员更新` });
    } else if (count > 0) {
      this.setData({
        _shareTitle: res.done
          ? `「${name}」${count} 位跑友都在等建群，进群一起备赛！`
          : `「${name}」还没建群，${count} 位跑友在催，一起来！`,
      });
    }
  },

  // 催管理员建群（同一人 10 分钟内只能催一次，重复催不重复计数）
  async onNotifyOwner() {
    const { qrStatus, eventId, notifyingOwner, raceFinished, cooldownLeft } = this.data;
    if (notifyingOwner) return;
    if (raceFinished) {
      return wx.showToast({ title: '赛事已举办完成，无需建群', icon: 'none' });
    }
    if (qrStatus !== 'expired' && qrStatus !== 'none') {
      return wx.showToast({ title: '管理员已建群 🎉', icon: 'none' });
    }
    if (cooldownLeft > 0) {
      return wx.showToast({ title: `${Math.ceil(cooldownLeft / 60)} 分钟后再试`, icon: 'none' });
    }
    const reason = qrStatus === 'none' ? 'missing' : 'expired';

    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || (!userInfo._id && !userInfo.openid)) {
      return wx.navigateTo({ url: '/pages/login/login' });
    }

    // 订阅消息授权（软依赖，拒绝也放行；管理员每次收到通知前需有人授权过）
    try {
      await new Promise((resolve) => {
        wx.requestSubscribeMessage({
          tmplIds: ['mcDtCsiTEPabnEEWb317RnQT4K12zkoknB02GfQZHN4'],
          success: (r) => resolve(r),
          fail: (e) => { console.warn('requestSubscribeMessage fail', e); resolve({}); },
        });
      });
    } catch (e) { console.warn('subscribe exception', e); }

    wx.showLoading({ title: '催办中' });
    this.setData({ notifyingOwner: true });
    try {
      const r = await wx.cloud.callFunction({
        name: 'notifyRaceQrOwner',
        data: {
          action: 'remind',
          eventId,
          reporterId: userInfo._id || userInfo.openid || '',
          reason,
        },
      });
      wx.hideLoading();
      this.setData({ notifyingOwner: false });
      const res = (r && r.result) || {};
      if (!res.success) {
        return wx.showToast({ title: res.error || '催办失败', icon: 'none' });
      }
      if (res.skipped) return wx.showToast({ title: res.message || '赛事已结束', icon: 'none' });
      if (res.alreadyCreated) {
        this.applyRemindStatus(res);
        return wx.showToast({ title: '管理员已建群 🎉', icon: 'success' });
      }

      this.applyRemindStatus(res);

      if (res.cooldown) {
        return wx.showToast({ title: `刚催过了，${Math.ceil((res.cooldownLeft || 0) / 60)} 分钟后再试`, icon: 'none' });
      }
      const isExpired = qrStatus === 'expired';
      const raceName = this.data.event.name;
      if (isExpired) {
        // 过期是直接提醒管理员换码，不凑人、不算进度，所以反馈也不需要报次数
        wx.showToast({ title: '已提醒管理员更新二维码', icon: 'none' });
      } else if (res.repeat) {
        wx.showToast({ title: `已再次通知负责人，目前 ${res.count} 人`, icon: 'none' });
      } else if (res.done) {
        wx.showModal({
          title: '🎉 满 3 人了！',
          content: `已有 ${res.count} 位跑友在催「${raceName}」建群，负责人会优先处理。`,
          confirmText: '知道了',
          showCancel: false,
        });
      } else {
        wx.showToast({ title: `已通知负责人，目前 ${res.count} 人`, icon: 'none' });
      }
      // 第一个人催完鼓励分享：负责人已经收到提醒，人越多越受重视
      if (!isExpired && !res.done && !res.repeat && res.count === 1) {
        setTimeout(() => {
          wx.showToast({ title: '负责人已收到提醒，拉上同场跑友更有分量', icon: 'none', duration: 2500 });
        }, 1200);
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ notifyingOwner: false });
      console.error('notifyRaceQrOwner fail', err);
      wx.showToast({ title: '催办失败，请重试', icon: 'none' });
    }
  },

  // ==================== 跑友互助（拼房 / 拼车 / 拼饭 / 旅游 / 组队） ====================

  // 加载本场赛事的互助列表；没关注这场赛事时云函数会返回空列表
  async loadHelps() {
    const { eventId, raceFinished } = this.data;
    if (!eventId || raceFinished) return;
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return;
    this.setData({ helpLoading: true });
    try {
      const r = await wx.cloud.callFunction({ name: 'raceHelp', data: { action: 'list', eventId } });
      const res = (r && r.result) || {};
      if (res.success) this.setData({ helpList: res.list || [] });
    } catch (e) {
      console.warn('loadHelps fail', e);
    }
    this.setData({ helpLoading: false });
  },

  onOpenHelpForm() {
    if (!this.data.isMine) return wx.showToast({ title: '先关注这场赛事才能发布互助', icon: 'none' });
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return wx.navigateTo({ url: '/pages/login/login' });

    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    // 默认截止到赛事前一天（赛事日期不明就默认 7 天后）
    let deadline = '';
    const raceDate = this.data.event && this.data.event.date ? new Date(this.data.event.date) : null;
    if (raceDate && !isNaN(raceDate.getTime())) {
      const prev = new Date(raceDate.getTime() - 86400000);
      if (prev > today) deadline = fmt(prev);
    }
    if (!deadline) deadline = fmt(new Date(Date.now() + 7 * 86400000));

    this.setData({
      showHelpForm: true,
      helpSubmitting: false,
      helpToday: fmt(today),
      helpMaxDate: fmt(new Date(Date.now() + 90 * 86400000)),
      helpForm: { type: 'room', title: '', desc: '', costNote: '', peopleNeeded: '1', deadline, deadlineTime: '23:59', wechat: '', ruleAgreed: false },
    });
  },
  onCloseHelpForm() { this.setData({ showHelpForm: false }); },
  onPickHelpType(e) { this.setData({ 'helpForm.type': e.currentTarget.dataset.k }); },
  onHelpFormInput(e) { this.setData({ [`helpForm.${e.currentTarget.dataset.k}`]: e.detail.value }); },
  onHelpDeadline(e) { this.setData({ 'helpForm.deadline': e.detail.value }); },
  onHelpDeadlineTime(e) { this.setData({ 'helpForm.deadlineTime': e.detail.value }); },

  // 订阅消息是一次性的：不在这里要点额度，别人应征/取消就通知不到。
  // 用户点了「取消」也一样往下走，不拦流程。
  askSubscribe() {
    return new Promise((resolve) => {
      if (typeof wx.requestSubscribeMessage !== 'function') return resolve();
      wx.requestSubscribeMessage({ tmplIds: [HELP_TMPL_ID], complete: () => resolve() }).catch(() => resolve());
    });
  },
  onToggleHelpRule() { this.setData({ 'helpForm.ruleAgreed': !this.data.helpForm.ruleAgreed }); },

  async onSubmitHelp() {
    const { eventId, helpForm } = this.data;
    if (!String(helpForm.title).trim()) return wx.showToast({ title: '请填写标题', icon: 'none' });
    if (!helpForm.ruleAgreed) return wx.showToast({ title: '请先阅读并勾选互助规则', icon: 'none' });
    if (!String(helpForm.wechat).trim()) {
      return wx.showToast({ title: '请填写微信号', icon: 'none' });
    }
    if (!/^[-_a-zA-Z0-9]{5,20}$/.test(String(helpForm.wechat).trim())) {
      return wx.showToast({ title: '微信号格式不对', icon: 'none' });
    }
    if (!helpForm.deadline) return wx.showToast({ title: '请选择截止时间', icon: 'none' });
    this.setData({ helpSubmitting: true });
    wx.showLoading({ title: '发布中' });
    try {
      // 先要一次推送额度，有人应征时才通知得到
      await this.askSubscribe();
      const r = await wx.cloud.callFunction({
        name: 'raceHelp',
        data: {
          action: 'create',
          eventId,
          type: helpForm.type,
          title: helpForm.title,
          desc: helpForm.desc,
          costNote: helpForm.costNote,
          peopleNeeded: helpForm.peopleNeeded,
          // 日期 + 时刻拼起来，后端按分钟判定是否临近截止
          deadline: `${helpForm.deadline} ${helpForm.deadlineTime || '23:59'}`,
          contact: { wechat: helpForm.wechat },
          ruleAgreed: helpForm.ruleAgreed,
        },
      });
      wx.hideLoading();
      this.setData({ helpSubmitting: false });
      const res = (r && r.result) || {};
      if (!res.success) return wx.showToast({ title: res.error || '发布失败', icon: 'none' });
      wx.showToast({ title: '已发布 🎉', icon: 'success' });
      this.setData({ showHelpForm: false });
      this.loadHelps();
    } catch (e) {
      wx.hideLoading();
      this.setData({ helpSubmitting: false });
      wx.showToast({ title: '发布失败，请重试', icon: 'none' });
    }
  },

  onOpenHelpDetail(e) {
    const item = this.data.helpList.find(h => h._id === e.currentTarget.dataset.id);
    if (!item) return;
    this.setData({ showHelpDetail: true, curHelp: item, applyMessage: '', applyWechat: '' });
  },
  onCloseHelpDetail() { this.setData({ showHelpDetail: false }); },
  onApplyInput(e) { this.setData({ [e.currentTarget.dataset.k]: e.detail.value }); },

  async onSubmitApply() {
    const { curHelp, applyMessage, applyWechat, applyPeopleCount } = this.data;
    const peopleCount = Math.max(1, Math.min(9, parseInt(applyPeopleCount, 10) || 1));
    if (!String(applyWechat).trim()) {
      return wx.showToast({ title: '请填写微信号', icon: 'none' });
    }
    if (!/^[-_a-zA-Z0-9]{5,20}$/.test(String(applyWechat).trim())) {
      return wx.showToast({ title: '微信号格式不对', icon: 'none' });
    }
    this.setData({ applying: true });
    wx.showLoading({ title: '提交中' });
    try {
      // 发起人取消时要通知得到，也靠这一次授权
      await this.askSubscribe();
      const r = await wx.cloud.callFunction({
        name: 'raceHelp',
        data: {
          action: 'apply',
          helpId: curHelp._id,
          message: applyMessage,
          peopleCount,
          contact: { wechat: applyWechat },
        },
      });
      wx.hideLoading();
      this.setData({ applying: false });
      const res = (r && r.result) || {};
      if (!res.success) return wx.showToast({ title: res.error || '应征失败', icon: 'none' });
      wx.showToast({ title: '已应征，双方已互见联系方式', icon: 'success', duration: 2500 });
      this.setData({ showHelpDetail: false });
      this.loadHelps();
    } catch (e) {
      wx.hideLoading();
      this.setData({ applying: false });
      wx.showToast({ title: '应征失败，请重试', icon: 'none' });
    }
  },

  onReportHelp() {
    const { curHelp } = this.data;
    wx.showModal({
      title: '举报这条互助',
      content: '涉嫌交易、广告、虚假信息的互助会被下架。确认举报？',
      confirmText: '举报',
      confirmColor: '#ff4d4f',
      success: async (r) => {
        if (!r.confirm) return;
        const res = await wx.cloud.callFunction({
          name: 'raceHelp', data: { action: 'report', helpId: curHelp._id },
        }).then(x => (x && x.result) || {}).catch(() => ({}));
        wx.showToast({ title: res.success ? '已举报，感谢反馈' : (res.error || '举报失败'), icon: 'none' });
        if (res.success) { this.setData({ showHelpDetail: false }); this.loadHelps(); }
      },
    });
  },

  async onOpenMyHelp() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return wx.navigateTo({ url: '/pages/login/login' });
    this.setData({ showHelpMine: true, showHelpDetail: false });
    await this.loadMyHelps();
  },
  onCloseMyHelp() { this.setData({ showHelpMine: false }); },
  onSwitchHelpTab(e) { this.setData({ helpMineTab: e.currentTarget.dataset.t }); },

  async loadMyHelps() {
    wx.showLoading({ title: '加载中' });
    try {
      const [a, b] = await Promise.all([
        wx.cloud.callFunction({ name: 'raceHelp', data: { action: 'myHelps' } }).then(x => (x && x.result) || {}).catch(() => ({})),
        wx.cloud.callFunction({ name: 'raceHelp', data: { action: 'myApplies' } }).then(x => (x && x.result) || {}).catch(() => ({})),
      ]);
      this.setData({ myHelps: a.list || [], myApplies: b.list || [] });
    } catch (e) {
      console.warn('loadMyHelps fail', e);
    }
    wx.hideLoading();
  },

  onCloseHelpItem(e) {
    const helpId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '关闭招募',
      content: '关闭后这条互助不再展示，确定？',
      success: async (r) => {
        if (!r.confirm) return;
        const res = await wx.cloud.callFunction({
          name: 'raceHelp', data: { action: 'close', helpId },
        }).then(x => (x && x.result) || {}).catch(() => ({}));
        if (!res.success) return wx.showToast({ title: res.error || '操作失败', icon: 'none' });
        wx.showToast({ title: '已关闭', icon: 'success' });
        this.loadMyHelps();
        this.loadHelps();
      },
    });
  },

  onCancelMyApply(e) {
    const applyId = e.currentTarget.dataset.id;
    const item = (this.data.myApplies || []).find(x => x.applyId === applyId) || {};
    const remain = item.cancelRemain || 0;
    wx.showModal({
      title: '取消应征',
      content: `本场赛事还能撤销 ${remain} 次。取消后对方不再看到你的微信号，用完就不能再应征这场赛事的互助了。确定取消？`,
      success: async (r) => {
        if (!r.confirm) return;
        const res = await wx.cloud.callFunction({
          name: 'raceHelp', data: { action: 'cancelApply', applyId },
        }).then(x => (x && x.result) || {}).catch(() => ({}));
        if (!res.success) return wx.showToast({ title: res.error || '操作失败', icon: 'none' });
        const left = res.remain || 0;
        wx.showToast({
          title: left > 0 ? `已取消，本场还可撤销 ${left} 次` : '已取消，本场不能再应征了',
          icon: 'none', duration: 2500,
        });
        this.loadMyHelps();
      },
    });
  },

  onCopyContact(e) {
    const v = e.currentTarget.dataset.v;
    if (!v) return;
    wx.setClipboardData({ data: String(v) });
  },

  onCancelResult() { this.setData({ showResultModal: false }); },
  onPickResultTime() { this.setData({ showResultTimePicker: true }); },
  onResultTimeChange(e) { this.setData({ resultInput: e.detail.value, showResultTimePicker: false }); },
  onHideResultTime() { this.setData({ showResultTimePicker: false }); },

  async onConfirmResult() {
    const { eventId, event, resultInput, resultRaceType } = this.data;
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return wx.navigateTo({ url: '/pages/login/login' });

    // 验证成绩格式 H:MM:SS
    if (!resultInput || !/^\d{1,2}:\d{2}:\d{2}$/.test(resultInput.trim())) {
      return wx.showToast({ title: '请输入有效成绩（H:MM:SS）', icon: 'none' });
    }

    wx.showLoading({ title: '保存中' });
    try {
      const userId = userInfo._id;
      const resultTime = resultInput.trim();

      // 标记赛事（传 raceType 与列表页保持一致）
      await raceUtil.markEvent(userId, eventId, 'finished', false, resultRaceType);

      // 检查是否已同步过跑马记录（与列表页一致）
      const db = require('../../../utils/db').db;
      const eventDate = this.fmtDate(event.date);
      const existRecord = await db.collection('race_records').where({
        userId,
        city: event.name || ''
      }).get();

      if (existRecord.data.length === 0) {
        const recordData = {
          userId,
          raceType: resultRaceType,
          raceLevel: event.raceLevel || 'B',
          status: 'finished',
          date: eventDate,
          city: event.name || '',
          result: resultTime,
          isPublic: true,
          images: [],
          createTime: new Date(),
        };
        const addRes = await db.collection('race_records').add({ data: recordData });

        // 更新 marker 关联 recordId
        const mkRes = await db.collection('race_markers').where({ userId, eventId }).get();
        if (mkRes.data.length > 0) {
          await db.collection('race_markers').doc(mkRes.data[0]._id).update({
            data: { recordId: addRes._id }
          });
        }

        // 检查 PB
        const pbChanged = await this.checkPB(resultRaceType, resultTime, userInfo);
        if (pbChanged) { cache.invalidate('members_v2'); cache.invalidate('users_v2'); }
        // 新增了跑马记录，让跑马记录缓存失效
        cache.invalidate('records');
      }

      wx.hideLoading();
      wx.showToast({ title: '已关注并记录成绩', icon: 'success' });
      this.setData({ showResultModal: false, myStatus: 'finished', isMine: true });
      cache.invalidate('calendar'); // 列表缓存失效，返回后重新查库
      this.loadEvent();
    } catch (err) {
      wx.hideLoading();
      console.error('标记完赛失败:', err);
      wx.showToast({ title: '关注失败: ' + (err.message || err.errMsg || '未知'), icon: 'none', duration: 3000 });
    }
  },

  async checkPB(type, result, userInfo) {
    const dbUtil = require('../../../utils/db');
    const fields = { '10k': 'pb10k', half: 'pbHalf', full: 'pbFull' };
    const field = fields[type];
    if (!field) return false;
    const current = userInfo[field];
    const toSec = (t) => { const p = (t||'').split(':'); return +p[0]*3600 + +p[1]*60 + +(p[2]||0); };
    const newSec = toSec(result);
    if (!current || newSec < toSec(current)) {
      await dbUtil.updateUser(userInfo._id, { [field]: result });
      userInfo[field] = result;
      wx.setStorageSync('userInfo', userInfo);
      wx.showToast({ title: '🏆 新PB！', icon: 'success', duration: 2000 });
      return true;
    }
    return false;
  },

  onScoreDetail() {
    wx.navigateTo({ url: `/pages/tools/calendar/review-list?id=${this.data.eventId}&name=${this.data.event.name}` });
  },

  async onDelMyReview(e) {
    const id = e.currentTarget.dataset.id;
    const reviewPoints = await pointsUtil.getRulePoints('赛事评分奖励');
    wx.showModal({ title: '删除评价', content: reviewPoints > 0 ? '将同时扣除' + reviewPoints + '积分，之后重新评价可再次获得积分' : '删除评价后，重新评价将不再获得积分', confirmColor: '#ff4d4f', success: async (res) => {
      if (!res.confirm) return;
      const db = require('../../../utils/db').db;
      const userInfo = wx.getStorageSync('userInfo');
      const review = await db.collection('race_reviews').doc(id).get();

      // 删除评价
      await db.collection('race_reviews').doc(id).remove();

      // 扣减积分
      if (userInfo && review.data && reviewPoints > 0) {
        const pointsUtil = require('../../../utils/points');
        await pointsUtil.addRecord({
          userId: userInfo._id,
          type: 'use',
          category: '消耗',
          points: -reviewPoints,
          description: `删除"${this.data.event.name}"赛事评价，扣减${reviewPoints}积分`,
          images: [],
          earnDate: new Date(),
          expireDate: null,
          status: 'approved',
        });
        // 更新用户积分余额
        const balance = await pointsUtil.getBalance(userInfo._id);
        await db.collection('users').doc(userInfo._id).update({ data: { points: balance } });
      }

      // 更新赛事评分统计
      const raceUtil = require('../../../utils/raceEvents');
      const stats = await raceUtil.getReviewStats(this.data.eventId);
      const tagStats = {};
      Object.keys(stats.tagStats).forEach(k => { tagStats[k] = stats.tagStats[k]; });
      await db.collection('race_events').doc(this.data.eventId).update({
        data: { avgScore: stats.avgScore, reviewCount: stats.count, tagStats }
      });

      wx.showToast({ title: reviewPoints > 0 ? '已删除，-' + reviewPoints + '积分' : '已删除', icon: 'success' });
      this.setData({ myReview: null, myStatus: '', isMine: false });
      this.loadEvent();
    }});
  },

});
