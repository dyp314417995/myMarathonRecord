// 云函数：从表格数据导入赛事（直接发布，字段级保护）
// 入参: { races?: [...], storageFileID?: "cloud://...", dryRun?: boolean }
// 规则（v2.6.2 方案B）：
//   1. 无同名 → 新建 published（信任表格，不再有草稿）
//   2. 同名人工创建(source='manual') → 跳过（人工赛事不受导入影响）
//   3. 同名表格赛事 → 字段合并：表格有值才覆盖；existing.manualFields 里的人工修改字段保留
// 人工改过的字段由管理端保存时写入 manualFields，导入时永不覆盖
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 表格数据里可能写入的字段（不含系统字段）
const TABLE_FIELDS = ["name","raceGroup","date","province","city","raceTypes","raceLevel","label","scale","subScale","fee","organizer","operator","contactPhone","contactEmail","wechatAccount","website","mechanism","payment","feeDeadline","signupChannels","medicalReport","finishRequirement","refundRule","startPoint","medalImage","routeMap","regStatus","timeline","status","source","sourceSite","sourceUrl","sourceId"];

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

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

      // 1) 新建：直接发布
      if (!existing) {
        if (dryRun) { stat.created++; continue; }
        const doc = {
          ...race,
          date: new Date(race.date),
          status: race.status || (new Date(race.date) < now ? "finished" : "upcoming"),
          publishStatus: "published",
          source: "table",
          manualFields: [],
          firstSeenAt: now, lastAutoFetchAt: now, autoFetchedCount: 1,
          createTime: now, updateTime: now,
        };
        delete doc._id;
        await db.collection("race_events").add({ data: doc });
        stat.created++;
        continue;
      }

      // 2) 人工创建的赛事：跳过（不覆盖人工数据）
      if (existing.source === "manual") { stat.skipped++; continue; }

      // 3) 表格赛事：字段合并，人工修改字段(manualFields)保留
      if (dryRun) { stat.updated++; continue; }
      const patch = { updateTime: now, lastAutoFetchAt: now, autoFetchedCount: (existing.autoFetchedCount || 0) + 1 };
      const manual = new Set(existing.manualFields || []);
      for (const f of TABLE_FIELDS) {
        const v = race[f];
        if (isEmpty(v)) continue;                    // 表格没值 → 不覆盖现有
        if (manual.has(f)) continue;                 // 人工改过 → 保留
        patch[f] = f === "date" ? new Date(v) : v;
      }
      // 未设置 publishStatus 的老数据也置为已发布
      if (existing.publishStatus !== "published") patch.publishStatus = "published";
      if (existing.source !== "table") patch.source = "table";
      await db.collection("race_events").doc(existing._id).update({ data: patch });
      stat.updated++;
    } catch (e) { stat.failed++; stat.errors.push((e.message || String(e)).slice(0, 200)); }
  }
  return stat;
};
