// 云函数：getPhoneNumber - 获取用户手机号
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { cloudID } = event;
  try {
    const res = await cloud.getOpenData({
      list: [cloudID],
    });
    if (res && res.list && res.list.length > 0) {
      const phoneData = JSON.parse(res.list[0].data);
      return { phoneNumber: phoneData.phoneNumber };
    }
    return { phoneNumber: '' };
  } catch (err) {
    console.error('获取手机号失败:', err);
    return { phoneNumber: '', error: err.message };
  }
};
