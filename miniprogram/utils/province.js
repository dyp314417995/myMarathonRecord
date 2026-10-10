// 省份名归一化工具
// 背景：管理员配置的省份来自 city-data 全称（吉林省/广西壮族自治区/北京市...），
//      赛事数据(province 字段)来自表格简称（吉林/广西/北京...），直接字符串匹配会失败。
//      统一归一化为简称（2-3 字）后再比较/查询。

// 全称 → 简称（含特殊：兵团=新疆生产建设兵团，归入新疆）
const PROVINCE_ALIAS = {
  '北京市': '北京', '天津市': '天津', '上海市': '上海', '重庆市': '重庆',
  '内蒙古自治区': '内蒙古', '广西壮族自治区': '广西', '西藏自治区': '西藏',
  '宁夏回族自治区': '宁夏', '新疆维吾尔自治区': '新疆',
  '香港特别行政区': '香港', '澳门特别行政区': '澳门',
  '兵团': '新疆',
};

// 简称 → 官方全称（无对应"X省"形态的）
const PROVINCE_FULL = {
  '北京': '北京市', '天津': '天津市', '上海': '上海市', '重庆': '重庆市',
  '内蒙古': '内蒙古自治区', '广西': '广西壮族自治区', '西藏': '西藏自治区',
  '宁夏': '宁夏回族自治区', '新疆': '新疆维吾尔自治区',
  '香港': '香港特别行政区', '澳门': '澳门特别行政区', '台湾': '台湾省',
};

/** 任意省份名 → 规范简称（吉林/广西/北京/新疆...） */
function canonProvince(name) {
  if (!name) return '';
  if (PROVINCE_ALIAS[name]) return PROVINCE_ALIAS[name];
  return String(name).replace(/(省|市)$/, '');
}

/** 任意省份名 → 所有可能的写法（简称+全称），用于 DB 的 _.in 查询 */
function provinceVariants(name) {
  const c = canonProvince(name);
  if (!c) return [];
  const v = [c];
  if (PROVINCE_FULL[c]) v.push(PROVINCE_FULL[c]);
  else v.push(c + '省');
  return v;
}

/** 一组省份 → 展开去重后的所有写法 */
function expandProvinceList(list) {
  const s = new Set();
  (list || []).forEach(p => provinceVariants(p).forEach(v => s.add(v)));
  return [...s];
}

module.exports = { canonProvince, provinceVariants, expandProvinceList };
