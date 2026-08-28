// 云函数：从表格数据导入赛事草稿
// 入参: { races?: [...], storageFileID?: "cloud://...", dryRun?: boolean }
// 去重: name(带年份) → 已发布跳过 / 草稿覆盖更新 / 无则新建 draft
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
exports.main = async (event = {}) => {
  const { races, storageFileID, dryRun } = event;
  let list = races || [];
  if (storageFileID) {
    const dl = await cloud.downloadFile({ fileID: storageFileID });
    list = JSON.parse(dl.fileContent.toString("utf8"));
  }
  if (!Array.isArray(list) || !list.length) return { error: "无数据" };
  const stat = { total: list.length, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const now = new Date();
  for (const race of list) {
    try {
      if (!race.name || !race.date) { stat.failed++; stat.errors.push("缺名称/日期: " + (race.name || "")); continue; }
      const exist = await db.collection("race_events").where({ name: race.name }).limit(1).get();
      const existing = exist.data[0];
      const doc = { ...race, date: new Date(race.date), status: race.status || (new Date(race.date) < now ? "finished" : "upcoming"), publishStatus: "draft", source: "table", firstSeenAt: now, lastAutoFetchAt: now, autoFetchedCount: 1, createTime: now, updateTime: now };
      delete doc._id;
      if (!existing) {
        if (dryRun) { stat.created++; continue; }
        await db.collection("race_events").add({ data: doc }); stat.created++;
      } else if (existing.publishStatus === "draft") {
        if (dryRun) { stat.updated++; continue; }
        await db.collection("race_events").doc(existing._id).update({ data: { ...doc, createTime: existing.createTime, firstSeenAt: existing.firstSeenAt, lastAutoFetchAt: now, autoFetchedCount: (existing.autoFetchedCount || 0) + 1 } }); stat.updated++;
      } else { stat.skipped++; }
    } catch (e) { stat.failed++; stat.errors.push((e.message || String(e)).slice(0, 200)); }
  }
  return stat;
};
