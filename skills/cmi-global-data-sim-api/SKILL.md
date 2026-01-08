---
name: cmi-global-data-sim-api
description: 中国移动国际(CMI)/CMLINK 全球数据卡平台/DSF API V4.2 接入规范技能。用于读取/实现/排查《全球数据卡平台API接入规范 V4.2》相关接口（accessToken、套餐/订单/流量/卡状态/通知、渠道商自建套餐/加油包、关联国家/应用等），构造 WSSE 鉴权头、请求/响应字段与错误码解析。
---

# 中国移动国际全球数据卡平台 API (V4.2)

## 适用场景
- 处理 CMI Global Data SIM Platform/DSF API 的对接、联调与排障
- 生成接口请求/响应字段表、示例 JSON
- 校验鉴权头、时间格式、必选/可选字段规则
- 查询 HTTP 状态码与通用返回码

## 快速流程
1. 先读 `references/general.md` 获取通用规范与鉴权细节。
2. 用 `references/api_index.md` 定位接口编号(3.2.x)与 URI。
3. 在 `references/endpoints.md` 查字段、样例与注意事项。
4. 在 `references/codes.md` 查 HTTP 状态码与通用返回码。

## 输出要求
- 输出请求/响应示例时，标注字段必选/可选(M/O)与长度/含义。
- 明确 accessToken 的获取方式、有效期与使用位置。
- 必须遵循 UTC0 时间格式 `YYYYMMDDHHMMSS` 与 WSSE 鉴权规则。

## 检索提示
- 通过 `3.2.x` 或接口名称在 `references/endpoints.md` 定位明细。
- 若接口 URI 或字段断词，请回看原文上下文。
