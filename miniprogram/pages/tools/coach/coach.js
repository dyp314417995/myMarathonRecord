// pages/tools/coach/coach.js - AI教练
Page({
  data: {
    messages: [
      { role: 'bot', content: '你好！我是你的跑步教练 🏃\n\n可以问我训练计划、配速策略、比赛准备等问题。\n也可以发跑步截图让我分析~' }
    ],
    model: 'qwen',
    input: '', loading: false,
    presets: [
      '我是新手，怎么开始跑步？',
      '一周训练计划怎么安排？',
      '如何提升10K速度？',
      '比赛当天吃什么？',
      '步频多少合适？',
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
          const result = await wx.cloud.callFunction({ name: 'aiCoach', data: { question: this.data.input || '帮我看看这张图', image: up.fileID, model: 'qwen' } });
          msgs.push({ role: 'bot', content: result.result.reply, model: result.result.model });
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
      const res = await wx.cloud.callFunction({ name: 'aiCoach', data: { question: q, model: this.data.model } });
      msgs.push({ role: 'bot', content: res.result.reply, model: res.result.model });
    } catch {
      msgs.push({ role: 'bot', content: '网络开小差了，再问一次？' });
    }
    this.setData({ messages: msgs, loading: false });
  },

  onPreviewMsgImg(e) {
    wx.previewImage({ urls: [e.currentTarget.dataset.src], current: e.currentTarget.dataset.src });
  },

  onSwitchModel(e) {
    this.setData({ model: e.currentTarget.dataset.m });
  },
});
