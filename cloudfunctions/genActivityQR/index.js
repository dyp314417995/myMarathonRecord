// 生成活动小程序码
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
exports.main = async (event) => {
  const { activityId } = event;
  try {
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: `act=${activityId}`,
      page: 'pages/tools/activity/detail',
      width: 280,
      checkPath: true,
    });
    // 上传到云存储
    const upload = await cloud.uploadFile({
      cloudPath: `qrcode/activity_${activityId}.png`,
      fileContent: result.buffer,
    });
    return { fileID: upload.fileID };
  } catch (err) {
    console.error('genQR error:', err);
    return { error: err.message };
  }
};
