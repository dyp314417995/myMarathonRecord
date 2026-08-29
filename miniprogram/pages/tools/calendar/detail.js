// pages/tools/calendar/detail.js - 赛事详情
const raceUtil = require('../../../utils/raceEvents');
const shareUtil = require('../../../utils/share');
const cache = require('../../../utils/cache');

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
        raceGroup: event.raceGroup || '',
        reviewStats: stats,
        topTags: tagEntries,
        isMine, myStatus, myReview,
        myReviewTags: myReview ? (myReview.tags || []).join('、') : '',
        'myReview.myAvg': myReview && myReview.scores ? Math.round((myReview.scores.difficulty + myReview.scores.atmosphere + myReview.scores.supply + myReview.scores.transport) / 0.4) / 10 : 0,
      });
      if (!silent) wx.hideLoading();
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
      title: this.data._shareTitle || `快来看看「${name}」马拉松`,
      path: `/pages/tools/calendar/detail?id=${this.data.eventId}`,
      imageUrl: event.poster || '',
    });
  },

  onShareTimeline() {
    const { event } = this.data;
    const name = event.name || '这赛事';
    return shareUtil.buildTimeline({
      title: this.data._shareTitle || `快来看看「${name}」马拉松`,
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
        if (pbChanged) { cache.invalidate('members'); cache.invalidate('users'); }
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
