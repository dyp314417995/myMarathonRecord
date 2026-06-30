// pages/admin/races/races.js - 赛事管理
const raceUtil = require('../../../utils/raceEvents');

Page({
  data: {
    isAdmin: false,
    raceList: [],
    allRaceList: [],        // 未筛选的完整列表
    adminSearch: '', adminType: '', adminLevel: '', adminLabel: '',
    typeFull: true, typeHalf: false, type10k: false, typeTrail: false,
    showForm: false,
    gunTimes: [{ zone: 'A', time: '07:00', zoneIdx: 0 }],
    zoneOptions: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
    editingId: '',
    form: { name: '', date: '', city: '', province: '', raceTypes: ['full'], raceGroup: '', raceLevel: 'B', distance: '', elevation: '', website: '', scale: '', fee: '', mechanism: '抽签', label: '普通标', poster: '', certs: { itra: false, utmb: false, utmbws: false }, payment: '先缴费', tagsStr: '', timeline: [] },
    posterTemp: '',
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
  payments: ['先缴费', '中签后缴费'],

  onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    const role = userInfo.role || 'user';
    this.setData({ isAdmin: role === 'super_admin' || role === 'admin', adminPage: 0, adminHasMore: true, allRaceList: [], raceList: [] });
    if (this.data.isAdmin) this.loadRaces();
  },

  async loadRaces() {
    const userInfo = wx.getStorageSync('userInfo');
    const userId = userInfo ? (userInfo._id || userInfo.openid) : null;
    const skip = this.data.adminPage * 20;
    const res = await raceUtil.getAll({ skip, limit: 20, userId });
    const all = res.list;
    all.forEach(r => {
      if (r.raceType && !r.raceTypes) r.raceTypes = [r.raceType];
      if (!r.raceTypes || !r.raceTypes.length) r.raceTypes = ['full'];
    });
    const list = all.map(r => ({
      ...r, fmtDate: this.fmtDate(r.date),
      raceTypesStr: r.raceTypes.map(t => ({ full: '全马', half: '半马', '10k': '10K', trail: '越野' }[t] || t)).join('/'),
      countdown: this.calcCountdown(r.date, r.status, r.timeline, r.gunTimes),
      confirmed: r.confirmed || false,
    }));
    const merged = [...this.data.allRaceList, ...list];
    this.setData({ allRaceList: merged, adminHasMore: res.hasMore });
    this.applyAdminFilter();
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
    this.setData({ raceList: list });
  },

  onAdminSearch(e) {
    this.setData({ adminSearch: e.detail.value });
    this.applyAdminFilter();
  },

  onAdminFilter(e) {
    const { field, v } = e.currentTarget.dataset;
    const key = field === 'type' ? 'adminType' : field === 'level' ? 'adminLevel' : 'adminLabel';
    this.setData({ [key]: this.data[key] === v ? '' : v });
    this.applyAdminFilter();
  },

  onRaceDetailAdmin(e) {
    const id = e.currentTarget.dataset.id;
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
      showForm: true, editingId: '', posterTemp: '', showPaste: false, pasteText: '', parsing: false,
      typeFull: true, typeHalf: false, type10k: false, typeTrail: false,
      form: { name: '', date: '', city: '', province: '', raceTypes: ['full'], raceGroup: '', raceLevel: 'A', distance: '', elevation: '', website: '', scale: '', fee: '', scaleFull: '', scaleHalf: '', feeFull: '', feeHalf: '', mechanism: '抽签', label: '普通标', poster: '', certs: { itra: false, utmb: false, utmbws: false }, payment: '先缴费', tagsStr: '', timeline: [] },
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
    this.setData({
      showForm: true, editingId: r._id, posterTemp: r.posterUrl || '',
      typeFull: raceTypes.includes('full'), typeHalf: raceTypes.includes('half'), type10k: raceTypes.includes('10k'), typeTrail: raceTypes.includes('trail'),
      form: { name: r.name, date: this.fmtDate(r.date), city: r.city||'', province: r.province||'', raceTypes, raceGroup: r.raceGroup || '', raceLevel: r.raceLevel||'B', distance: r.distance||'', elevation: r.elevation||'', website: r.website||'', scale: r.scale||'', fee: r.fee||'', scaleFull: r.scaleFull||'', scaleHalf: r.scaleHalf||'', feeFull: r.feeFull||'', feeHalf: r.feeHalf||'', mechanism: r.mechanism||'抽签', label: r.label||'普通标', poster: r.poster||'', certs: r.certs || { itra: false, utmb: false, utmbws: false }, payment: r.payment||'先缴费', confirmed: r.confirmed || false, tagsStr: (r.tags || []).join(', '), timeline: existingTimeline },
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
      date: r.date,
      city: r.city || '',
      province: r.province || '',
      raceType: r.raceType || 'full',
      raceLevel: r.raceLevel || 'B',
      label: r.label || '',
      distance: r.distance || '',
      elevation: r.elevation || '',
      website: r.website || '',
      scale: r.scale || '',
      fee: r.fee || '',
      mechanism: r.mechanism || '抽签',
      payment: r.payment || '先缴费',
      poster: r.poster || '',
      certs: r.certs || {},
      timeline: (r.timeline || []).map(t => ({ label: t.label, date: t.date, time: t.time || '' })),
      status: r.status || 'upcoming',
      tags: r.tags || [],
      tagStats: {},
      reviewCount: 0,
      avgScore: 0,
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

  onInput(e) { this.setData({ [`form.${e.currentTarget.dataset.k}`]: e.detail.value }); },

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
    const nameMatch = text.match(/(.{2,20})(?:马拉松|越野赛|半程马拉松)/);
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
      // 全马半马多选：先清掉 10K/越野，然后切换
      const filtered = types.filter(t => t === 'full' || t === 'half');
      const idx = filtered.indexOf(v);
      if (idx >= 0) filtered.splice(idx, 1);
      else filtered.push(v);
      const result = filtered.length ? filtered : ['full'];
      this.setData({
        'form.raceTypes': result,
        typeFull: result.includes('full'), typeHalf: result.includes('half'),
        type10k: false, typeTrail: false,
      });
    } else {
      // 10K/越野：已选中则取消回到全马，否则单选
      if (types.length === 1 && types[0] === v) {
        this.setData({
          'form.raceTypes': ['full'],
          typeFull: true, typeHalf: false, type10k: false, typeTrail: false,
        });
      } else {
        this.setData({
          'form.raceTypes': [v],
          typeFull: false, typeHalf: false, type10k: v === '10k', typeTrail: v === 'trail',
        });
      }
    }
  },
  onFormLevel(e) { this.setData({ 'form.raceLevel': e.currentTarget.dataset.v }); },
  onFormMechanism(e) { this.setData({ 'form.mechanism': e.currentTarget.dataset.v }); },
  onFormLabel(e) { this.setData({ 'form.label': e.currentTarget.dataset.v }); },
  onFormPayment(e) { this.setData({ 'form.payment': e.currentTarget.dataset.v }); },
  onToggleConfirm() { this.setData({ 'form.confirmed': !this.data.form.confirmed }); },

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
  onToggleCert(e) {
    const k = e.currentTarget.dataset.k;
    const certs = { ...this.data.form.certs, [k]: !this.data.form.certs[k] };
    this.setData({ 'form.certs': certs });
  },
  onDateChange(e) { this.setData({ 'form.date': e.detail.value }); },
  onHideForm() { this.setData({ showForm: false }); },

  onChoosePoster() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ posterTemp: res.tempFiles[0].tempFilePath });
      },
    });
  },

  async onSave() {
    const f = this.data.form;
    if (!f.name.trim()) return wx.showToast({ title: '请输入赛事名称', icon: 'none' });
    if (!f.date) return wx.showToast({ title: '请选择鸣枪开跑日期', icon: 'none' });
    wx.showLoading({ title: '保存中' });

    // 上传海报
    let poster = f.poster || '';
    if (this.data.posterTemp && this.data.posterTemp !== poster) {
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `races/poster-${Date.now()}.png`,
          filePath: this.data.posterTemp,
        });
        poster = up.fileID;
      } catch {}
    }

    const data = {
      name: f.name.trim(), date: new Date(f.date), city: f.city.trim(), province: f.province.trim(),
      raceTypes: (f.raceTypes || ['full']).filter(Boolean), raceGroup: (f.raceGroup || '').trim(),
      raceLevel: f.raceLevel,
      distance: (f.raceTypes || []).includes('trail') ? f.distance : '', elevation: (f.raceTypes || []).includes('trail') ? f.elevation : '',
      website: f.website.trim(),
      scale: f.scale.trim(), fee: f.fee.trim(),
      scaleFull: f.scaleFull || '', scaleHalf: f.scaleHalf || '',
      feeFull: f.feeFull || '', feeHalf: f.feeHalf || '',
      gunTimes: this.data.gunTimes.filter(g => g.time),
      mechanism: f.mechanism, label: f.label,
      payment: f.payment, timeline: this.data.timelineNodes.filter(n => n.date).map(n => ({ label: n.label, date: n.date, time: n.time || '' })),
      poster,
      status: new Date(f.date) < new Date() ? 'finished' : 'upcoming',
      certs: (f.raceTypes || []).includes('trail') ? f.certs : {},
      tags: (f.tagsStr || '').split(/[,，]/).map(s => s.trim()).filter(Boolean), tagStats: {}, reviewCount: 0, avgScore: 0,
      confirmed: f.confirmed || false,
    };
    if (this.data.editingId) {
      await raceUtil.update(this.data.editingId, data);
    } else {
      await raceUtil.create(data);
    }
    wx.hideLoading();
    wx.showToast({ title: '已保存', icon: 'success' });
    this.setData({ showForm: false });
    this.loadRaces();
  },
});
