# 马拉松数据总览

## 待新增（18场）

| 赛事 | 赛事组 | 日期 | 规模 | 等级 |
|------|--------|------|------|------|
| 北京马拉松2026 | 北京马拉松 | 11/1 | 30000人 | A |
| 广州马拉松2026 | 广州马拉松 | 12/14 | 30000人 | A |
| 重庆马拉松2026 | 重庆马拉松 | 3/15 | 30000人 | A |
| 杭州马拉松2026 | 杭州马拉松 | 11/8 | 36000人 | A |
| 南京马拉松2026 | 南京马拉松 | 11/1 | 30000人 | A |
| 西安马拉松2026 | 西安马拉松 | 10/18 | 35000人 | A |
| 深圳马拉松2026 | 深圳马拉松 | 12/6 | 30000人 | A |
| 沈阳马拉松2026 | 沈阳马拉松 | 9/13 | 20000人 | A |
| 哈尔滨马拉松2026 | 哈尔滨马拉松 | 8/23 | 20000人 | A |
| 长沙马拉松2026 | 长沙马拉松 | 10/25 | 30000人 | A |
| 郑州马拉松2026 | 郑州马拉松 | 10/11 | 20000人 | A |
| 济南马拉松2026 | 济南马拉松 | 10/25 | 20000人 | A |
| 南宁马拉松2026 | 南宁马拉松 | 12/6 | 20000人 | A |
| 无锡马拉松2026 | 无锡马拉松 | 3/22 | 33000人 | A |
| 大连马拉松2026 | 大连马拉松 | 5/10 | 20000人 | A |
| 苏州太湖马拉松2026 | 苏州太湖马拉松 | 11/15 | 20000人 | A |
| 绍兴马拉松2026 | 绍兴马拉松 | 11/8 | 25000人 | A |
| 青岛马拉松2026 | 青岛马拉松 | 4/19 | 25000人 | A |

---

## 插入脚本

云开发控制台 > race_events > 高级操作，逐条执行。

```
db.collection('race_events').add({ data: { name:'北京马拉松2026', raceGroup:'北京马拉松', province:'北京', city:'北京', raceType:'full', raceTypes:['full'], label:'金标', mechanism:'抽签', payment:'中签后缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-11-01T00:00:00.000Z', scale:'30000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-11-01',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'广州马拉松2026', raceGroup:'广州马拉松', province:'广东', city:'广州', raceType:'full', raceTypes:['full'], label:'金标', mechanism:'抽签', payment:'中签后缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-12-14T00:00:00.000Z', scale:'30000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-12-14',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'重庆马拉松2026', raceGroup:'重庆马拉松', province:'重庆', city:'重庆', raceType:'full', raceTypes:['full'], label:'金标', mechanism:'抽签', payment:'中签后缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-03-15T00:00:00.000Z', scale:'30000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-03-15',time:'07:30'}], tags:[], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'杭州马拉松2026', raceGroup:'杭州马拉松', province:'浙江', city:'杭州', raceType:'full', raceTypes:['full'], label:'金标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-11-08T00:00:00.000Z', scale:'36000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-11-08',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'南京马拉松2026', raceGroup:'南京马拉松', province:'江苏', city:'南京', raceType:'full', raceTypes:['full'], label:'金标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-11-01T00:00:00.000Z', scale:'30000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-11-01',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'西安马拉松2026', raceGroup:'西安马拉松', province:'陕西', city:'西安', raceType:'full', raceTypes:['full'], label:'金标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-10-18T00:00:00.000Z', scale:'35000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-10-18',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'深圳马拉松2026', raceGroup:'深圳马拉松', province:'广东', city:'深圳', raceType:'full', raceTypes:['full'], label:'金标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-12-06T00:00:00.000Z', scale:'30000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-12-06',time:'07:30'}], tags:['PB赛道'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'沈阳马拉松2026', raceGroup:'沈阳马拉松', province:'辽宁', city:'沈阳', raceType:'full', raceTypes:['full'], label:'普通标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-09-13T00:00:00.000Z', scale:'20000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-09-13',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'哈尔滨马拉松2026', raceGroup:'哈尔滨马拉松', province:'黑龙江', city:'哈尔滨', raceType:'full', raceTypes:['full'], label:'普通标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-08-23T00:00:00.000Z', scale:'20000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-08-23',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'长沙马拉松2026', raceGroup:'长沙马拉松', province:'湖南', city:'长沙', raceType:'full', raceTypes:['full'], label:'金标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-10-25T00:00:00.000Z', scale:'30000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-10-25',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'郑州马拉松2026', raceGroup:'郑州马拉松', province:'河南', city:'郑州', raceType:'full', raceTypes:['full'], label:'普通标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-10-11T00:00:00.000Z', scale:'20000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-10-11',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'济南马拉松2026', raceGroup:'济南马拉松', province:'山东', city:'济南', raceType:'full', raceTypes:['full'], label:'普通标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-10-25T00:00:00.000Z', scale:'20000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-10-25',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'南宁马拉松2026', raceGroup:'南宁马拉松', province:'广西', city:'南宁', raceType:'full', raceTypes:['full'], label:'普通标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-12-06T00:00:00.000Z', scale:'20000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-12-06',time:'07:30'}], tags:['省会'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'无锡马拉松2026', raceGroup:'无锡马拉松', province:'江苏', city:'无锡', raceType:'full', raceTypes:['full'], label:'金标', mechanism:'抽签', payment:'中签后缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-03-22T00:00:00.000Z', scale:'33000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-03-22',time:'07:30'}], tags:['PB赛道','A1认证'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'大连马拉松2026', raceGroup:'大连马拉松', province:'辽宁', city:'大连', raceType:'full', raceTypes:['full'], label:'普通标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-05-10T00:00:00.000Z', scale:'20000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-05-10',time:'07:30'}], tags:['PB赛道'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'苏州太湖马拉松2026', raceGroup:'苏州太湖马拉松', province:'江苏', city:'苏州', raceType:'full', raceTypes:['full'], label:'普通标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-11-15T00:00:00.000Z', scale:'20000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-11-15',time:'07:30'}], tags:[], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'绍兴马拉松2026', raceGroup:'绍兴马拉松', province:'浙江', city:'绍兴', raceType:'full', raceTypes:['full'], label:'普通标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-11-08T00:00:00.000Z', scale:'25000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-11-08',time:'07:30'}], tags:['PB赛道'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })

db.collection('race_events').add({ data: { name:'青岛马拉松2026', raceGroup:'青岛马拉松', province:'山东', city:'青岛', raceType:'full', raceTypes:['full'], label:'普通标', mechanism:'抽签', payment:'先缴费', status:'upcoming', raceLevel:'A', confirmed:false, date:'2026-04-19T00:00:00.000Z', scale:'25000人', gunTimes:[{zone:'A',time:'07:30',zoneIdx:0}], timeline:[{label:'鸣枪开跑',date:'2026-04-19',time:'07:30'}], tags:['PB赛道'], tagStats:{}, reviewCount:0, avgScore:0, certs:{}, website:'', poster:'', distance:'', elevation:'', fee:'', createTime:'2026-06-30T12:00:00.000Z' } })
```
