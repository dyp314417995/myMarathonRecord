const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });
const rp = require('request-promise');

let cachedToken = null, tokenExpire = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpire) return cachedToken;
  const res = await rp({
    uri: 'https://api.weixin.qq.com/cgi-bin/token',
    qs: { grant_type: 'client_credential', appid: 'wx07a1eccd2cbf673e', secret: process.env.APP_SECRET },
    json: true,
  });
  cachedToken = res.access_token;
  tokenExpire = Date.now() + (res.expires_in - 60) * 1000;
  return cachedToken;
}

exports.main = async (event) => {
  try {
    const token = await getToken();
    const result = await rp({
      method: 'POST',
      uri: `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      body: {
        touser: event.openid,
        template_id: event.templateId,
        page: event.page,
        data: event.data,
        miniprogram_state: 'formal',
      },
      json: true,
    });
    if (result.errcode !== 0) {
      return { error: `errcode=${result.errcode} errmsg=${result.errmsg}` };
    }
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
};
