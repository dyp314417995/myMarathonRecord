// components/city-picker/index.js - 省市区三级联动选择器
const cityData = require('../../utils/city-data');

Component({
  properties: {
    value: { type: String, value: '' },   // 当前城市文本
    show: { type: Boolean, value: false }, // 是否显示
  },

  data: {
    provinces: [],      // 省列表（扁平化名称）
    cities: [],         // 当前省下的市列表
    districts: [],      // 当前市下的区列表
    pickerValue: [0, 0, 0],  // 当前选中的列索引
    result: '',         // 拼接结果: 省-市-区
  },

  observers: {
    'show': function (newVal) {
      if (newVal) {
        this.initPicker();
      }
    },
  },

  methods: {
    initPicker() {
      const provinces = cityData.map(p => p.name);
      const cities = (cityData[0] && cityData[0].children) ? cityData[0].children.map(c => c.name) : [];
      const districts = (cities.length > 0 && cityData[0].children[0] && cityData[0].children[0].children)
        ? cityData[0].children[0].children.map(d => d.name)
        : [];

      // 根据已有 value 反查定位
      let pickerValue = [0, 0, 0];
      const currentValue = this.data.value || this.data.result || '';
      if (currentValue) {
        const parts = currentValue.split('-');
        if (parts.length >= 1) {
          const pi = provinces.indexOf(parts[0]);
          if (pi >= 0) {
            pickerValue[0] = pi;
            const cityList = cityData[pi].children.map(c => c.name);
            if (parts.length >= 2) {
              const ci = cityList.indexOf(parts[1]);
              if (ci >= 0) {
                pickerValue[1] = ci;
                const districtList = cityData[pi].children[ci].children.map(d => d.name);
                if (parts.length >= 3) {
                  const di = districtList.indexOf(parts[2]);
                  if (di >= 0) pickerValue[2] = di;
                }
              }
            }
          }
        }
      }

      // 重新获取对应列数据
      const pi = pickerValue[0];
      const ci = pickerValue[1];
      const di = pickerValue[2];
      const cityList = cityData[pi].children.map(c => c.name);
      const districtList = cityData[pi].children[ci].children.map(d => d.name);

      const result = provinces[pi] + '-' + cityList[ci] + '-' + (districtList[di] || '');

      this.setData({
        provinces,
        cities: cityList,
        districts: districtList,
        pickerValue,
        result,
      });
    },

    // 列变化
    onColumnChange(e) {
      const { column, value } = e.detail;
      const pickerValue = [...this.data.pickerValue];
      pickerValue[column] = value;

      if (column === 0) {
        // 省变了，重置市和区
        pickerValue[1] = 0;
        pickerValue[2] = 0;
        const cityList = cityData[value].children.map(c => c.name);
        const districtList = cityData[value].children[0].children.map(d => d.name);
        const result = this.data.provinces[value] + '-' + cityList[0] + '-' + (districtList[0] || '');
        this.setData({
          cities: cityList,
          districts: districtList,
          pickerValue,
          result,
        });
      } else if (column === 1) {
        // 市变了，重置区
        pickerValue[2] = 0;
        const pi = pickerValue[0];
        const districtList = cityData[pi].children[value].children.map(d => d.name);
        const result = this.data.provinces[pi] + '-' + this.data.cities[value] + '-' + (districtList[0] || '');
        this.setData({
          districts: districtList,
          pickerValue,
          result,
        });
      } else if (column === 2) {
        const pi = pickerValue[0];
        const ci = pickerValue[1];
        const result = this.data.provinces[pi] + '-' + this.data.cities[ci] + '-' + (this.data.districts[value] || '');
        this.setData({ pickerValue, result });
      }
    },

    // 取消
    onCancel() {
      this.triggerEvent('cancel');
    },

    // 确认
    onConfirm() {
      this.triggerEvent('confirm', { value: this.data.result });
    },
  },
});
