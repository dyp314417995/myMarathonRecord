/**
 * 赛事报名状态自动推导（展示派生，不落库）
 *
 * 状态链：待确定 → 待报名 → 报名中 → 待出签(抽签赛事) → 待开赛 → 已结束；取消独立
 * 推导优先级：
 *   1. 取消（静态，人工维护的事件性状态）
 *   2. 已结束（比赛日期 < 今天，100% 可靠）
 *   3. 按时间线节点推导（报名开启/报名截止/出签时间/二抽出签）
 *   4. 静态 regStatus 兜底（表格导入快照，仅前 3 步推不出来时使用）
 */
function toDate(d, time) {
  if (!d) return null;
  if (d instanceof Date) return d;
  const s = String(d).replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) {
    const p = new Date(s);
    return isNaN(p.getTime()) ? null : p;
  }
  const t = time && String(time).match(/^(\d{1,2}):(\d{2})/);
  return new Date(+m[1], +m[2] - 1, +m[3], t ? +t[1] : 0, t ? +t[2] : 0);
}

function deriveRegStatus(race, now) {
  now = now || new Date();
  if (!race) return '';
  if (race.regStatus === '取消') return '取消';
  const d = toDate(race.date);
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d && d < today0) return '已结束';
  if (race.regStatus === '已结束') return d ? '待确定' : '已结束'; // 未来赛事被标已结束：矛盾数据按待确定显示

  const tl = race.timeline || [];
  const node = (names) => {
    for (const n of tl) {
      if (names.includes(n.label) && n.date) return toDate(n.date, n.time);
    }
    return null;
  };
  const regOpen = node(['报名开启', '开启报名']);
  const regEnd = node(['报名截止', '截止报名']);
  const draw = node(['出签时间', '出签']) || node(['二抽出签']);

  if (regOpen && regEnd) {
    if (now < regOpen) return '待报名';
    if (now < regEnd) return '报名中';
  } else if (regOpen && now < regOpen) {
    return '待报名';
  }
  if (regEnd && now >= regEnd) {
    // 已过报名截止：抽签赛事且出签节点未到 → 待出签；否则待开赛
    const isDraw = String(race.mechanism || '').indexOf('抽签') !== -1;
    if (isDraw && draw && now < draw) return '待出签';
    return '待开赛';
  }
  if (draw && now >= draw) return '待开赛'; // 无报名节点但出签已过

  return race.regStatus || '待确定';
}

module.exports = { deriveRegStatus, toDate };
