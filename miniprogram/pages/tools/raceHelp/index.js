// pages/tools/raceHelp/index.js - 跑友互助（聚合入口）
//
// 放小工具里，不再藏在每场赛事的详情页深处：
// 一进来就是「我发布的 / 我应征的」，两边都按赛事分组。
// 发布时先选一场关注的赛事——互助必须挂在某场比赛上，没有赛事就没有上下文。
const TYPES = [
  { key: 'room', label: '拼房', icon: '🏠' },
  { key: 'carpool', label: '拼车', icon: '🚗' },
  { key: 'meal', label: '拼饭', icon: '🍜' },
  { key: 'tour', label: '旅游', icon: '🧳' },
  { key: 'team', label: '组队', icon: '👥' },
];

const MAX_DAYS = 90;   // 与云函数 LIMIT.maxDays 一致
const WX_RE = /^[-_a-zA-Z0-9]{5,20}$/;

const pad = n => String(n).padStart(2, '0');
const ymd = (v) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v).replace(/-/g, '/').replace('T', ' '));
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const hm = (v) => {
  const d = v instanceof Date ? v : new Date(String(v).replace(/-/g, '/').replace('T', ' '));
  if (isNaN(d.getTime())) return '22:00';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function call(action, data) {
  return wx.cloud.callFunction({ name: 'raceHelp', data: Object.assign({ action }, data || {}) })
    .then(r => (r && r.result) || {})
    .catch((e) => {
      console.error('[raceHelp]', action, e);
      return { success: false, error: '网络开小差了，稍后再试' };
    });
}

// 默认截止：赛事前一天 22:00。没填赛事日期就退到 7 天后。
function defaultDeadline(eventDate) {
  let d = null;
  if (eventDate) {
    const t = new Date(String(eventDate).replace(/-/g, '/'));
    if (!isNaN(t.getTime())) d = new Date(t.getTime() - 86400000);
  }
  if (!d) d = new Date(Date.now() + 7 * 86400000);
  d.setHours(22, 0, 0, 0);
  // 赛事已经过去或就在今天，默认值会落在过去，往后挪一天
  if (d.getTime() <= Date.now()) {
    d = new Date(Date.now() + 86400000);
    d.setHours(22, 0, 0, 0);
  }
  return { date: ymd(d), time: '22:00' };
}

Page({
  data: {
    loading: true,
    tab: 'mine',
    groups: [],
    mineList: [],
    applyList: [],
    tabCount: { mine: 0, apply: 0 },

    // 选赛事
    events: [],
    eventsLoaded: false,
    showPicker: false,

    // 发布 / 编辑
    showForm: false,
    curEvent: null,
    editingId: '',
    submitting: false,
    types: TYPES,
    today: '',
    maxDate: '',
    form: {
      type: 'room',
      title: '',
      desc: '',
      costNote: '',
      peopleNeeded: 2,
      deadline: '',
      deadlineTime: '22:00',
      wechat: '',
      ruleAgreed: false,
    },

    shareHelpId: '',
  },

  onLoad() {
    const t = new Date();
    this.setData({ today: ymd(t), maxDate: ymd(new Date(t.getTime() + MAX_DAYS * 86400000)) });
    this.load();
  },

  // 从详情页回来，状态可能已经变了（别人应征、发起人取消），每次回来都重取
  onShow() {
    if (this._loaded) this.load();
  },

  async load() {
    const [mine, applied] = await Promise.all([
      call('myHelps'),
      call('myApplies'),
    ]);
    this._loaded = true;
    this.setData({
      loading: false,
      mineList: mine.list || [],
      applyList: applied.list || [],
      tabCount: { mine: (mine.list || []).length, apply: (applied.list || []).length },
    }, () => this.buildGroups());
  },

  // 按赛事分组：分组顺序跟着后端返回的先后（最近更新的赛事在前）
  buildGroups() {
    const list = this.data.tab === 'mine' ? this.data.mineList : this.data.applyList;
    const map = {};
    const order = [];
    list.forEach((it) => {
      const key = it.eventId || 'unknown';
      if (!map[key]) {
        map[key] = {
          eventId: key,
          // 赛事被删/重建换了 id 后，历史互助会挂在一个已经不存在的事上，
          // 这里如实说「已下架」，别写「待更新」——那听起来像我们没加载完
          eventName: it.eventName || '赛事已下架',
          eventDateText: ymd(it.eventDate),
          items: [],
        };
        order.push(key);
      }
      map[key].items.push(it);
    });
    this.setData({ groups: order.map(k => map[k]) });
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.t;
    if (tab === this.data.tab) return;
    this.setData({ tab }, () => this.buildGroups());
  },

  // ===================== 发布：先选赛事 =====================

  async loadEvents() {
    const res = await call('myEvents');
    const list = (res.list || []).map(e => Object.assign({}, e, { dateText: ymd(e.date) }));
    this.setData({ events: list, eventsLoaded: true });
    return list;
  },

  async onStartPublish() {
    // 每次都重新拉一次：用户很可能刚被引到赛事列表关注了一场又回来，
    // 沿用缓存的话，他会看到一个空弹窗，以为关注没生效
    wx.showLoading({ title: '加载赛事…', mask: true });
    let events = [];
    try {
      events = await this.loadEvents();
    } catch (e) {
      events = this.data.events || [];
    }
    wx.hideLoading();

    // 一场都没关注：与其让他在弹窗里看着空白，不如直接送去关注
    if (!events.length) {
      wx.showModal({
        title: '先关注一场赛事',
        content: '互助要挂在某场比赛上，关注之后就能发布了。',
        confirmText: '去关注',
        cancelText: '知道了',
        success: (r) => {
          if (r.confirm) wx.navigateTo({ url: '/pages/tools/calendar/index?tab=all' });
        },
      });
      return;
    }
    this.setData({ showPicker: true });
  },

  onClosePicker() { this.setData({ showPicker: false }); },

  onPickEvent(e) {
    const ev = this.data.events[e.currentTarget.dataset.idx];
    if (!ev) return;
    const dd = defaultDeadline(ev.date);
    const lastWx = wx.getStorageSync('help_wechat') || '';
    this.setData({
      showPicker: false,
      showForm: true,
      editingId: '',
      curEvent: ev,
      form: {
        type: 'room',
        title: '',
        desc: '',
        costNote: '',
        peopleNeeded: 2,
        deadline: dd.date,
        deadlineTime: dd.time,
        wechat: lastWx,
        ruleAgreed: false,
      },
    });
  },

  // ===================== 表单 =====================

  onCloseForm() {
    if (this.data.submitting) return;
    this.setData({ showForm: false, editingId: '', curEvent: null });
  },

  onPickType(e) {
    this.setData({ 'form.type': e.currentTarget.dataset.k });
  },

  onInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ ['form.' + k]: e.detail.value });
  },

  // 需要几人：输入过程中只挡非数字，**不夹紧数值**
  // 以前每按一个键就 Math.max(1, ...) 再 setData：
  //   想从 2 改成 4 → 删掉 → 空 → 立刻被填回 1 → 再输 4 变成 14 → 又被 clamp 成 9
  // 数字根本改不动，而且删不干净。收敛放到失焦和提交时做。
  onPeople(e) {
    // type="number" 在部分机型仍能敲出 . 和 -，只留数字，最多 2 位（上限 9 人，够用）
    const v = String(e.detail.value || '').replace(/[^\d]/g, '').slice(0, 2);
    this.setData({ 'form.peopleNeeded': v });
  },

  // 离开输入框时再收敛到 1-9，空的话回到默认 2
  onPeopleBlur() {
    const n = parseInt(this.data.form.peopleNeeded, 10);
    this.setData({ 'form.peopleNeeded': Math.max(1, Math.min(9, n || 2)) });
  },

  onDate(e) { this.setData({ 'form.deadline': e.detail.value }); },
  onTime(e) { this.setData({ 'form.deadlineTime': e.detail.value }); },
  onToggleRule() { this.setData({ 'form.ruleAgreed': !this.data.form.ruleAgreed }); },

  async onSubmit() {
    if (this.data.submitting) return;
    const f = this.data.form;
    const ev = this.data.curEvent;
    if (!ev) return wx.showToast({ title: '先选一场赛事', icon: 'none' });
    if (!String(f.title).trim()) return wx.showToast({ title: '写个标题，跑友才知道拼什么', icon: 'none' });
    if (!WX_RE.test(String(f.wechat).trim())) return wx.showToast({ title: '微信号 5-20 位字母数字', icon: 'none' });
    if (!f.ruleAgreed) return wx.showToast({ title: '请先看一下互助规则', icon: 'none' });

    const deadline = `${f.deadline} ${f.deadlineTime}`;
    if (new Date(deadline.replace(/-/g, '/')).getTime() <= Date.now()) {
      return wx.showToast({ title: '截止时间要晚于现在', icon: 'none' });
    }

    this.setData({ submitting: true });
    const editing = this.data.editingId;
    const payload = {
      eventId: ev.eventId,
      type: f.type,
      title: String(f.title).trim(),
      desc: String(f.desc).trim(),
      costNote: String(f.costNote).trim(),
      // 输入框里可能留着空串或 0（用户直接提交没失焦的情况），这里兜一次
      peopleNeeded: Math.max(1, Math.min(9, parseInt(f.peopleNeeded, 10) || 2)),
      deadline,
      contact: { wechat: String(f.wechat).trim() },
      ruleAgreed: true,
    };
    if (editing) payload.helpId = editing;

    const res = await call(editing ? 'update' : 'create', payload);
    this.setData({ submitting: false });

    if (!res.success) return wx.showToast({ title: res.error || '发布失败', icon: 'none' });
    wx.setStorageSync('help_wechat', payload.contact.wechat);
    wx.showToast({ title: editing ? '已重新发起' : '发布成功', icon: 'none' });
    this.setData({ showForm: false, editingId: '', curEvent: null, tab: 'mine' }, () => this.load());
  },

  // ===================== 编辑再发起 =====================

  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.mineList.find(x => x._id === id);
    if (!item) return;
    this.setData({
      showForm: true,
      editingId: id,
      curEvent: { eventId: item.eventId, name: item.eventName, date: item.eventDate, dateText: ymd(item.eventDate) },
      form: {
        type: item.type || 'room',
        title: item.title || '',
        desc: item.desc || '',
        costNote: item.costNote || '',
        peopleNeeded: item.peopleNeeded || 2,
        deadline: ymd(item.deadline),
        deadlineTime: hm(item.deadline),
        wechat: item.myWechat || '',
        // 重新发起等于重新发布，规则要再确认一次
        ruleAgreed: false,
      },
    });
  },

  // ===================== 条目操作 =====================

  onOpenDetail(e) {
    const { event, help } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/tools/calendar/detail?id=${event}&helpId=${help}` });
  },

  onShareHelp(e) {
    this.setData({ shareHelpId: e.currentTarget.dataset.id || '' });
  },

  onShareAppMessage() {
    const item = (this.data.mineList || []).find(x => x._id === this.data.shareHelpId);
    if (!item) {
      return { title: '跑友互助 · 一起拼个伴', path: '/pages/tools/raceHelp/index' };
    }
    const tail = item.state === 'open'
      ? `（还差 ${item.remainPeople || item.peopleNeeded} 人）`
      : `（${item.stateLabel || ''}）`;
    return {
      title: `${(item.typeLabel || '互助')}｜${item.title}${tail}`,
      path: `/pages/tools/calendar/detail?id=${item.eventId}&helpId=${item._id}`,
    };
  },

  onCopy(e) {
    const v = e.currentTarget.dataset.v;
    if (!v) return;
    wx.setClipboardData({ data: String(v) });
  },

  async onFinish(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.mineList.find(x => x._id === id) || {};
    const gap = Math.max(0, (item.peopleNeeded || 0) - (item.applyPeople || 0));
    wx.showModal({
      title: '标记完成',
      content: gap > 0
        ? `还差 ${gap} 人，确定不再招了吗？组内跑友会收到通知。`
        : '确定这次组队已经完成？组内跑友会收到通知。',
      success: async (r) => {
        if (!r.confirm) return;
        const res = await call('finish', { helpId: id });
        if (!res.success) return wx.showToast({ title: res.error || '操作失败', icon: 'none' });
        wx.showToast({ title: '已完成', icon: 'none' });
        this.load();
      },
    });
  },

  async onCancel(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.mineList.find(x => x._id === id) || {};
    const n = (item.applicants || []).length;
    wx.showModal({
      title: '取消这条互助',
      content: n > 0
        ? `已经有 ${n} 位跑友应征，取消后他们的记录都会作废，每个人都会收到通知。`
        : '取消后这条就不在列表里了，之后还能编辑再发起。',
      success: async (r) => {
        if (!r.confirm) return;
        const res = await call('cancel', { helpId: id });
        if (!res.success) return wx.showToast({ title: res.error || '操作失败', icon: 'none' });
        wx.showToast({ title: '已取消', icon: 'none' });
        this.load();
      },
    });
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除',
      content: '删除后两边都看不到了，确定吗？',
      success: async (r) => {
        if (!r.confirm) return;
        const res = await call('delete', { helpId: id });
        if (!res.success) return wx.showToast({ title: res.error || '操作失败', icon: 'none' });
        wx.showToast({ title: '已删除', icon: 'none' });
        this.load();
      },
    });
  },

  onCancelApply(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.applyList.find(x => x.applyId === id) || {};
    const isDone = item.state === 'done';
    wx.showModal({
      title: isDone ? '我去不了了' : '取消应征',
      content: isDone
        ? (item.doneReason === 'full'
          ? '这条互助已经招满，退出后会重新开放招募，发起人和组内跑友都会收到通知。'
          : '发起人和组内跑友都会收到通知。确定退出？')
        : '取消后名额会放回，发布者会收到通知。',
      success: async (r) => {
        if (!r.confirm) return;
        const res = await call('cancelApply', { applyId: id });
        if (!res.success) return wx.showToast({ title: res.error || '操作失败', icon: 'none' });
        wx.showToast({
          title: res.reopened ? '已退出，重新开放招募' : (isDone ? '已退出' : '已取消应征'),
          icon: 'none', duration: 2500,
        });
        this.load();
      },
    });
  },

  onDeleteApply(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录',
      content: '只从你的列表里去掉，不影响发起人那边。',
      success: async (r) => {
        if (!r.confirm) return;
        const res = await call('deleteApply', { applyId: id });
        if (!res.success) return wx.showToast({ title: res.error || '操作失败', icon: 'none' });
        wx.showToast({ title: '已删除', icon: 'none' });
        this.load();
      },
    });
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
});
