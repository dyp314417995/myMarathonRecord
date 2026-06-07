// components/time-picker/index.js - 时间选择器 HH:MM:SS
Component({
  properties: {
    value: { type: String, value: '' },       // 当前值 "1:32:59"
    show: { type: Boolean, value: false },
    defaultValue: { type: String, value: '0:00:00' }, // 默认参照值
    label: { type: String, value: '选择时间' },
  },

  data: {
    hours: [],
    minutes: [],
    seconds: [],
    pickerValue: [0, 0, 0],
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
      let s = parseInt(parts[2]) || 0;
      h = Math.min(h, 9);
      m = Math.min(m, 59);
      s = Math.min(s, 59);

      this.setData({
        hours,
        minutes,
        seconds,
        pickerValue: [h, m, s],
      });
    },

    onChange(e) {
      const [h, m, s] = e.detail.value;
      this.setData({ pickerValue: [h, m, s] });
    },

    onCancel() {
      this.triggerEvent('cancel');
    },

    onConfirm() {
      const [h, m, s] = this.data.pickerValue;
      const value = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      this.triggerEvent('confirm', { value });
    },
  },
});
