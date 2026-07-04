const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });

exports.main = async (event) => {
  const { raceId } = event;
  const result = await cloud.openapi.wxacode.getUnlimited({
    scene: raceId,
    page: 'pages/tools/calendar/detail',
    width: 280,
    checkPath: false,
    env_version: 'trial',
  });
  const upload = await cloud.uploadFile({
    cloudPath: `qrcode/race_${raceId}.png`,
    fileContent: result.buffer,
  });
  return { fileID: upload.fileID };
};
