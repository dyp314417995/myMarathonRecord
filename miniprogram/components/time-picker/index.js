// components/time-picker/index.js - 时间选择器 HH:MM:SS
//
// 顶部实时显示当前选中的值，避免滚轮滑过头选错（选了 3 结果成了 2 的那种）
// 支持传入合理的成绩范围（minSec / maxSec），超范围不让确认。
Component({
  properties: {
    value: { type: String, value: '' },       // 当前值 "1:32:59"
    show: { type: Boolean, value: false },
    defaultValue: { type: String, value: '0:00:00' }, // 默认参照值
    label: { type: String, value: '选择时间' },
    minSec: { type: Number, value: 0 },       // 最小秒数，0 = 不限
    maxSec: { type: Number, value: 0 },       // 最大秒数，0 = 不限
    rangeTip: { type: String, value: '' },    // 范围提示文案，如「半马 1:00:00 ~ 3:00:00」
  },

  data: {
    hours: [],
    minutes: [],
    seconds: [],
    pickerValue: [0, 0, 0],
    preview: '0:00:00',     // 顶部大号预览，跟着滚轮实时变
  },

  observers: {
    'show': function (newVal) {
      if (newVal) this.init();
    },
  },

  methods: {
    init() {
      // 生成选项列表
      const hours = Array.from({ length: 10 }, (_, i) => String(i));
      const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
      const seconds = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

      // 解析当前值或默认值
      const timeStr = this.data.value || this.properties.defaultValue || '0:00:00';
      const parts = timeStr.split(':');
      let h = parseInt(parts[0]) || 0;
      let m = parseInt(parts[1]) || 0;
      let s = this.data.value ? (parseInt(parts[2]) || 0) : 30;
      h = Math.min(h, 9);
      m = Math.min(m, 59);
      s = Math.min(s, 59);

      const pv = [h, m, s];
      this.setData({ hours, minutes, seconds, pickerValue: pv }, () => this.updatePreview());
    },

    updatePreview() {
      const [h, m, s] = this.data.pickerValue;
      this.setData({
        preview: `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      });
    },

    onChange(e) {
      const [h, m, s] = e.detail.value;
      this.setData({ pickerValue: [h, m, s] }, () => this.updatePreview());
    },

    onCancel() {
      this.triggerEvent('cancel');
    },

    onConfirm() {
      const [h, m, s] = this.data.pickerValue;
      const total = h * 3600 + m * 60 + s;

      const min = this.properties.minSec || 0;
      const max = this.properties.maxSec || 0;
      const tip = this.properties.rangeTip;
      if (min && total < min) {
        wx.showToast({ title: tip ? `不合理，${tip}` : '成绩不合理，请检查', icon: 'none' });
        return;
      }
      if (max && total > max) {
        wx.showToast({ title: tip ? `不合理，${tip}` : '成绩不合理，请检查', icon: 'none' });
        return;
      }

      const value = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      this.triggerEvent('confirm', { value });
    },
  },
});
