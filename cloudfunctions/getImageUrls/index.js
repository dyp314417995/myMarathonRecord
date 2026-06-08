// 云函数 getImageUrls - 管理员权限获取图片临时链接
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { fileIDs } = event;
  const res = await cloud.getTempFileURL({ fileList: fileIDs });
  return res.fileList;
};
