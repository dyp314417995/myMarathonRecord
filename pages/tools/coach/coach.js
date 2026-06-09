// pages/tools/coach/coach.js - AI教练
Page({
  data: {
    messages: [
      { role: 'bot', content: '你好！我是你的跑步教练 🏃\n\n可以问我训练计划、配速策略、比赛准备等问题。' }
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

  async onSend() {
    const q = this.data.input.trim();
    if (!q) return;
    const msgs = [...this.data.messages, { role: 'user', content: q }];
    this.setData({ messages: msgs, input: '', loading: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'aiCoach', data: { question: q } });
      msgs.push({ role: 'bot', content: res.result.reply });
    } catch {
      msgs.push({ role: 'bot', content: '网络开小差了，再问一次？' });
    }
    this.setData({ messages: msgs, loading: false });
    this.scrollToBottom();
  },

  scrollToBottom() {
    setTimeout(() => {
      wx.createSelectorQuery().select('#chatBody').boundingClientRect((r) => {
        if (r) wx.pageScrollTo({ scrollTop: r.height + 500, duration: 200 });
      }).exec();
    }, 100);
  },
});
