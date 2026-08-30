// pages/tools/calendar/index.js - 赛事日历
const raceUtil = require('../../../utils/raceEvents');
const shareUtil = require('../../../utils/share');
const cache = require('../../../utils/cache');

Page({
  data: {
    tab: 'mine',          // all | mine | review
    races: [],
    allRaces: [],
    allTags: [],           // 所有可用标签
    // 标记/评价状态由云函数 getRaceEvents 返回（不再需要客户端额外请求）
    sortBy: 'hot',         // hot(热度) | date | score | difficulty | atmosphere | supply | transport | scenery | org | medal | value
    sortAsc: true,   // 默认时间从近到远
    tagFilter: '',
    raceTypeFilter: '',   // 类型筛选
    raceLevelFilter: '',  // 等级筛选
    raceLabelFilter: '',  // 标牌筛选
    searchKey: '',
    showForm: false,
    markingEventId: '',
    markingEventName: '',
    markingEvent: null,      // 完整赛事信息
    selectedStatus: 'planned',
    markRaceType: 'full',     // 混合赛事选择的项目
    hours: ['0','1','2','3','4','5','6','7','8','9','10'],
    minutes: Array.from({length:60},(_,i)=>String(i).padStart(2,'0')),
    seconds: Array.from({length:60},(_,i)=>String(i).padStart(2,'0')),
    raceHIdx: 3, raceMIdx: 30, raceSIdx: 0,
    notifyEnabled: false,     // 倒计时通知开关
    // 时间范围
    dateFrom: '',
    dateTo: '',
    dateRangeText: '',
    monthSel: 0,           // 0=默认(当月~年底) | 1-12=指定月
    yearSel: new Date().getFullYear(),  // 年份筛选（默认今年）
    _dateSet: false,       // 用户是否手动设置了时间范围
    _loaded: false,        // 是否已按 tab 设置过默认排序
    page: 0,
    pageSize: 20,
    hasMore: false,
  },

  onLoad() {
    shareUtil.enableShareMenu();
    // 恢复上次的 tab
    const saved = wx.getStorageSync('calendar_tab');
    if (saved) this.setData({ tab: saved });
  },

  onShareAppMessage() {
    return shareUtil.buildShare({
      title: '九州战马赛事日历｜查赛事、看评分、关注比赛',
      path: '/pages/tools/calendar/index',
    });
  },

  onShareTimeline() {
    return shareUtil.buildTimeline({ title: '九州战马赛事日历｜查赛事、看评分、关注比赛' });
  },

  onShow() {
    // 首次进入按 tab 设置默认排序（所有赛事=热度，我的赛事/评价=日期），返回时保留用户选择
    if (!this.data._loaded) {
      const t = this.data.tab || 'all';
      const sb = t === 'all' ? 'hot' : 'date';
      this.setData({ sortBy: sb, sortAsc: sb === 'date', _loaded: true });
    }
    if (!this.data._dateSet) this.setDefaultDates();
    // 标记/评价等数据变更会 invalidate('calendar')：版本变化才重新查库，否则直接用内存数据，不再查库
    const ver = cache.getVer('calendar');
    if (ver !== this._calVer) {
      this._calVer = ver;
      this._viewCache = {};
      this.loadData(false, this.data.races.length > 0);
    } else if (!this.data.races.length) {
      this.loadData(false);
    }
  },

  onHide() {
    wx.setStorageSync('calendar_tab', this.data.tab);
  },

  onLoadMore() {
    if (!this.data.hasMore) return;
    this.setData({ page: this.data.page + 1 }, () => this.loadData(true));
  },

  setDefaultDates() {
    const today = new Date();
    const pad = n => String(n).padStart(2, "0");
    const fmt = d => d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate());
    // 默认：所选年份 1 月 ~ 12 月（默认今年，可切年）
    const year = this.data.yearSel || today.getFullYear();
    const from = new Date(year, 0, 1);
    const to = new Date(year, 11, 31);
    this.setData({
      monthSel: 0,
      dateFrom: fmt(from),
      dateTo: fmt(to),
      dateRangeText: year + "年",
    });
  },

  // 月份选择：0=默认(当月~年底)，1-12=指定月
  onMonthSel(e) {
    const m = parseInt(e.currentTarget.dataset.m, 10);
    if (m === 0) { this.setDefaultDates(); this.loadData(); return; }
    const year = this.data.yearSel || new Date().getFullYear();
    const pad = n => String(n).padStart(2, "0");
    const fmt = d => d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate());
    const from = new Date(year, m - 1, 1);
    const to = new Date(year, m, 0); // 该月最后一天
    this.setData({
      monthSel: m,
      dateFrom: fmt(from),
      dateTo: fmt(to),
      dateRangeText: year + "年" + m + "月",
      _dateSet: true,
    });
    this.loadData();
  },

  // 年份切换
  onYearPrev() { this.setData({ yearSel: (this.data.yearSel || new Date().getFullYear()) - 1 }, () => { this.setDefaultDates(); this.loadData(); }); },
  onYearNext() { this.setData({ yearSel: (this.data.yearSel || new Date().getFullYear()) + 1 }, () => { this.setDefaultDates(); this.loadData(); }); },
  async loadData(isLoadMore = false, silent = false, force = false) {
    // 切 tab / 返回页面：同一查询条件且未强制刷新时，直接用内存缓存，不再查库
    if (!isLoadMore && !force) {
      const ck = this.viewCacheKey();
      const st = this._viewCache && this._viewCache[ck];
      if (st) {
        this.setData({ allRaces: st.allRaces, allTags: st.allTags || [], page: st.page || 0, total: st.total || 0, hasMore: st.hasMore || false });
        this.applyFilter();
        return;
      }
    }
    if (!isLoadMore && !silent) {
      this.setData({ page: 0, allRaces: [], races: [], hasMore: false });
    }
    if (!silent) wx.showLoading({ title: '加载中' });
    try {
      const userInfo = wx.getStorageSync('userInfo');
      const userId = userInfo ? (userInfo._id || userInfo.openid) : null;

      // 我的赛事：一次取完今年全部（不分页），其他 tab 保持分页
      const limit = this.data.tab === 'mine' ? 1000 : this.data.pageSize;
      const skip = this.data.page * this.data.pageSize;
      const res = await raceUtil.getAll({
        skip, limit,
        search: this.data.searchKey,
        dateFrom: this.data.dateFrom,
        dateTo: this.data.dateTo,
        raceType: this.data.tab === 'review' ? '' : this.data.raceTypeFilter,
        raceLevel: this.data.tab === 'review' ? '' : this.data.raceLevelFilter,
        raceLabel: this.data.tab === 'review' ? '' : this.data.raceLabelFilter,
        userId,
        sortBy: this.data.sortBy,
      });
      const all = res.list;
      if (all.length === 0 && !isLoadMore) {
        if (!silent) wx.hideLoading();
        this._viewCache = this._viewCache || {};
        this._viewCache[this.viewCacheKey()] = { allRaces: [], allTags: [], page: 0, total: 0, hasMore: false };
        this.setData({ races: [], allRaces: [], allTags: [], total: 0, hasMore: false });
        return;
      }

      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const from = new Date(this.data.dateFrom);
      const to = new Date(this.data.dateTo);
      this.setData({ dateRangeText: `${fmt(from)} ~ ${fmt(to)}`, total: res.total || 0, hasMore: this.data.tab === 'mine' ? false : (res.hasMore || false) });

      // 加载更多时追加；非加载更多：第一页整体替换（避免重复），已翻页的静默刷新按追加处理（避免丢页）
      let races = (isLoadMore || this.data.page > 0) ? [...this.data.allRaces, ...all] : [...all];
      // 按 _id 去重（保留最新数据），防止静默刷新/重复请求导致同一赛事出现多次
      const seenIds = new Set();
      races = races.reverse().filter(r => {
        if (!r._id) return true;
        if (seenIds.has(r._id)) return false;
        seenIds.add(r._id);
        return true;
      }).reverse();

      const tagSet = new Set();
      races.forEach(r => (r.tags || []).forEach(t => tagSet.add(t)));
      const allTags = [...tagSet];

      // 标记/评价状态已由云函数批量返回（myMarkInfo / hasReviewed）

      // 兼容旧标签名
      races.forEach(r => {
        if (r.timeline) {
          const labelMap = { '开启报名': '报名开启', '截止报名': '报名截止', '截止退费': '退费截止', '缴费截止时间': '缴费截止', '举办日期': '鸣枪开跑' };
          r.timeline = r.timeline.map(t => ({ ...t, label: labelMap[t.label] || t.label }));
        }
      });

      const now = new Date();
      races = races.map(r => ({
        ...r,
        raceTypeName: (r.raceTypes || [r.raceType || 'full']).map(t => ({ full: '全马', half: '半马', '10k': '10K' }[t] || t)).join('·'),
        countdown: this.calcCountdown(r.date, r.timeline, r.gunTimes),
        _nearestMs: this.getNearestMs(r, now),
        isMine: r.isMarked || false,
        myStatus: r.myStatus || '',
        myNotify: r.myNotify || false,
        regNotOpen: this.isRegNotOpen(r.timeline),  // 报名未开启
        // 列表卡片：单赛事统计；详情页：赛事组统计
        avgScore: r.avgScore || 0,
        reviewCount: r.reviewCount || 0,
        markerCount: r.markerCount || 0,
        dimensions: r.reviewStats ? r.reviewStats.dimensions : {},
        hasReviewed: r.hasReviewed || false,
      }));

      // 只有查库成功才更新内存缓存
      this._viewCache = this._viewCache || {};
      this._viewCache[this.viewCacheKey()] = {
        allRaces: races,
        allTags,
        page: this.data.page,
        total: res.total || 0,
        hasMore: this.data.tab === 'mine' ? false : (res.hasMore || false),
      };
      this.setData({ allRaces: races, allTags });
      this.applyFilter();
      if (!silent) wx.hideLoading();
    } catch (err) {
      if (!silent) wx.hideLoading();
    }
  },

  viewCacheKey() {
    const d = this.data;
    return [d.tab, d.dateFrom, d.dateTo, d.searchKey, d.raceTypeFilter, d.raceLevelFilter, d.raceLabelFilter, d.sortBy].join('|');
  },

  getNearestMs(r, now) {
    let min = Infinity;
    if (r.gunTimes && r.gunTimes.length) {
      r.gunTimes.forEach(g => {
        if (!g.time) return;
        const [h, m] = g.time.split(':').map(Number);
        const d = r.date ? new Date(r.date) : new Date();
        d.setHours(h || 0, m || 0, 0, 0);
        const diff = d - now;
        if (diff >= 0 && diff < min) min = diff;
      });
    }
    if (r.timeline && r.timeline.length) {
      r.timeline.forEach(t => {
        if (!t.date) return;
        const d = new Date(t.date);
        if (isNaN(d.getTime())) return;
        if (t.time) { const [h, m] = t.time.split(':').map(Number); d.setHours(h || 0, m || 0, 0, 0); }
        else d.setHours(0, 0, 0, 0);
        const diff = d - now;
        if (diff >= 0 && diff < min) min = diff;
      });
    }
    return min;
  },

  isRegNotOpen(timeline) {
    if (!timeline || !timeline.length) return false;
    const regOpen = timeline.find(t => t.label === '报名开启');
    if (!regOpen || !regOpen.date) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(regOpen.date);
    d.setHours(0, 0, 0, 0);
    return d > today;
  },

  calcCountdown(dateStr, timeline, gunTimes) {
    const now = new Date();
    const toDate = (v) => v instanceof Date ? v : new Date(v);

    // 找最早发枪时间（用于时间轴节点补充和兜底）
    let firstGun = null;
    if (gunTimes && gunTimes.length) {
      gunTimes.forEach(g => {
        if (!g.time) return;
        const rd = dateStr ? toDate(dateStr) : new Date();
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
        // 鸣枪开跑用最早发枪时间
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
    // 没有时间轴但有发枪时间
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

    // 兜底：用赛事日期
    if (!dateStr) return '';
    const rd = toDate(dateStr);
    if (isNaN(rd.getTime())) return '';
    const diffMs = rd - now;
    if (diffMs > 0) { const d2 = Math.ceil(diffMs / 86400000); return `距鸣枪开跑 ${d2} 天`; }
    if (Math.abs(diffMs) < 86400000) return '今天鸣枪开跑';
    return `已举办 ${Math.ceil(Math.abs(diffMs) / 86400000)} 天`;
  },

  applyFilter() {
    let races = [...this.data.allRaces];
    if (this.data.tab === 'mine') races = races.filter(r => r.isMine);
    if (this.data.tab === 'review') races = races.filter(r => r.hasReviewed);
    if (this.data.searchKey) races = races.filter(r => (r.name||'').toLowerCase().includes(this.data.searchKey.toLowerCase()) || (r.city||'').toLowerCase().includes(this.data.searchKey.toLowerCase()));
    if (this.data.tagFilter) races = races.filter(r => (r.tags || []).includes(this.data.tagFilter));
    if (this.data.raceTypeFilter) races = races.filter(r => (r.raceTypes || [r.raceType]).includes(this.data.raceTypeFilter));
    if (this.data.raceLevelFilter) races = races.filter(r => r.raceLevel === this.data.raceLevelFilter);
    if (this.data.raceLabelFilter) races = races.filter(r => r.label === this.data.raceLabelFilter);
    const sb = this.data.sortBy;
    const asc = this.data.sortAsc;
    const dimKeys = ['difficulty','atmosphere','supply','transport','scenery','org','medal','value'];
    if (sb === 'hot') { races.sort((a, b) => asc ? (a.markerCount || 0) - (b.markerCount || 0) : (b.markerCount || 0) - (a.markerCount || 0)); }
    else if (sb === 'date') { races.sort((a, b) => asc ? (a._nearestMs || Infinity) - (b._nearestMs || Infinity) : (b._nearestMs || Infinity) - (a._nearestMs || Infinity)); }
    else if (sb === 'score') { races.sort((a, b) => asc ? (a.avgScore || 0) - (b.avgScore || 0) : (b.avgScore || 0) - (a.avgScore || 0)); }
    else if (dimKeys.includes(sb)) { races.sort((a, b) => asc ? ((a.dimensions||{})[sb] || 0) - ((b.dimensions||{})[sb] || 0) : ((b.dimensions||{})[sb] || 0) - ((a.dimensions||{})[sb] || 0)); }
    this.setData({ races });
  },

  onTab(e) {
    const t = e.currentTarget.dataset.t;
    // 所有赛事默认按热度，我的赛事/评价默认按日期
    const sb = t === 'all' ? 'hot' : 'date';
    this.setData({ tab: t, sortBy: sb, sortAsc: sb === 'date', _dateSet: false });
    wx.setStorageSync('calendar_tab', t);
    this.setDefaultDates();
    this.loadData();
  },

  onSort(e) {
    const v = e.currentTarget.dataset.v;
    if (this.data.sortBy === v) {
      this.setData({ sortAsc: !this.data.sortAsc });
    } else {
      this.setData({ sortBy: v, sortAsc: v === 'date' ? true : false });
    }
    this.applyFilter();
  },

  onTagFilter(e) {
    const tag = e.currentTarget.dataset.tag;
    this.setData({ tagFilter: this.data.tagFilter === tag ? '' : tag });
    this.applyFilter();
  },

  onRaceTypeFilter(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ raceTypeFilter: this.data.raceTypeFilter === v ? '' : v });
    this.applyFilter();
  },
  onRaceLevelFilter(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ raceLevelFilter: this.data.raceLevelFilter === v ? '' : v });
    this.applyFilter();
  },
  onRaceLabelFilter(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ raceLabelFilter: this.data.raceLabelFilter === v ? '' : v });
    this.applyFilter();
  },

  onSearch(e) {
    this.setData({ searchKey: e.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.applyFilter(), 300);
  },

  onDateFrom(e) { this.setData({ dateFrom: e.detail.value, _dateSet: true }); this.loadData(); },
  onDateTo(e) { this.setData({ dateTo: e.detail.value, _dateSet: true }); this.loadData(); },

  // 记录开销：跳转记账页并自动选中该赛事
  onRecordExpense(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '';
    wx.navigateTo({ url: `/pages/tools/ledger/add?eventId=${id}&eventName=${encodeURIComponent(name)}` });
  },

  onShowMark(e) {
    const id = e.currentTarget.dataset.id;
    const event = this.data.allRaces.find(r => r._id === id) || {};
    const existingMarker = event.myMarkInfo || null;
    // 根据赛事类型设完赛时间默认值
    const primaryType = (event.raceTypes || [event.raceType || 'full'])[0];
    const defaults = { full: { h: 3, m: 30, s: 0 }, half: { h: 2, m: 0, s: 0 }, '10k': { h: 0, m: 50, s: 0 } };
    const d = defaults[primaryType] || defaults.full;
    this.setData({
      showForm: true, markingEventId: id, markingEventName: event.name || '',
      markingEvent: event,
      markRaceType: (event.raceTypes || ['full'])[0] || 'full',
      selectedStatus: event.myStatus || 'planned',
      raceHIdx: d.h, raceMIdx: d.m, raceSIdx: d.s,
      notifyEnabled: existingMarker ? existingMarker.notifyEnabled || false : false,
    });
  },

  async onMark() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return wx.navigateTo({ url: '/pages/login/login' });
    const { markingEventId, selectedStatus, markingEvent, notifyEnabled, hours, minutes, seconds, raceHIdx, raceMIdx, raceSIdx } = this.data;
    const raceResult = `${hours[raceHIdx]}:${minutes[raceMIdx]}:${seconds[raceSIdx]}`;
    // 开启通知时申请订阅消息授权
    if (notifyEnabled) {
      try {
        await wx.requestSubscribeMessage({ tmplIds: ['xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew'] });
      } catch {}
    }
    wx.showLoading({ title: '保存中' });
    try {
      await raceUtil.markEvent(userInfo._id, markingEventId, selectedStatus, notifyEnabled, this.data.markRaceType);

      // 如果标记为已完赛且有成绩，同步到跑马记录
      if (selectedStatus === 'finished' && raceResult && markingEvent) {
        const db = require('../../../utils/db').db;
        const eventDate = markingEvent.fmtDate || this.fmtDateStr(markingEvent.date);

        // 检查是否已同步过
        const existRecord = await db.collection('race_records').where({
          userId: userInfo._id,
          city: markingEvent.name
        }).get();

        if (existRecord.data.length === 0) {
          const recordData = {
            userId: userInfo._id,
            raceType: markingEvent.raceType || 'full',
            raceLevel: markingEvent.raceLevel || 'B',
            status: 'finished',
            date: eventDate,
            city: markingEvent.name,
            result: raceResult,
            distance: markingEvent.distance || '',
            elevation: markingEvent.elevation || '',
            isPublic: true,
            images: [],
            createTime: new Date(),
          };
          const addRes = await db.collection('race_records').add({ data: recordData });

          // 更新 marker 的 recordId
          const mkRes = await db.collection('race_markers').where({
            userId: userInfo._id, eventId: markingEventId
          }).get();
          if (mkRes.data.length > 0) {
            await db.collection('race_markers').doc(mkRes.data[0]._id).update({
              data: { recordId: addRes._id }
            });
          }

          // 检查 PB
          const pbChanged = await this.checkPB(markingEvent.raceType, raceResult, userInfo);
          if (pbChanged) { cache.invalidate('members_v2'); cache.invalidate('users_v2'); }
          // 新增了跑马记录，让跑马记录缓存失效
          cache.invalidate('records');
        }
      }

      wx.hideLoading();
      wx.showToast({ title: '已关注', icon: 'success' });
      this.setData({ showForm: false });
      // 标记会改变标记状态/标记数：失效缓存并强制查库
      cache.invalidate('calendar');
      this._calVer = cache.getVer('calendar');
      this._viewCache = {};
      this.loadData(false, false, true);
    } catch (err) {
      wx.hideLoading();
      console.error('标记失败:', err);
      wx.showToast({ title: '保存失败: ' + (err.message || err.errMsg || '未知'), icon: 'none', duration: 3000 });
    }
  },

  fmtDateStr(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
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

  async onUnmark() {
    const userInfo = wx.getStorageSync('userInfo');
    const id = this.data.markingEventId;
    await raceUtil.unmarkEvent(userInfo._id, id);
    wx.showToast({ title: '已取消关注', icon: 'success' });
    this.setData({ showForm: false });
    // 取消标记会改变标记状态/标记数：失效缓存并强制查库
    cache.invalidate('calendar');
    this._calVer = cache.getVer('calendar');
    this._viewCache = {};
    this.loadData(false, false, true);
  },

  onHideForm() { this.setData({ showForm: false }); },

  onStatusSel(e) { this.setData({ selectedStatus: e.currentTarget.dataset.v }); },
  onMarkRaceType(e) { this.setData({ markRaceType: e.currentTarget.dataset.v }); },

  onNotifyToggle(e) { this.setData({ notifyEnabled: e.detail.value }); },

  onResultPick(e) {
    const { field } = e.currentTarget.dataset;
    const val = e.detail.value;
    if (field === 'h') this.setData({ raceHIdx: val });
    else if (field === 'm') this.setData({ raceMIdx: val });
    else if (field === 's') this.setData({ raceSIdx: val });
  },

  onResultInput(e) { this.setData({ raceResult: e.detail.value }); },

  onRaceDetail(e) {
    wx.navigateTo({ url: `/pages/tools/calendar/detail?id=${e.currentTarget.dataset.id}` });
  },
});
