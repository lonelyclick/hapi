# 中国移动国际全球数据卡平台 API (V4.2) 接口索引

说明：索引从 PDF 提取，接口名/URI 可能因换行存在断词，请结合接口明细核对。

| 接口编号 | 接口名称 | 接口标识 | 方法 | URI |
| --- | --- | --- | --- | --- |
| 3.2.1 | 获取Token 接口 | SBO.directGetAccessToken | POST | http(s)://ip:port/aep/APP_getAccessToken_SBO/v1 |
| 3.2.2 | 查询套餐信息接口 |  | POST | http(s)://ip:port/aep/app_getDataBundle_SBO/v1 |
| 3.2.3 | 激活已订购的套餐，同时包含使用之前已经激活的套餐能力 |  | POST | http(s)://ip:port/aep/APP_activeDataBundle_SBO/v1 |
| 3.2.4 | 查询H-IMSI 位置和状态 |  | POST | http(s)://ip:port/aep/APP_HIMSI_TERMSTATE_SBO/v1 |
| 3.2.5 | 订单同步接口 |  | POST | http(s)://ip:port/aep/APP_createOrder_SBO/v1 |
| 3.2.6 | 查询用户套餐接口 | SBO.getSubedUserDataBundle | POST | http(s)://ip:port/aep/APP_getSubedUserDataBundle_SBO/v1 |
| 3.2.7 | 查询运营商信息接口 |  | POST | http(s)://ip:port/aep/APP_queryCarrier_SBO/v1 |
| 3.2.8 | UPCC 查询流量接口 |  | POST | http(s)://ip:port/aep/APP_getSubscriberAllQuota_SBO/v1 |
| 3.2.9 | 套餐提前释放接口 |  | POST | http(s)://ip:port/aep/SBO_package_end/v1 |
| 3.2.10 | 卡状态查询接口 |  | POST | http(s)://ip:port/aep/SBO_query_SIMInfo/v1 |
| 3.2.11 | 用户使用轨迹查询接口 |  | POST | http(s)://ip:port/aep/SBO_query_usingTrajectories/v1 |
| 3.2.12 | 渠道商退订 |  | POST | http(s)://ip:port/aep/SBO_channel_unsubscribe/v1 |
| 3.2.13 | ESIM 卡信息查询接口 |  | POST | http(s)://ip:port/aep/SBO_queryEsimCardInfo/v1 |
| 3.2.14 | UPCC 模板查询接口 |  | POST | http(s)://ip:port/aep/SBO_queryUpccTemplate/v1 |
| 3.2.15 | 渠道商激活通知 |  | POST | 南向：合作方侧提供 |
| 3.2.16 | 流量通知接口 |  | POST | 南向：合作方侧提供 |
| 3.2.17 | esim 状态通知接口 |  | POST | http(s)://ip:port/aep/gsma/rsp2/es2plus/handleDownloadProgressInfo |
| 3.2.18 | 渠道商自建套餐接口 |  | POST | http(s)://ip:port/aep/SBO_add_package/v1 |
| 3.2.19 | 渠道商修改套餐接口 |  | POST | http(s)://ip:port/aep/SBO_update_package/v1 |
| 3.2.20 | 渠道商删除套餐接口 |  | POST | http(s)://ip:port/aep/SBO_del_package/v1 |
| 3.2.21 | 渠道商自建加油包接口 |  | POST | http(s)://ip:port/aep/SBO_add_packageRefuel/v1 |
| 3.2.22 | 渠道商加油包查询接口 |  | POST | http(s)://ip:port/aep/SBO_query_packageRefuel/v1 |
| 3.2.23 | 渠道商删除加油包接口 |  | POST | http(s)://ip:port/aep/SBO_del_packageRefuel/v1 |
| 3.2.24 | 查询渠道商关联应用接口 |  | POST | http(s)://ip:port/aep/SBO_channel_app/v1 |
| 3.2.25 | 渠道商关联国家查询接口 |  | POST | http(s)://ip:port/aep/APP_getCountryGroupInfo_SBO/v1 |