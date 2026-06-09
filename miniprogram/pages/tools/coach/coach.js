// pages/tools/coach/coach.js - AI教练
Page({
  data: {
    messages: [
      { role: 'bot', content: '你好！我是你的跑步教练 🏃\n\n可以问我训练计划、配速策略、比赛准备等问题。\n也可以发送跑步截图让我看看~' }
    ],
    input: '', loading: false,
    presets: [
      '我是新手，怎么开始跑步？', '半马前两周怎么练？',
      '跑完腿疼怎么办？', '如何提升10K速度？',
      '比赛当天吃什么？', '步频多少合适？',
    ],
  },

  onInput(e) { this.setData({ input: e.detail.value }); },

  onQuickAsk(e) {
    this.setData({ input: e.currentTarget.dataset.q });
    this.onSend();
  },

  onChooseImage() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: async (res) => {
        const img = res.tempFiles[0].tempFilePath;
        const msgs = [...this.data.messages, { role: 'user', content: this.data.input || '[图片]', image: img }];
        this.setData({ messages: msgs, input: '', loading: true });
        try {
          const up = await wx.cloud.uploadFile({ cloudPath: 'coach/' + Date.now() + '.png', filePath: img });
          const result = await wx.cloud.callFunction({ name: 'aiCoach', data: { question: this.data.input || '帮我看看这张图', image: up.fileID } });
          msgs.push({ role: 'bot', content: result.result.reply, hasDeep: result.result.hasDeep });
        } catch {
          msgs.push({ role: 'bot', content: '图片发送失败了' });
        }
        this.setData({ messages: msgs, loading: false });
      },
    });
  },

  async onSend() {
    const q = this.data.input.trim();
    if (!q) return;
    const msgs = [...this.data.messages, { role: 'user', content: q }];
    this.setData({ messages: msgs, input: '', loading: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'aiCoach', data: { question: q } });
      msgs.push({ role: 'bot', content: res.result.reply, hasDeep: res.result.hasDeep });
    } catch {
      msgs.push({ role: 'bot', content: '网络开小差了，再问一次？' });
    }
    this.setData({ messages: msgs, loading: false });
  },

  // 不满意？深度思考
  async onDeepAsk(e) {
    const idx = e.currentTarget.dataset.idx;
    const userMsg = this.data.messages[idx - 1];
    if (!userMsg) return;
    const q = userMsg.content;
    const msgs = [...this.data.messages, { role: 'user', content: q }];
    this.setData({ messages: msgs, loading: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'aiCoach', data: { question: q, deepMode: true } });
      msgs.push({ role: 'bot', content: res.result.reply });
    } catch {
      msgs.push({ role: 'bot', content: 'AI 调用失败' });
    }
    this.setData({ messages: msgs, loading: false });
  },

  onPreviewMsgImg(e) {
    wx.previewImage({ urls: [e.currentTarget.dataset.src], current: e.currentTarget.dataset.src });
  },
});
