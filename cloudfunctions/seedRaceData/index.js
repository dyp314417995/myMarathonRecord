// 一次性云函数：录入初始赛事数据
// 上传部署后，在云开发控制台手动触发一次即可
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const now = new Date();

  const events = [
    // 1. 黄河口(东营)马拉松 - 全马
    {
      name: '黄河口(东营)马拉松',
      date: new Date('2026-10-18T07:30:00'),
      city: '东营',
      province: '山东',
      raceType: 'full',
      raceLevel: 'A',
      label: '金标',
      scale: '',
      fee: '',
      mechanism: '先到先得',
      payment: '先缴费',
      website: '',
      poster: '',
      certs: {},
      tags: ['金标赛事'],
      tagStats: {},
      reviewCount: 0,
      avgScore: 0,
      status: 'upcoming',
      timeline: [
        { label: '报名开启', date: '2026-05-26', time: '10:00' },
        { label: '鸣枪开跑', date: '2026-10-18', time: '07:30' },
      ],
      createTime: now,
    },
    // 2. 太原马拉松 - 全马
    {
      name: '太原马拉松 · 全程马拉松',
      date: new Date('2026-09-27T07:30:00'),
      city: '太原',
      province: '山西',
      raceType: 'full',
      raceLevel: 'A',
      label: '金标',
      scale: '40000人（全项目）',
      fee: '',
      mechanism: '抽签',
      payment: '先缴费',
      website: '',
      poster: '',
      certs: {},
      tags: ['金标赛事'],
      tagStats: {},
      reviewCount: 0,
      avgScore: 0,
      status: 'upcoming',
      timeline: [
        { label: '报名开启', date: '2026-06-23', time: '10:00' },
        { label: '报名截止', date: '2026-07-15', time: '24:00' },
        { label: '出签时间', date: '2026-07-22', time: '14:00' },
        { label: '鸣枪开跑', date: '2026-09-27', time: '07:30' },
      ],
      createTime: now,
    },
    // 3. 太原马拉松 - 半马
    {
      name: '太原马拉松 · 半程马拉松',
      date: new Date('2026-09-27T07:30:00'),
      city: '太原',
      province: '山西',
      raceType: 'half',
      raceLevel: 'A',
      label: '金标',
      scale: '40000人（全项目）',
      fee: '',
      mechanism: '抽签',
      payment: '先缴费',
      website: '',
      poster: '',
      certs: {},
      tags: ['金标赛事'],
      tagStats: {},
      reviewCount: 0,
      avgScore: 0,
      status: 'upcoming',
      timeline: [
        { label: '报名开启', date: '2026-06-23', time: '10:00' },
        { label: '报名截止', date: '2026-07-15', time: '24:00' },
        { label: '出签时间', date: '2026-07-22', time: '14:00' },
        { label: '鸣枪开跑', date: '2026-09-27', time: '07:30' },
      ],
      createTime: now,
    },
  ];

  const results = [];
  for (const event of events) {
    try {
      const res = await db.collection('race_events').add({ data: event });
      results.push({ name: event.name, id: res._id, status: 'ok' });
    } catch (err) {
      results.push({ name: event.name, error: err.message });
    }
  }

  return { success: true, inserted: results.length, results };
};
