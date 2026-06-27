// 云函数 getImageUrls - 管理员权限获取图片临时链接，含失败重试
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { fileIDs } = event;
  if (!fileIDs || !fileIDs.length) return [];

  // 第一次批量获取
  const res = await cloud.getTempFileURL({ fileList: fileIDs });
  const resultMap = {};
  const failedIds = [];

  res.fileList.forEach(f => {
    if (f.tempFileURL) {
      resultMap[f.fileID] = f.tempFileURL;
    } else {
      failedIds.push(f.fileID);
    }
  });

  // 对失败的逐个重试（最多再试2次）
  for (const id of failedIds) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const retry = await cloud.getTempFileURL({ fileList: [id] });
        const item = retry.fileList[0];
        if (item && item.tempFileURL) {
          resultMap[id] = item.tempFileURL;
          break;
        }
      } catch {}
    }
  }

  // 返回统一格式：fileID → tempFileURL 映射
  return Object.keys(resultMap).map(fileID => ({
    fileID,
    tempFileURL: resultMap[fileID]
  }));
};
