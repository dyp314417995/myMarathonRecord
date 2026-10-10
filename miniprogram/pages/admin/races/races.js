// pages/admin/races/races.js - 赛事管理（v2.7：加省份/二维码、二维码筛选）
const raceUtil = require('../../../utils/raceEvents');
const cityData = require('../../../utils/city-data');
const { canonProvince, expandProvinceList } = require('../../../utils/province');
const ALL_PROVINCES = cityData.map(p => p.name);

Page({
  data: {
    isAdmin: false,
    isSuperAdmin: false,
    role: '',
    userId: '',
    adminProvinces: [],         // 当前管理员负责的省份（空数组=全国）
    raceList: [],
    allRaceList: [],            // 未筛选的完整列表
    adminSearch: '', adminType: '', adminLevel: '', adminLabel: '', adminRegStatus: '',
    adminYearSel: new Date().getFullYear(),
    adminMonthSel: 0,
    // 二维码筛选
    qrScope: 'all',             // all | my | missing | expired
  qrIssueMissing: 0,          // 待处理统计：缺二维码数（qrScope=all 时计算）
  qrIssueExpired: 0,          // 待处理统计：过期二维码数
    provinceScope: 'my',        // my 仅看我负责的；all 全部
    showQR: false, qrFileID: '', sharingRaceName: '', sharingRaceInfo: {},
    showQRText: true,
    nameDupStatus: '',
    showPoster: false, posterIdx: 0, posterPreviewUrl: '',
    typeFull: true, typeHalf: false, type10k: false,
    showForm: false,
    gunTimes: [{ zone: 'A', time: '07:00', zoneIdx: 0 }],
    zoneOptions: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
    editingId: '',
    form: { name: '', raceGroup: '', date: '', province: '', city: '', raceTypes: ['full'], raceLevel: 'A', label: '', scale: '', subScale: '', fee: '', organizer: '', operator: '', contactPhone: '', contactEmail: '', wechatAccount: '', website: '', mechanism: '抽签', payment: '报名时缴费', signupChannels: '', medicalReport: '', finishRequirement: '', refundRule: '', startPoint: '', medalImage: '', routeMap: '', regStatus: '', posters: [], timeline: [], qrCode: '', qrCodeUpdatedAt: null },
    posterTemp: [],
    showPaste: false,
    pasteText: '',
    parsing: false,
    showReviews: false,
    reviewEventId: '',
    reviewEventName: '',
    reviewList: [],
    // 省份 / 二维码
    allProvinces: ALL_PROVINCES,
    showProvincePicker: false,
    provinceSearchKey: '',
    provincePickerItems: ALL_PROVINCES,
    formQrUrl: '',         // 表单中二维码预览 URL
    formQrUpdatedAtText: '', // 当前表单中二维码的上传时间（精确到天，不强制展示）
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

  async onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    const role = userInfo.role || 'user';
    const userId = userInfo._id || '';
    // 默认 provinceScope：根据角色决定
    const provinceScope = role === 'super_admin' ? 'all' : 'my';
    this.setData({
      isAdmin: role === 'super_admin' || role === 'admin',
      isSuperAdmin: role === 'super_admin',
      role, userId,
      tab: 'races', adminPage: 0, adminHasMore: true, allRaceList: [], raceList: [],
      qrScope: 'all',
      provinceScope,
    });
    if (this.data.isAdmin) {
      // 获取管理员负责省份
      const provinces = await this.fetchAdminProvinces(userId, role);
      // 拉所有 active 管理员（按 province 分组），用于赛事列表"负责人"派生展示
      const { map, nameMap } = await this.fetchProvinceAdminMap();
      this.setData({ adminProvinces: provinces, provinceAdminMap: map, adminNameMap: nameMap });
      this.loadRaces();
      // 订阅消息点击直达赛事编辑（仅处理一次）
      this.handlePendingEdit();
    }
  },

  onLoad(options) {
    // 订阅消息携带 editEventId（兼容旧的 id 参数）：记录后由 onShow 处理
    this._pendingEditId = (options && (options.editEventId || options.id)) || '';
    // 订阅消息携带 qrScope：进入页面自动套二维码筛选（汇总通知点击进入用）
    const qs = options && options.qrScope;
    if (qs === 'missing' || qs === 'expired') this.setData({ qrScope: qs });
  },

  // 取当前用户的负责省份：超管=全国[]；普通管理员=admins 表对应行的 provinces
  async fetchAdminProvinces(userId, role) {
    if (role === 'super_admin') return []; // 空=全国
    if (!userId) return [];
    try {
      const dbUtil = require('../../../utils/db');
      const res = await dbUtil.db.collection('admins')
        .where({ userId, status: 'active' })
        .orderBy('createTime', 'desc').limit(1).get();
      const a = res.data && res.data[0];
      if (!a) return [];
      return Array.isArray(a.provinces) ? a.provinces : [];
    } catch (e) { console.warn('fetchAdminProvinces failed', e); return []; }
  },

  // 取所有 active 管理员：返回 { province -> [{userId, userName}], '全国' -> [...] }
  // 用于赛事列表/详情按 province 自动带出负责人
  async fetchProvinceAdminMap() {
    try {
      const dbUtil = require('../../../utils/db');
      const now = new Date();
      const _ = dbUtil._;
      // 1. 拉所有 active 管理员
      const adminRes = await dbUtil.db.collection('admins').where({
        status: 'active',
        validFrom: _.lte(now),
        validTo: _.gte(now),
      }).get();
      const admins = adminRes.data || [];
      if (!admins.length) return { map: {}, nameMap: {} };

      // 2. 批量查 user 信息（nickName）
      const userIds = [...new Set(admins.map(a => a.userId).filter(Boolean))];
      const nameMap = {};
      // 分批查（每批 20）
      for (let i = 0; i < userIds.length; i += 20) {
        const part = userIds.slice(i, i + 20);
        try {
          const q = await dbUtil.db.collection('users').where({ _id: _.in(part) }).field({ nickName: true }).get();
          (q.data || []).forEach(u => { nameMap[u._id] = u.nickName || '管理员'; });
        } catch {}
      }

      // 3. 按 province 分组
      const map = {};
      admins.forEach(a => {
        const provinces = Array.isArray(a.provinces) ? a.provinces : [];
        const entry = { userId: a.userId, userName: nameMap[a.userId] || '管理员' };
        if (provinces.length === 0) {
          // provinces=[] 视为负责全国
          if (!map['__all__']) map['__all__'] = [];
          map['__all__'].push(entry);
        } else {
          provinces.forEach(p => {
            // 归一化为简称作 key（管理员存"吉林省"，赛事 province 是"吉林"）
            const key = canonProvince(p);
            if (!map[key]) map[key] = [];
            map[key].push(entry);
          });
        }
      });
      // 兜底：未匹配的省自动继承"全国"组
      map['__all__'] = map['__all__'] || [];
      return { map, nameMap };
    } catch (e) {
      console.warn('fetchProvinceAdminMap failed', e);
      return { map: {}, nameMap: {} };
    }
  },

  // 从 map 中取赛事负责人（按 province，归一化简称匹配）
  resolveOwners(province, map) {
    if (!map) return [];
    const direct = (map[canonProvince(province)] || []);
    if (direct.length) return direct;
    // 兜底：省未匹配时用"全国"组
    return map['__all__'] || [];
  },

  async loadRaces() {
    const { userId, adminProvinces, provinceScope } = this.data;
    const skip = this.data.adminPage * 20;
    const search = this.data.adminSearch || '';
    const dateRange = this.calcAdminDateRange();
    const params = {
      skip, limit: 20,
      userId,
      search: search || undefined,
      publishFilter: 'all',
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      // 报名状态改为云端过滤（v2.7）：分页数据下客户端过滤会漏掉未加载的页
      regStatus: this.data.adminRegStatus || undefined,
    };
    // 我负责的省份：传入 adminProvinces（仅 provinceScope==='my' 时）；否则传空数组=全国
    // 注意归一化：admins 存全称（吉林省），race_events.province 存简称（吉林），展开成两种写法再查询
    if (provinceScope === 'my') params.adminProvinces = expandProvinceList(adminProvinces);
    else params.adminProvinces = []; // 全选
    // 二维码筛选
    if (this.data.qrScope === 'missing') params.qrFilter = 'missing';
    else if (this.data.qrScope === 'expired') params.qrFilter = 'expired';
    // else all：不加过滤

    const res = await raceUtil.getAll(params);
    const all = res.list;
    all.forEach(r => {
      if (r.raceType && !r.raceTypes) r.raceTypes = [r.raceType];
      if (!r.raceTypes || !r.raceTypes.length) r.raceTypes = ['full'];
    });
    const list = all.map(r => {
      const owners = this.resolveOwners(r.province, this.data.provinceAdminMap);
      return {
        ...r,
        fmtDate: this.fmtDate(r.date),
        raceTypesStr: r.raceTypes.map(t => ({ full: '全马', half: '半马', '10k': '10K' }[t] || t)).join('/'),
        countdown: this.calcCountdown(r.date, r.status, r.timeline, r.gunTimes),
        publishStatus: r.publishStatus || 'published',
        qrStatus: this.calcQrStatus(r.qrCode, r.qrCodeUpdatedAt),
        qrStatusText: this.calcQrStatusText(r.qrCode, r.qrCodeUpdatedAt),
        responsibleAdminName: owners.length ? owners.map(o => o.userName).join('、') : '未分配',
        responsibleAdminCount: owners.length,
      };
    });
    const merged = skip === 0 ? list : [...this.data.allRaceList, ...list];
    this.setData({ allRaceList: merged, adminHasMore: res.hasMore });
    this.updateQrIssueTip(merged);
    this.applyAdminFilter();
  },

  // 待处理二维码统计（仅 qrScope=all 时 allRaceList 是全量，此时才有意义）
  updateQrIssueTip(list) {
    if (this.data.qrScope !== 'all') return;
    let missing = 0, expired = 0;
    list.forEach(r => {
      if (r.qrNotifyDisabled || r.status === 'finished') return;
      if (r.qrStatus === 'none') missing++;
      else if (r.qrStatus === 'expired') expired++;
    });
    this.setData({ qrIssueMissing: missing, qrIssueExpired: expired });
  },

  // 计算二维码状态：none / fresh(<3d) / ok(<7d) / expired(>=7d)
  calcQrStatus(qrCode, qrCodeUpdatedAt) {
    if (!qrCode || qrCode === '') return 'none';
    if (!qrCodeUpdatedAt) return 'ok';
    const ts = (qrCodeUpdatedAt instanceof Date ? qrCodeUpdatedAt : new Date(qrCodeUpdatedAt)).getTime();
    const days = (Date.now() - ts) / 86400000;
    if (days >= 7) return 'expired';
    if (days >= 3) return 'ok';
    return 'fresh';
  },
  calcQrStatusText(qrCode, qrCodeUpdatedAt) {
    if (!qrCode || qrCode === '') return '无二维码';
    if (!qrCodeUpdatedAt) return '已上传';
    const ts = (qrCodeUpdatedAt instanceof Date ? qrCodeUpdatedAt : new Date(qrCodeUpdatedAt)).getTime();
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days >= 7) return `已过期 ${days} 天`;
    if (days === 0) return '今日上传';
    return `${days} 天前上传`;
  },

  calcAdminDateRange() {
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
    const y = this.data.adminYearSel || new Date().getFullYear();
    const m = this.data.adminMonthSel;
    if (m > 0) {
      return { from: fmt(new Date(y, m-1, 1)), to: fmt(new Date(y, m, 0)) };
    }
    return { from: fmt(new Date(y, 0, 1)), to: fmt(new Date(y, 11, 31)) };
  },

  onAdminYearPrev() {
    this.setData({ adminYearSel: (this.data.adminYearSel || new Date().getFullYear()) - 1, adminPage: 0, allRaceList: [], raceList: [] }, () => this.loadRaces());
  },
  onAdminYearNext() {
    this.setData({ adminYearSel: (this.data.adminYearSel || new Date().getFullYear()) + 1, adminPage: 0, allRaceList: [], raceList: [] }, () => this.loadRaces());
  },
  onAdminMonthSel(e) {
    const m = parseInt(e.currentTarget.dataset.m, 10);
    this.setData({ adminMonthSel: this.data.adminMonthSel === m ? 0 : m, adminPage: 0, allRaceList: [], raceList: [] }, () => this.loadRaces());
  },

  onLoadMoreRaces() {
    if (!this.data.adminHasMore) return;
    this.setData({ adminPage: this.data.adminPage + 1 }, () => this.loadRaces());
  },

  applyAdminFilter() {
    let list = [...this.data.allRaceList];
    if (this.data.adminSearch) list = list.filter(r => (r.name||'').includes(this.data.adminSearch));
    if (this.data.adminType) list = list.filter(r => (r.raceTypes || [r.raceType]).includes(this.data.adminType));
    if (this.data.adminLevel) list = list.filter(r => r.raceLevel === this.data.adminLevel);
    if (this.data.adminLabel) list = list.filter(r => r.label === this.data.adminLabel);
    // regStatus 已改为云端过滤（loadRaces 传参），此处不再客户端过滤
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
    // 状态筛选在云端做，切换时需重新拉取数据
    if (field === 'regStatus') {
      this.setData({ adminPage: 0, allRaceList: [], raceList: [] }, () => this.loadRaces());
      return;
    }
    this.applyAdminFilter();
  },

  // 二维码/省份维度的过滤
  onQrScope(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ qrScope: this.data.qrScope === v ? 'all' : v, adminPage: 0, allRaceList: [], raceList: [] }, () => this.loadRaces());
  },
  onProvinceScope(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ provinceScope: this.data.provinceScope === v ? 'my' : v, adminPage: 0, allRaceList: [], raceList: [] }, () => this.loadRaces());
  },

  onRaceDetailAdmin(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/tools/calendar/detail?id=${id}` });
  },

  calcCountdown(d, status, timeline, gunTimes) {
    const now = new Date();
    const toDate = (v) => v instanceof Date ? v : new Date(v);

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
      form: { name: '', raceGroup: '', date: '', province: '', city: '', raceTypes: ['full'], raceLevel: 'A', label: '', scale: '', subScale: '', fee: '', organizer: '', operator: '', contactPhone: '', contactEmail: '', wechatAccount: '', website: '', mechanism: '抽签', payment: '报名时缴费', signupChannels: '', medicalReport: '', finishRequirement: '', refundRule: '', startPoint: '', medalImage: '', routeMap: '', regStatus: '', posters: [], timeline: [], qrCode: '', qrCodeUpdatedAt: null, qrNotifyDisabled: false },
      gunTimes: [{ zone: 'A', time: '07:00', zoneIdx: 0 }],
      zoneOptions: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
      formQrUrl: '', formQrUpdatedAtText: '',
      showProvincePicker: false, provinceSearchKey: '',
      timelineNodes: [
        { label: '报名开启', date: '', time: '12:00' }, { label: '报名截止', date: '', time: '12:00' }, { label: '退费截止', date: '', time: '12:00' },
        { label: '出签时间', date: '', time: '12:00' }, { label: '缴费截止', date: '', time: '12:00' }, { label: '候补时间', date: '', time: '12:00' },
        { label: '二抽出签', date: '', time: '12:00' }, { label: '鸣枪开跑', date: '', time: '07:00' },
      ],
    });
  },

  async onEdit(e) {
    const r = this.data.raceList.find(x => x._id === e.currentTarget.dataset.id);
    if (!r) return;
    this.openEditForm(r);
  },

  // 开启接收二维码通知：订阅消息为一次性授权（1次=1条额度），
  // 管理员点此按钮累积额度；勾选「总是保持以上选择」后不再弹窗、静默+1
  onSubscribeQrNotify() {
    wx.requestSubscribeMessage({
      tmplIds: ['mcDtCsiTEPabnEEWb317RnQT4K12zkoknB02GfQZHN4'],
      success: (r) => {
        const st = r['mcDtCsiTEPabnEEWb317RnQT4K12zkoknB02GfQZHN4'];
        if (st === 'accept') wx.showToast({ title: '已开启，接收额度+1', icon: 'success' });
        else if (st === 'reject') wx.showToast({ title: '已拒绝，无法接收通知', icon: 'none' });
        else wx.showToast({ title: '已请求订阅', icon: 'none' });
      },
      fail: (e) => {
        console.warn('requestSubscribeMessage fail', e);
        wx.showToast({ title: '订阅请求失败', icon: 'none' });
      },
    });
  },

  // 订阅消息点击直达编辑：pages/admin/races/races?editEventId=xxx（onLoad 记录，onShow 处理）
  async handlePendingEdit() {
    const id = this._pendingEditId;
    this._pendingEditId = '';
    if (!id) return;
    try {
      const res = await raceUtil.getEventDetail(id, this.data.userId);
      const r = res && res.event;
      if (!r) return wx.showToast({ title: '赛事不存在或已删除', icon: 'none' });
      this.openEditForm(r);
    } catch (e) {
      console.warn('handlePendingEdit failed', e);
    }
  },

  // 打开编辑弹窗（onEdit 与通知直达共用）
  async openEditForm(r) {
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
        node.date = '';
        node.time = '';
      }
    });
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
      // 二维码预览
      if (r.qrCode && r.qrCode.startsWith('cloud://')) {
        try {
          const ur = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: [r.qrCode] } });
          const tUrl = (ur.result || [])[0] && (ur.result || [])[0].tempFileURL;
          if (tUrl) this.setData({ formQrUrl: tUrl });
        } catch { /* ignore */ }
      } else if (r.qrCode) {
        this.setData({ formQrUrl: r.qrCode });
      }
    })();
    this.setData({
      showForm: true, editingId: r._id, nameDupStatus: '',
      typeFull: raceTypes.includes('full'), typeHalf: raceTypes.includes('half'), type10k: raceTypes.includes('10k'),
      form: { name: r.name||'', raceGroup: r.raceGroup || '', date: this.fmtDate(r.date), province: r.province||'', city: r.city||'', raceTypes, raceLevel: r.raceLevel||'', label: r.label||'', scale: r.scale||'', subScale: r.subScale||'', fee: r.fee||'', organizer: r.organizer||'', operator: r.operator||'', contactPhone: r.contactPhone||'', contactEmail: r.contactEmail||'', wechatAccount: r.wechatAccount||'', website: r.website||'', mechanism: r.mechanism||'', payment: r.payment||'', signupChannels: r.signupChannels||'', medicalReport: r.medicalReport||'', finishRequirement: r.finishRequirement||'', refundRule: r.refundRule||'', startPoint: r.startPoint||'', medalImage: r.medalImage||'', routeMap: r.routeMap||'', regStatus: r.regStatus||'', posters: initPosters, timeline: existingTimeline, qrCode: r.qrCode || '', qrCodeUpdatedAt: r.qrCodeUpdatedAt || null, qrNotifyDisabled: !!r.qrNotifyDisabled },
      gunTimes: (r.gunTimes && r.gunTimes.length) ? r.gunTimes.map((g, i) => ({ ...g, zoneIdx: i })) : [{ zone: 'A', time: '07:00', zoneIdx: 0 }],
      timelineNodes: tNodes,
      formQrUpdatedAtText: r.qrCodeUpdatedAt ? this.fmtDate(r.qrCodeUpdatedAt) : '',
      showProvincePicker: false, provinceSearchKey: '', provincePickerItems: ALL_PROVINCES,
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
      qrCode: r.qrCode || '',
      qrCodeUpdatedAt: r.qrCodeUpdatedAt || null,
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
    const reviews = res.result || [];

    const db = require('../../../utils/db').db;
    const _ = require('../../../utils/db')._;
    const userIds = [...new Set(reviews.map(r => r.userId).filter(Boolean))];
    const nameMap = {};
    for (let i = 0; i < userIds.length; i += 20) {
      const part = userIds.slice(i, i + 20);
      try {
        const q = await db.collection('users')
          .where({ _id: _.in(part) }).field({ nickName: true }).get();
        (q.data || []).forEach(u => { nameMap[u._id] = u.nickName || '未知'; });
      } catch {}
    }

    const enriched = [];
    for (const r of reviews) {
      try {
        enriched.push({
          ...r,
          userName: nameMap[r.userId] || '已删除',
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

  // ===== 二维码上传 =====
  onChooseQR() {
    const that = this;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed', 'original'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        wx.showLoading({ title: '上传中' });
        try {
          const fileID = await uploadQrFile(res.tempFilePaths[0]);
          const now = new Date();
          // 取得临时 URL 用于预览
          const urlR = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: [fileID] } });
          const tUrl = (urlR.result || [])[0] && (urlR.result || [])[0].tempFileURL;
          that.setData({
            'form.qrCode': fileID,
            'form.qrCodeUpdatedAt': now,
            formQrUrl: tUrl || fileID,
            formQrUpdatedAtText: that.fmtDate(now),
          });
          wx.hideLoading();
          wx.showToast({ title: '已更新二维码', icon: 'success' });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      },
    });
  },
  onClearQR() {
    this.setData({
      'form.qrCode': '',
      'form.qrCodeUpdatedAt': null,
      formQrUrl: '',
      formQrUpdatedAtText: '',
    });
  },
  onPreviewQR() {
    if (!this.data.formQrUrl) return;
    wx.previewImage({ urls: [this.data.formQrUrl] });
  },

  // ===== 省份选择 =====
  onShowProvincePicker() {
    this.setData({ showProvincePicker: true, provinceSearchKey: '', provincePickerItems: ALL_PROVINCES });
  },
  onHideProvincePicker() { this.setData({ showProvincePicker: false }); },
  onProvinceSearch(e) {
    const kw = (e.detail.value || '').toLowerCase().trim();
    const items = !kw ? ALL_PROVINCES : ALL_PROVINCES.filter(p => p.toLowerCase().includes(kw));
    this.setData({ provinceSearchKey: e.detail.value, provincePickerItems: items });
  },
  onPickProvince(e) {
    const { name } = e.currentTarget.dataset;
    this.setData({ 'form.province': name, showProvincePicker: false });
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

    const extractDate = (str) => {
      let m = str.match(/(\d{4})[年\-\/](\d{1,2})[月\-\/](\d{1,2})日?/);
      if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
      m = str.match(/(\d{1,2})[月\-\/](\d{1,2})日?/);
      if (m) return `${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
      return null;
    };
    const extractTime = (str) => {
      const m = str.match(/(\d{1,2})[:：](\d{2})/);
      if (m) return `${m[0].padStart(2,'0')}:${m[2]}`;
      return null;
    };

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
      if (!node || node.date) return;
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
    let nextZone = 'A';
    if (last && last.zone && /^[A-Za-z]$/.test(last.zone)) {
      const code = last.zone.toUpperCase().charCodeAt(0);
      if (code < 90) nextZone = String.fromCharCode(code + 1);
    }
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

  // 群二维码提醒开关（关闭=该赛事不再提醒缺失/过期）
  onToggleQrNotify(e) {
    this.setData({ 'form.qrNotifyDisabled': !e.detail.value });
  },

  async onSave() {
    const f = this.data.form;
    if (!f.name.trim()) return wx.showToast({ title: '请输入赛事名称', icon: 'none' });
    if (this.data.nameDupStatus === 'dup') return wx.showToast({ title: '同名赛事已存在，请修改名称', icon: 'none' });
    if (!f.date) return wx.showToast({ title: '请选择鸣枪开跑日期', icon: 'none' });
    if (!f.province || !f.province.trim()) return wx.showToast({ title: '请选择举办省份', icon: 'none' });
    const raceDate = new Date(f.date);
    if (!this.data.editingId && raceDate < new Date(new Date().toDateString())) return wx.showToast({ title: '赛事日期不能早于今天', icon: 'none' });
    wx.showLoading({ title: '保存中' });

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
      qrCode: f.qrCode || '',
      qrCodeUpdatedAt: f.qrCode ? (f.qrCodeUpdatedAt || new Date()) : null,
      qrNotifyDisabled: !!f.qrNotifyDisabled,
      status: new Date(f.date) < new Date() ? 'finished' : 'upcoming',
      tagStats: {}, reviewCount: 0, avgScore: 0,
      publishStatus: 'published',
      source: this.data.editingId
        ? (((this.data.allRaceList.find(r => r._id === this.data.editingId) || {}).source) || 'manual')
        : 'manual',
    };

    if (this.data.editingId) {
      const old = this.data.allRaceList.find(r => r._id === this.data.editingId) || {};
      const manual = new Set(old.manualFields || []);
      const COMPARE_FIELDS = ['name','raceGroup','date','province','city','raceTypes','raceLevel','label','scale','subScale','fee','organizer','operator','contactPhone','contactEmail','wechatAccount','website','mechanism','payment','signupChannels','medicalReport','finishRequirement','refundRule','startPoint','medalImage','routeMap','regStatus','gunTimes','timeline','posters','qrCode','qrCodeUpdatedAt','qrNotifyDisabled'];
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
      const list = this.data.allRaceList.slice();
      const idx = list.findIndex(r => r._id === this.data.editingId);
      if (idx > -1) {
        list[idx] = { ...list[idx], ...data, fmtDate: this.fmtDate(data.date), raceTypesStr: (data.raceTypes||[]).map(t => ({ full:'全马', half:'半马', '10k':'10K' }[t]||t)).join('/'), countdown: this.calcCountdown(data.date, data.status, data.timeline, data.gunTimes) };
        this.setData({ allRaceList: list, showForm: false });
        this.applyAdminFilter();
      }
    } else {
      const addRes = await raceUtil.create(data);
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

              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, W, H);

              ctx.fillStyle = '#333333';
              ctx.font = 'bold 24px sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              let displayName = raceInfo.name || '';
              if (displayName.length > 14) displayName = displayName.slice(0, 12) + '…';
              ctx.fillText(displayName, W / 2, 24);

              ctx.fillStyle = '#888888';
              ctx.font = '18px sans-serif';
              const metaParts = [raceInfo.date, raceInfo.city].filter(Boolean);
              if (metaParts.length) ctx.fillText(metaParts.join(' · '), W / 2, 56);

              const typeParts = [];
              if (raceInfo.type) typeParts.push(raceInfo.type);
              if (raceInfo.level) typeParts.push(raceInfo.level + '级');
              if (raceInfo.label) typeParts.push(raceInfo.label);
              if (typeParts.length) ctx.fillText(typeParts.join(' · '), W / 2, 80);

              const img = canvas.createImage();
              img.src = imgInfo.path;
              img.onload = () => {
                const qrSize = 280;
                const qrX = (W - qrSize) / 2;
                const qrY = 112;
                ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

                ctx.fillStyle = '#aaaaaa';
                ctx.font = '14px sans-serif';
                ctx.fillText('扫码查看赛事详情、关注和评分', W / 2, 415);

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

      this.setData({ showQR: true, qrFileID: qrUrl, sharingRaceName: name, sharingRaceInfo: raceInfo, showQRText: true });
    } catch (e) {
      console.error('genRaceQR error:', e);
      wx.showToast({ title: '生成失败', icon: 'none' });
    }
    wx.hideLoading();
  },
  onHideQR() { this.setData({ showQR: false, showQRText: true }); },
});

// 工具函数
async function uploadQrFile(filePath) {
  const cloudPath = `race_qrcode/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const up = await wx.cloud.uploadFile({ cloudPath, filePath });
  if (!up.fileID) throw new Error('upload no fileID');
  return up.fileID;
}
