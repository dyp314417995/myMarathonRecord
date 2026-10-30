// utils/raceResult.js - 成绩的统一口径：换算、合法性、取值范围
//
// 成绩格式 H:MM:SS（小时不补零），例如 "3:21:38" / "0:50:30"
// 「00:00:00」不算成绩 —— 它只会来自默认值或误操作，参与排序和 PB 比较都会出错。

// 各项目的合理成绩范围（秒）。没列出的项目（10K、自定义距离）暂不限制。
const LIMITS = {
  full: { min: 2 * 3600, max: 6 * 3600, text: '2:00:00 ~ 6:00:00', name: '全马' },
  half: { min: 1 * 3600, max: 3 * 3600, text: '1:00:00 ~ 3:00:00', name: '半马' },
};

// 项目 key -> PB 字段名
const PB_FIELDS = { full: 'pbFull', half: 'pbHalf', '10k': 'pb10k' };

function toSeconds(t) {
  if (!t || typeof t !== 'string') return null;
  const p = t.trim().split(':').map(x => parseInt(x, 10));
  if (p.length === 0 || p.some(x => isNaN(x))) return null;
  let s;
  if (p.length === 3) s = p[0] * 3600 + p[1] * 60 + p[2];
  else if (p.length === 2) s = p[0] * 60 + p[1];
  else s = p[0];
  return s > 0 ? s : null;   // 00:00:00 视为没有成绩
}

function parse(result) {
  if (!result || typeof result !== 'string') return null;
  const t = result.trim();
  // 必须是 H:MM:SS / MM:SS / SS，且每位都是数字
  if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(t)) return null;
  return toSeconds(t);
}

// 校验成绩是否可录入：格式对、不为 0、且在所属项目的合理范围内
// 返回 { ok: true } 或 { ok: false, error: '提示文案' }
function checkResult(result, raceType) {
  const sec = parse(result);
  if (!sec) {
    // 全是 0 多半是没选、直接点了确定，提示得明确一点
    const allZero = /^0+(:0+)*$/.test(String(result || '').trim());
    return {
      ok: false,
      error: allZero ? '成绩还是 0，请重新选择' : '成绩格式不对，按 时:分:秒 填写',
    };
  }

  const limit = LIMITS[raceType];
  if (!limit) return { ok: true };   // 10K / 自定义距离暂不限制

  if (sec < limit.min) {
    return { ok: false, error: `${limit.name}成绩不可能这么快，合理范围 ${limit.text}` };
  }
  if (sec > limit.max) {
    return { ok: false, error: `${limit.name}成绩超出合理范围（${limit.text}），请检查` };
  }
  return { ok: true };
}

// 给某个项目取限制信息，用于选择器上显示范围提示
function getLimit(raceType) {
  const l = LIMITS[raceType];
  if (!l) return null;
  return { minSec: l.min, maxSec: l.max, tip: `${l.name} ${l.text}` };
}

function pbField(raceType) {
  return PB_FIELDS[raceType] || '';
}

module.exports = { toSeconds, parse, checkResult, getLimit, pbField, LIMITS, PB_FIELDS };
