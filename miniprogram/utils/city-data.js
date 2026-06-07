// utils/city-data.js - 中国省市区三级数据（精简版）

module.exports = [
  { name: '北京市', code: '110000', children: [
    { name: '北京市', code: '110100', children: [
      { name: '东城区' }, { name: '西城区' }, { name: '朝阳区' }, { name: '丰台区' },
      { name: '石景山区' }, { name: '海淀区' }, { name: '顺义区' }, { name: '通州区' },
      { name: '大兴区' }, { name: '房山区' }, { name: '昌平区' }, { name: '怀柔区' },
      { name: '平谷区' }, { name: '密云区' }, { name: '延庆区' }, { name: '门头沟区' },
    ]},
  ]},
  { name: '天津市', code: '120000', children: [
    { name: '天津市', code: '120100', children: [
      { name: '和平区' }, { name: '河东区' }, { name: '河西区' }, { name: '南开区' },
      { name: '河北区' }, { name: '红桥区' }, { name: '东丽区' }, { name: '西青区' },
      { name: '津南区' }, { name: '北辰区' }, { name: '武清区' }, { name: '宝坻区' },
      { name: '滨海新区' }, { name: '宁河区' }, { name: '静海区' }, { name: '蓟州区' },
    ]},
  ]},
  { name: '上海市', code: '310000', children: [
    { name: '上海市', code: '310100', children: [
      { name: '黄浦区' }, { name: '徐汇区' }, { name: '长宁区' }, { name: '静安区' },
      { name: '普陀区' }, { name: '虹口区' }, { name: '杨浦区' }, { name: '闵行区' },
      { name: '宝山区' }, { name: '嘉定区' }, { name: '浦东新区' }, { name: '金山区' },
      { name: '松江区' }, { name: '青浦区' }, { name: '奉贤区' }, { name: '崇明区' },
    ]},
  ]},
  { name: '重庆市', code: '500000', children: [
    { name: '重庆市', code: '500100', children: [
      { name: '万州区' }, { name: '涪陵区' }, { name: '渝中区' }, { name: '大渡口区' },
      { name: '江北区' }, { name: '沙坪坝区' }, { name: '九龙坡区' }, { name: '南岸区' },
      { name: '北碚区' }, { name: '綦江区' }, { name: '大足区' }, { name: '渝北区' },
      { name: '巴南区' }, { name: '黔江区' }, { name: '长寿区' }, { name: '江津区' },
      { name: '合川区' }, { name: '永川区' }, { name: '南川区' }, { name: '璧山区' },
      { name: '铜梁区' }, { name: '潼南区' }, { name: '荣昌区' }, { name: '开州区' },
      { name: '梁平区' }, { name: '武隆区' },
    ]},
  ]},
  { name: '河北省', code: '130000', children: [
    { name: '石家庄市', code: '130100', children: [
      { name: '长安区' }, { name: '桥西区' }, { name: '新华区' }, { name: '裕华区' },
      { name: '藁城区' }, { name: '鹿泉区' }, { name: '栾城区' },
    ]},
    { name: '唐山市', code: '130200', children: [
      { name: '路南区' }, { name: '路北区' }, { name: '古冶区' }, { name: '开平区' },
      { name: '丰南区' }, { name: '丰润区' }, { name: '曹妃甸区' },
    ]},
    { name: '秦皇岛市', code: '130300', children: [
      { name: '海港区' }, { name: '山海关区' }, { name: '北戴河区' }, { name: '抚宁区' },
    ]},
    { name: '邯郸市', code: '130400', children: [
      { name: '邯山区' }, { name: '丛台区' }, { name: '复兴区' }, { name: '峰峰矿区' },
      { name: '肥乡区' }, { name: '永年区' },
    ]},
    { name: '邢台市', code: '130500', children: [
      { name: '襄都区' }, { name: '信都区' }, { name: '任泽区' }, { name: '南和区' },
    ]},
    { name: '保定市', code: '130600', children: [
      { name: '竞秀区' }, { name: '莲池区' }, { name: '满城区' }, { name: '清苑区' },
      { name: '徐水区' },
    ]},
    { name: '张家口市', code: '130700', children: [
      { name: '桥东区' }, { name: '桥西区' }, { name: '宣化区' }, { name: '下花园区' },
      { name: '万全区' }, { name: '崇礼区' },
    ]},
    { name: '承德市', code: '130800', children: [
      { name: '双桥区' }, { name: '双滦区' }, { name: '鹰手营子矿区' },
    ]},
    { name: '沧州市', code: '130900', children: [
      { name: '新华区' }, { name: '运河区' },
    ]},
    { name: '廊坊市', code: '131000', children: [
      { name: '安次区' }, { name: '广阳区' },
    ]},
    { name: '衡水市', code: '131100', children: [
      { name: '桃城区' }, { name: '冀州区' },
    ]},
  ]},
  { name: '山西省', code: '140000', children: [
    { name: '太原市', code: '140100', children: [
      { name: '小店区' }, { name: '迎泽区' }, { name: '杏花岭区' }, { name: '尖草坪区' },
      { name: '万柏林区' }, { name: '晋源区' },
    ]},
    { name: '大同市', code: '140200', children: [
      { name: '平城区' }, { name: '云冈区' }, { name: '新荣区' }, { name: '云州区' },
    ]},
    { name: '阳泉市', code: '140300', children: [
      { name: '城区' }, { name: '矿区' }, { name: '郊区' },
    ]},
    { name: '长治市', code: '140400', children: [
      { name: '潞州区' }, { name: '上党区' }, { name: '屯留区' }, { name: '潞城区' },
    ]},
    { name: '晋城市', code: '140500', children: [ { name: '城区' } ]},
    { name: '朔州市', code: '140600', children: [ { name: '朔城区' }, { name: '平鲁区' } ]},
    { name: '晋中市', code: '140700', children: [ { name: '榆次区' }, { name: '太谷区' } ]},
    { name: '运城市', code: '140800', children: [ { name: '盐湖区' } ]},
    { name: '忻州市', code: '140900', children: [ { name: '忻府区' } ]},
    { name: '临汾市', code: '141000', children: [ { name: '尧都区' } ]},
    { name: '吕梁市', code: '141100', children: [ { name: '离石区' } ]},
  ]},
  { name: '内蒙古', code: '150000', children: [
    { name: '呼和浩特市', code: '150100', children: [
      { name: '新城区' }, { name: '回民区' }, { name: '玉泉区' }, { name: '赛罕区' },
    ]},
    { name: '包头市', code: '150200', children: [
      { name: '东河区' }, { name: '昆都仑区' }, { name: '青山区' }, { name: '石拐区' },
      { name: '白云矿区' }, { name: '九原区' },
    ]},
    { name: '乌海市', code: '150300', children: [ { name: '海勃湾区' }, { name: '海南区' }, { name: '乌达区' } ]},
    { name: '赤峰市', code: '150400', children: [ { name: '红山区' }, { name: '元宝山区' }, { name: '松山区' } ]},
    { name: '通辽市', code: '150500', children: [ { name: '科尔沁区' } ]},
    { name: '鄂尔多斯市', code: '150600', children: [ { name: '东胜区' }, { name: '康巴什区' } ]},
    { name: '呼伦贝尔市', code: '150700', children: [ { name: '海拉尔区' }, { name: '扎赉诺尔区' } ]},
    { name: '巴彦淖尔市', code: '150800', children: [ { name: '临河区' } ]},
    { name: '乌兰察布市', code: '150900', children: [ { name: '集宁区' } ]},
  ]},
  { name: '辽宁省', code: '210000', children: [
    { name: '沈阳市', code: '210100', children: [
      { name: '和平区' }, { name: '沈河区' }, { name: '大东区' }, { name: '皇姑区' },
      { name: '铁西区' }, { name: '苏家屯区' }, { name: '浑南区' }, { name: '沈北新区' },
      { name: '于洪区' }, { name: '辽中区' },
    ]},
    { name: '大连市', code: '210200', children: [
      { name: '中山区' }, { name: '西岗区' }, { name: '沙河口区' }, { name: '甘井子区' },
      { name: '旅顺口区' }, { name: '金州区' }, { name: '普兰店区' },
    ]},
    { name: '鞍山市', code: '210300', children: [ { name: '铁东区' }, { name: '铁西区' }, { name: '立山区' }, { name: '千山区' } ]},
    { name: '抚顺市', code: '210400', children: [ { name: '新抚区' }, { name: '东洲区' }, { name: '望花区' }, { name: '顺城区' } ]},
    { name: '本溪市', code: '210500', children: [ { name: '平山区' }, { name: '溪湖区' }, { name: '明山区' }, { name: '南芬区' } ]},
    { name: '丹东市', code: '210600', children: [ { name: '元宝区' }, { name: '振兴区' }, { name: '振安区' } ]},
    { name: '锦州市', code: '210700', children: [ { name: '古塔区' }, { name: '凌河区' }, { name: '太和区' } ]},
    { name: '营口市', code: '210800', children: [ { name: '站前区' }, { name: '西市区' }, { name: '鲅鱼圈区' }, { name: '老边区' } ]},
    { name: '阜新市', code: '210900', children: [ { name: '海州区' }, { name: '新邱区' }, { name: '太平区' }, { name: '细河区' } ]},
    { name: '辽阳市', code: '211000', children: [ { name: '白塔区' }, { name: '文圣区' }, { name: '宏伟区' }, { name: '弓长岭区' } ]},
    { name: '盘锦市', code: '211100', children: [ { name: '双台子区' }, { name: '兴隆台区' }, { name: '大洼区' } ]},
    { name: '铁岭市', code: '211200', children: [ { name: '银州区' }, { name: '清河区' } ]},
    { name: '朝阳市', code: '211300', children: [ { name: '双塔区' }, { name: '龙城区' } ]},
    { name: '葫芦岛市', code: '211400', children: [ { name: '连山区' }, { name: '龙港区' }, { name: '南票区' } ]},
  ]},
  { name: '吉林省', code: '220000', children: [
    { name: '长春市', code: '220100', children: [
      { name: '南关区' }, { name: '宽城区' }, { name: '朝阳区' }, { name: '二道区' },
      { name: '绿园区' }, { name: '双阳区' }, { name: '九台区' },
    ]},
    { name: '吉林市', code: '220200', children: [
      { name: '昌邑区' }, { name: '龙潭区' }, { name: '船营区' }, { name: '丰满区' },
    ]},
    { name: '四平市', code: '220300', children: [ { name: '铁西区' }, { name: '铁东区' } ]},
    { name: '辽源市', code: '220400', children: [ { name: '龙山区' }, { name: '西安区' } ]},
    { name: '通化市', code: '220500', children: [ { name: '东昌区' }, { name: '二道江区' } ]},
    { name: '白山市', code: '220600', children: [ { name: '浑江区' }, { name: '江源区' } ]},
    { name: '松原市', code: '220700', children: [ { name: '宁江区' } ]},
    { name: '白城市', code: '220800', children: [ { name: '洮北区' } ]},
  ]},
  { name: '黑龙江省', code: '230000', children: [
    { name: '哈尔滨市', code: '230100', children: [
      { name: '道里区' }, { name: '南岗区' }, { name: '道外区' }, { name: '平房区' },
      { name: '松北区' }, { name: '香坊区' }, { name: '呼兰区' }, { name: '阿城区' },
    ]},
    { name: '齐齐哈尔市', code: '230200', children: [
      { name: '龙沙区' }, { name: '建华区' }, { name: '铁锋区' }, { name: '昂昂溪区' },
      { name: '富拉尔基区' }, { name: '碾子山区' }, { name: '梅里斯区' },
    ]},
    { name: '鸡西市', code: '230300', children: [ { name: '鸡冠区' }, { name: '恒山区' }, { name: '滴道区' }, { name: '梨树区' }, { name: '城子河区' }, { name: '麻山区' } ]},
    { name: '鹤岗市', code: '230400', children: [ { name: '向阳区' }, { name: '工农区' }, { name: '南山区' }, { name: '兴安区' }, { name: '东山区' }, { name: '兴山区' } ]},
    { name: '双鸭山市', code: '230500', children: [ { name: '尖山区' }, { name: '岭东区' }, { name: '四方台区' }, { name: '宝山区' } ]},
    { name: '大庆市', code: '230600', children: [ { name: '萨尔图区' }, { name: '龙凤区' }, { name: '让胡路区' }, { name: '红岗区' }, { name: '大同区' } ]},
    { name: '伊春市', code: '230700', children: [ { name: '伊美区' }, { name: '乌翠区' }, { name: '友好区' }, { name: '金林区' } ]},
    { name: '佳木斯市', code: '230800', children: [ { name: '向阳区' }, { name: '前进区' }, { name: '东风区' }, { name: '郊区' } ]},
    { name: '牡丹江市', code: '231000', children: [ { name: '东安区' }, { name: '阳明区' }, { name: '爱民区' }, { name: '西安区' } ]},
  ]},
  { name: '江苏省', code: '320000', children: [
    { name: '南京市', code: '320100', children: [
      { name: '玄武区' }, { name: '秦淮区' }, { name: '建邺区' }, { name: '鼓楼区' },
      { name: '浦口区' }, { name: '栖霞区' }, { name: '雨花台区' }, { name: '江宁区' },
      { name: '六合区' }, { name: '溧水区' }, { name: '高淳区' },
    ]},
    { name: '无锡市', code: '320200', children: [
      { name: '锡山区' }, { name: '惠山区' }, { name: '滨湖区' }, { name: '梁溪区' }, { name: '新吴区' },
    ]},
    { name: '徐州市', code: '320300', children: [
      { name: '鼓楼区' }, { name: '云龙区' }, { name: '贾汪区' }, { name: '泉山区' }, { name: '铜山区' },
    ]},
    { name: '常州市', code: '320400', children: [
      { name: '天宁区' }, { name: '钟楼区' }, { name: '新北区' }, { name: '武进区' }, { name: '金坛区' },
    ]},
    { name: '苏州市', code: '320500', children: [
      { name: '虎丘区' }, { name: '吴中区' }, { name: '相城区' }, { name: '姑苏区' }, { name: '吴江区' },
    ]},
    { name: '南通市', code: '320600', children: [
      { name: '崇川区' }, { name: '通州区' }, { name: '海门区' },
    ]},
    { name: '连云港市', code: '320700', children: [
      { name: '连云区' }, { name: '海州区' }, { name: '赣榆区' },
    ]},
    { name: '淮安市', code: '320800', children: [
      { name: '淮安区' }, { name: '淮阴区' }, { name: '清江浦区' }, { name: '洪泽区' },
    ]},
    { name: '盐城市', code: '320900', children: [
      { name: '亭湖区' }, { name: '盐都区' }, { name: '大丰区' },
    ]},
    { name: '扬州市', code: '321000', children: [
      { name: '广陵区' }, { name: '邗江区' }, { name: '江都区' },
    ]},
    { name: '镇江市', code: '321100', children: [
      { name: '京口区' }, { name: '润州区' }, { name: '丹徒区' },
    ]},
    { name: '泰州市', code: '321200', children: [
      { name: '海陵区' }, { name: '高港区' }, { name: '姜堰区' },
    ]},
    { name: '宿迁市', code: '321300', children: [
      { name: '宿城区' }, { name: '宿豫区' },
    ]},
  ]},
  { name: '浙江省', code: '330000', children: [
    { name: '杭州市', code: '330100', children: [
      { name: '上城区' }, { name: '拱墅区' }, { name: '西湖区' }, { name: '滨江区' },
      { name: '萧山区' }, { name: '余杭区' }, { name: '富阳区' }, { name: '临安区' },
      { name: '临平区' }, { name: '钱塘区' },
    ]},
    { name: '宁波市', code: '330200', children: [
      { name: '海曙区' }, { name: '江北区' }, { name: '北仑区' }, { name: '镇海区' },
      { name: '鄞州区' }, { name: '奉化区' },
    ]},
    { name: '温州市', code: '330300', children: [
      { name: '鹿城区' }, { name: '龙湾区' }, { name: '瓯海区' }, { name: '洞头区' },
    ]},
    { name: '嘉兴市', code: '330400', children: [
      { name: '南湖区' }, { name: '秀洲区' },
    ]},
    { name: '湖州市', code: '330500', children: [
      { name: '吴兴区' }, { name: '南浔区' },
    ]},
    { name: '绍兴市', code: '330600', children: [
      { name: '越城区' }, { name: '柯桥区' }, { name: '上虞区' },
    ]},
    { name: '金华市', code: '330700', children: [
      { name: '婺城区' }, { name: '金东区' },
    ]},
    { name: '衢州市', code: '330800', children: [
      { name: '柯城区' }, { name: '衢江区' },
    ]},
    { name: '舟山市', code: '330900', children: [
      { name: '定海区' }, { name: '普陀区' },
    ]},
    { name: '台州市', code: '331000', children: [
      { name: '椒江区' }, { name: '黄岩区' }, { name: '路桥区' },
    ]},
    { name: '丽水市', code: '331100', children: [
      { name: '莲都区' },
    ]},
  ]},
  { name: '安徽省', code: '340000', children: [
    { name: '合肥市', code: '340100', children: [
      { name: '瑶海区' }, { name: '庐阳区' }, { name: '蜀山区' }, { name: '包河区' },
    ]},
    { name: '芜湖市', code: '340200', children: [
      { name: '镜湖区' }, { name: '弋江区' }, { name: '鸠江区' }, { name: '湾沚区' },
    ]},
    { name: '蚌埠市', code: '340300', children: [
      { name: '龙子湖区' }, { name: '蚌山区' }, { name: '禹会区' }, { name: '淮上区' },
    ]},
    { name: '淮南市', code: '340400', children: [
      { name: '大通区' }, { name: '田家庵区' }, { name: '谢家集区' }, { name: '八公山区' }, { name: '潘集区' },
    ]},
    { name: '马鞍山市', code: '340500', children: [
      { name: '花山区' }, { name: '雨山区' }, { name: '博望区' },
    ]},
    { name: '淮北市', code: '340600', children: [
      { name: '杜集区' }, { name: '相山区' }, { name: '烈山区' },
    ]},
    { name: '铜陵市', code: '340700', children: [
      { name: '铜官区' }, { name: '义安区' }, { name: '郊区' },
    ]},
    { name: '安庆市', code: '340800', children: [
      { name: '迎江区' }, { name: '大观区' }, { name: '宜秀区' },
    ]},
  ]},
  { name: '福建省', code: '350000', children: [
    { name: '福州市', code: '350100', children: [
      { name: '鼓楼区' }, { name: '台江区' }, { name: '仓山区' }, { name: '马尾区' },
      { name: '晋安区' }, { name: '长乐区' },
    ]},
    { name: '厦门市', code: '350200', children: [
      { name: '思明区' }, { name: '海沧区' }, { name: '湖里区' }, { name: '集美区' },
      { name: '同安区' }, { name: '翔安区' },
    ]},
    { name: '莆田市', code: '350300', children: [
      { name: '城厢区' }, { name: '涵江区' }, { name: '荔城区' }, { name: '秀屿区' },
    ]},
    { name: '泉州市', code: '350500', children: [
      { name: '鲤城区' }, { name: '丰泽区' }, { name: '洛江区' }, { name: '泉港区' },
    ]},
    { name: '漳州市', code: '350600', children: [
      { name: '芗城区' }, { name: '龙文区' }, { name: '龙海区' }, { name: '长泰区' },
    ]},
  ]},
  { name: '江西省', code: '360000', children: [
    { name: '南昌市', code: '360100', children: [
      { name: '东湖区' }, { name: '西湖区' }, { name: '青云谱区' }, { name: '青山湖区' },
      { name: '新建区' }, { name: '红谷滩区' },
    ]},
    { name: '景德镇市', code: '360200', children: [
      { name: '昌江区' }, { name: '珠山区' },
    ]},
    { name: '萍乡市', code: '360300', children: [
      { name: '安源区' }, { name: '湘东区' },
    ]},
    { name: '九江市', code: '360400', children: [
      { name: '濂溪区' }, { name: '浔阳区' }, { name: '柴桑区' },
    ]},
    { name: '赣州市', code: '360700', children: [
      { name: '章贡区' }, { name: '南康区' }, { name: '赣县区' },
    ]},
  ]},
  { name: '山东省', code: '370000', children: [
    { name: '济南市', code: '370100', children: [
      { name: '历下区' }, { name: '市中区' }, { name: '槐荫区' }, { name: '天桥区' },
      { name: '历城区' }, { name: '长清区' }, { name: '章丘区' }, { name: '济阳区' },
      { name: '莱芜区' }, { name: '钢城区' },
    ]},
    { name: '青岛市', code: '370200', children: [
      { name: '市南区' }, { name: '市北区' }, { name: '黄岛区' }, { name: '崂山区' },
      { name: '李沧区' }, { name: '城阳区' }, { name: '即墨区' },
    ]},
    { name: '淄博市', code: '370300', children: [
      { name: '淄川区' }, { name: '张店区' }, { name: '博山区' }, { name: '临淄区' }, { name: '周村区' },
    ]},
    { name: '枣庄市', code: '370400', children: [
      { name: '市中区' }, { name: '薛城区' }, { name: '峄城区' }, { name: '台儿庄区' }, { name: '山亭区' },
    ]},
    { name: '东营市', code: '370500', children: [
      { name: '东营区' }, { name: '河口区' }, { name: '垦利区' },
    ]},
    { name: '烟台市', code: '370600', children: [
      { name: '芝罘区' }, { name: '福山区' }, { name: '牟平区' }, { name: '莱山区' }, { name: '蓬莱区' },
    ]},
    { name: '潍坊市', code: '370700', children: [
      { name: '潍城区' }, { name: '寒亭区' }, { name: '坊子区' }, { name: '奎文区' },
    ]},
    { name: '济宁市', code: '370800', children: [
      { name: '任城区' }, { name: '兖州区' },
    ]},
    { name: '泰安市', code: '370900', children: [
      { name: '泰山区' }, { name: '岱岳区' },
    ]},
    { name: '威海市', code: '371000', children: [
      { name: '环翠区' }, { name: '文登区' },
    ]},
    { name: '日照市', code: '371100', children: [
      { name: '东港区' }, { name: '岚山区' },
    ]},
    { name: '临沂市', code: '371300', children: [
      { name: '兰山区' }, { name: '罗庄区' }, { name: '河东区' },
    ]},
    { name: '德州市', code: '371400', children: [
      { name: '德城区' }, { name: '陵城区' },
    ]},
    { name: '聊城市', code: '371500', children: [
      { name: '东昌府区' }, { name: '茌平区' },
    ]},
    { name: '滨州市', code: '371600', children: [
      { name: '滨城区' }, { name: '沾化区' },
    ]},
    { name: '菏泽市', code: '371700', children: [
      { name: '牡丹区' }, { name: '定陶区' },
    ]},
  ]},
  { name: '河南省', code: '410000', children: [
    { name: '郑州市', code: '410100', children: [
      { name: '中原区' }, { name: '二七区' }, { name: '管城区' }, { name: '金水区' },
      { name: '上街区' }, { name: '惠济区' },
    ]},
    { name: '开封市', code: '410200', children: [
      { name: '龙亭区' }, { name: '顺河区' }, { name: '鼓楼区' }, { name: '禹王台区' }, { name: '祥符区' },
    ]},
    { name: '洛阳市', code: '410300', children: [
      { name: '老城区' }, { name: '西工区' }, { name: '瀍河区' }, { name: '涧西区' }, { name: '洛龙区' },
    ]},
    { name: '平顶山市', code: '410400', children: [
      { name: '新华区' }, { name: '卫东区' }, { name: '石龙区' }, { name: '湛河区' },
    ]},
    { name: '安阳市', code: '410500', children: [
      { name: '文峰区' }, { name: '北关区' }, { name: '殷都区' }, { name: '龙安区' },
    ]},
    { name: '新乡市', code: '410700', children: [
      { name: '红旗区' }, { name: '卫滨区' }, { name: '凤泉区' }, { name: '牧野区' },
    ]},
    { name: '焦作市', code: '410800', children: [
      { name: '解放区' }, { name: '中站区' }, { name: '马村区' }, { name: '山阳区' },
    ]},
  ]},
  { name: '湖北省', code: '420000', children: [
    { name: '武汉市', code: '420100', children: [
      { name: '江岸区' }, { name: '江汉区' }, { name: '硚口区' }, { name: '汉阳区' },
      { name: '武昌区' }, { name: '青山区' }, { name: '洪山区' }, { name: '东西湖区' },
      { name: '汉南区' }, { name: '蔡甸区' }, { name: '江夏区' }, { name: '黄陂区' },
      { name: '新洲区' },
    ]},
    { name: '宜昌市', code: '420500', children: [
      { name: '西陵区' }, { name: '伍家岗区' }, { name: '点军区' }, { name: '猇亭区' }, { name: '夷陵区' },
    ]},
    { name: '襄阳市', code: '420600', children: [
      { name: '襄城区' }, { name: '樊城区' }, { name: '襄州区' },
    ]},
  ]},
  { name: '湖南省', code: '430000', children: [
    { name: '长沙市', code: '430100', children: [
      { name: '芙蓉区' }, { name: '天心区' }, { name: '岳麓区' }, { name: '开福区' },
      { name: '雨花区' }, { name: '望城区' },
    ]},
    { name: '株洲市', code: '430200', children: [
      { name: '荷塘区' }, { name: '芦淞区' }, { name: '石峰区' }, { name: '天元区' },
    ]},
    { name: '湘潭市', code: '430300', children: [
      { name: '雨湖区' }, { name: '岳塘区' },
    ]},
  ]},
  { name: '广东省', code: '440000', children: [
    { name: '广州市', code: '440100', children: [
      { name: '荔湾区' }, { name: '越秀区' }, { name: '海珠区' }, { name: '天河区' },
      { name: '白云区' }, { name: '黄埔区' }, { name: '番禺区' }, { name: '花都区' },
      { name: '南沙区' }, { name: '从化区' }, { name: '增城区' },
    ]},
    { name: '深圳市', code: '440300', children: [
      { name: '罗湖区' }, { name: '福田区' }, { name: '南山区' }, { name: '宝安区' },
      { name: '龙岗区' }, { name: '盐田区' }, { name: '龙华区' }, { name: '坪山区' },
      { name: '光明区' },
    ]},
    { name: '珠海市', code: '440400', children: [
      { name: '香洲区' }, { name: '斗门区' }, { name: '金湾区' },
    ]},
    { name: '汕头市', code: '440500', children: [
      { name: '龙湖区' }, { name: '金平区' }, { name: '濠江区' }, { name: '潮阳区' }, { name: '潮南区' }, { name: '澄海区' },
    ]},
    { name: '佛山市', code: '440600', children: [
      { name: '禅城区' }, { name: '南海区' }, { name: '顺德区' }, { name: '三水区' }, { name: '高明区' },
    ]},
    { name: '东莞市', code: '441900', children: [
      { name: '莞城区' }, { name: '南城区' }, { name: '东城区' }, { name: '万江区' },
    ]},
    { name: '中山市', code: '442000', children: [ { name: '石岐区' }, { name: '东区' }, { name: '西区' }, { name: '南区' } ]},
    { name: '惠州市', code: '441300', children: [
      { name: '惠城区' }, { name: '惠阳区' },
    ]},
  ]},
  { name: '广西', code: '450000', children: [
    { name: '南宁市', code: '450100', children: [
      { name: '兴宁区' }, { name: '青秀区' }, { name: '江南区' }, { name: '西乡塘区' },
      { name: '良庆区' }, { name: '邕宁区' }, { name: '武鸣区' },
    ]},
    { name: '柳州市', code: '450200', children: [
      { name: '城中区' }, { name: '鱼峰区' }, { name: '柳南区' }, { name: '柳北区' },
    ]},
    { name: '桂林市', code: '450300', children: [
      { name: '秀峰区' }, { name: '叠彩区' }, { name: '象山区' }, { name: '七星区' },
      { name: '雁山区' }, { name: '临桂区' },
    ]},
  ]},
  { name: '海南省', code: '460000', children: [
    { name: '海口市', code: '460100', children: [
      { name: '秀英区' }, { name: '龙华区' }, { name: '琼山区' }, { name: '美兰区' },
    ]},
    { name: '三亚市', code: '460200', children: [
      { name: '海棠区' }, { name: '吉阳区' }, { name: '天涯区' }, { name: '崖州区' },
    ]},
  ]},
  { name: '四川省', code: '510000', children: [
    { name: '成都市', code: '510100', children: [
      { name: '锦江区' }, { name: '青羊区' }, { name: '金牛区' }, { name: '武侯区' },
      { name: '成华区' }, { name: '龙泉驿区' }, { name: '青白江区' }, { name: '新都区' },
      { name: '温江区' }, { name: '双流区' }, { name: '郫都区' }, { name: '新津区' },
    ]},
    { name: '绵阳市', code: '510700', children: [
      { name: '涪城区' }, { name: '游仙区' }, { name: '安州区' },
    ]},
  ]},
  { name: '贵州省', code: '520000', children: [
    { name: '贵阳市', code: '520100', children: [
      { name: '南明区' }, { name: '云岩区' }, { name: '花溪区' }, { name: '乌当区' },
      { name: '白云区' }, { name: '观山湖区' },
    ]},
    { name: '遵义市', code: '520300', children: [
      { name: '红花岗区' }, { name: '汇川区' }, { name: '播州区' },
    ]},
  ]},
  { name: '云南省', code: '530000', children: [
    { name: '昆明市', code: '530100', children: [
      { name: '五华区' }, { name: '盘龙区' }, { name: '官渡区' }, { name: '西山区' },
      { name: '东川区' }, { name: '呈贡区' }, { name: '晋宁区' },
    ]},
  ]},
  { name: '西藏', code: '540000', children: [
    { name: '拉萨市', code: '540100', children: [
      { name: '城关区' }, { name: '堆龙德庆区' }, { name: '达孜区' },
    ]},
  ]},
  { name: '陕西省', code: '610000', children: [
    { name: '西安市', code: '610100', children: [
      { name: '新城区' }, { name: '碑林区' }, { name: '莲湖区' }, { name: '灞桥区' },
      { name: '未央区' }, { name: '雁塔区' }, { name: '阎良区' }, { name: '临潼区' },
      { name: '长安区' }, { name: '高陵区' }, { name: '鄠邑区' },
    ]},
  ]},
  { name: '甘肃省', code: '620000', children: [
    { name: '兰州市', code: '620100', children: [
      { name: '城关区' }, { name: '七里河区' }, { name: '西固区' }, { name: '安宁区' },
      { name: '红古区' },
    ]},
  ]},
  { name: '青海省', code: '630000', children: [
    { name: '西宁市', code: '630100', children: [
      { name: '城东区' }, { name: '城中区' }, { name: '城西区' }, { name: '城北区' },
    ]},
  ]},
  { name: '宁夏', code: '640000', children: [
    { name: '银川市', code: '640100', children: [
      { name: '兴庆区' }, { name: '西夏区' }, { name: '金凤区' }, { name: '灵武市' },
    ]},
  ]},
  { name: '新疆', code: '650000', children: [
    { name: '乌鲁木齐市', code: '650100', children: [
      { name: '天山区' }, { name: '沙依巴克区' }, { name: '新市区' }, { name: '水磨沟区' },
      { name: '头屯河区' }, { name: '达坂城区' }, { name: '米东区' },
    ]},
  ]},
  { name: '台湾省', code: '710000', children: [
    { name: '台北市', code: '710100', children: [
      { name: '中正区' }, { name: '大同区' }, { name: '中山区' }, { name: '松山区' },
      { name: '大安区' }, { name: '万华区' }, { name: '信义区' }, { name: '士林区' },
      { name: '北投区' }, { name: '内湖区' }, { name: '南港区' }, { name: '文山区' },
    ]},
  ]},
  { name: '香港', code: '810000', children: [
    { name: '香港岛', code: '810100', children: [
      { name: '中西区' }, { name: '湾仔区' }, { name: '东区' }, { name: '南区' },
    ]},
    { name: '九龙', code: '810200', children: [
      { name: '油尖旺区' }, { name: '深水埗区' }, { name: '九龙城区' }, { name: '黄大仙区' }, { name: '观塘区' },
    ]},
    { name: '新界', code: '810300', children: [
      { name: '荃湾区' }, { name: '屯门区' }, { name: '元朗区' }, { name: '北区' },
      { name: '大埔区' }, { name: '西贡区' }, { name: '沙田区' }, { name: '葵青区' },
    ]},
  ]},
  { name: '澳门', code: '820000', children: [
    { name: '澳门半岛', code: '820100', children: [
      { name: '花地玛堂区' }, { name: '圣安多尼堂区' }, { name: '大堂区' }, { name: '望德堂区' }, { name: '风顺堂区' },
    ]},
    { name: '离岛', code: '820200', children: [
      { name: '嘉模堂区' }, { name: '圣方济各堂区' },
    ]},
  ]},
];
