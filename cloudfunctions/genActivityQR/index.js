// 生成活动小程序码
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });
exports.main = async (event) => {
  const { activityId } = event;
  try {
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: activityId,
      page: 'pages/tools/activity/detail',
      width: 280,
      checkPath: false,
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
