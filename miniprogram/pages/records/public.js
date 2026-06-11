// pages/records/public.js - 查看他人公开记录（只读）
const dbUtil = require('../../utils/db');
const db = dbUtil.db;

Page({
  data: {
    tab: 'full',
    records: [],
    filteredRecords: [],
    showChart: false,
    chartData: [],
    userId: '',
    userName: '',
  },

  onLoad(options) {
    this.setData({ userId: options.userId || '', userName: options.userName || '' });
    this.loadRecords();
  },

  async loadRecords() {
    if (!this.data.userId) return;
    const res = await db.collection('race_records')
      .where({ userId: this.data.userId, isPublic: true })
      .orderBy('date', 'desc').get();
    const records = res.data.map(r => ({ ...r, imgUrls: [] }));
    const allCloudIds = records.reduce((arr, r) => arr.concat(r.images || []), []);
    const urlMap = {};
    for (let i = 0; i < allCloudIds.length; i += 50) {
      try {
        const batch = allCloudIds.slice(i, i + 50);
        const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: batch } });
        (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch {}
    }
    const u = await db.collection('users').doc(this.data.userId).get().catch(() => ({}));
    const toSec = (t) => { const p = (t||'').split(':'); return +p[0]*3600 + +p[1]*60 + +(p[2]||0); };
    const pbFields = { '10k': u?.data?.pb10k, half: u?.data?.pbHalf, full: u?.data?.pbFull };
    records.forEach(r => {
      r.imgUrls = (r.images || []).map(id => urlMap[id] || '').filter(Boolean);
      r.isPB = r.status === 'finished' && r.result && toSec(r.result) <= toSec(pbFields[r.raceType]) && r.result === pbFields[r.raceType];
    });
    this.setData({ records });
    this.updateFiltered();
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.t });
    this.updateFiltered();
    this.updateChart();
  },

  updateFiltered() {
    const tab = this.data.tab;
    const filtered = this.data.records.filter(r => {
      if (tab === '10k') return r.raceType === '10k';
      if (tab === 'half') return r.raceType === 'half';
      if (tab === 'trail') return r.raceType === 'trail';
      return r.raceType === 'full';
    });
    this.setData({ filteredRecords: filtered });
    this.updateChart();
  },

  updateChart() {
    const finished = this.data.filteredRecords.filter(r => r.status === 'finished' && r.result);
    if (finished.length < 2) { this.setData({ showChart: false, chartData: [] }); return; }
    const toSec = (t) => { const p = t.split(':'); return +p[0]*3600 + +p[1]*60 + +(p[2]||0); };
    const pb = finished.reduce((best, r) => toSec(r.result) < toSec(best.result) ? r : best, finished[0]);
    const maxSec = Math.max(...finished.map(r => toSec(r.result)));
    const entries = finished.slice(0, 10).reverse().map(r => ({
      date: r.date, city: r.city, result: r.result,
      isPB: r._id === pb._id,
      width: Math.max(((toSec(r.result) / maxSec) * 100), 30),
    }));
    this.setData({ showChart: true, chartData: entries });
  },

  onImagePreview(e) {
    wx.previewImage({ urls: [e.currentTarget.dataset.src], current: e.currentTarget.dataset.src });
  },
});
