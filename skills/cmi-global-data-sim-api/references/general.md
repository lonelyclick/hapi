# 中国移动国际全球数据卡平台 API (V4.2) 总体规范摘录

说明：本文件为从 PDF 提取的正文并清洗重复页眉，涵盖 1~3.1 的通用规范。


China Mobile International Ltd.
Global Data SIM Platform
API Specification

V4.1

1 概述
1.1 接口范围说明
本文档为全球卡卡池中心提供的DSF接口文档。
1.2 接口使用说明
1.2.1 时间类型约定
时间类型的字符串采用14位定长，格式是YYYYMMDDHHMMSS，24时制，采用UTC0
时区时间。
1.2.2 响应消息扩展字段约定
如果接口响应消息中无扩展字段，那么返回消息中不携带ext 节点。
1.2.3 关于字段填写的约定
1、如果接口文档中某字段是必选字段（标记为“M”），则必须携带对应节点，
且节点取值不能为空。
2、如果接口文档中某字段是可选字段（标记为“O”）:
1）字符型可选字段允许不出现对应节点，也允许出现该节点但取值为空。不出现
某个可选字符型节点时，和出现该节点但取值为空一致；
2）数值型可选字段允许不出现对应节点，但不允许出现该节点但取值为空。不出
现某个可选数值型节点时，和出现该节点但取值为0 一致。
3）列表类型可选字段允许不出现对应节点，也允许出现节点但取值出现空列表。
4）对象类型可选节字段许不出现对应节点。
场景1：如Object对象内的子节点（Name1/Name2）为必选字段，则允许：
A）整个<Object>节点不出现
B）<Object>

<Name1>wjl</Name1>
<Name2>mxl</Name2>
</Object>
场景2：如Object对象内的子节点（Name1/Name2）为可选字段，则允许：
A）整个<Object>节点不出现
B）<Object>
<Name1>wjl</Name1>
<Name2>mxl</Name2>
</Object>
<Object>
<Name1></Name1>
<Name2></Name2>
</Object>
C）<Object></Object>
3、修改接口是全量刷新方式。
4、对于查询类接口接口：1）如果返回成功，则Rsp节点必须返回（可以是空节
点），如果接口定义Rsp中有List则List必须返回（可以是空节点）；2）如果返回
失败，则Rsp不需要返回。
对于非查询类接口，如果接口定义中Rsp下只有ext（没有其他字段），那么：
1）如果返回成功，在无ext信息时Rsp节点不需要返回；2）如果返回失败，Rsp节点
不需要返回。
1.2.4 关于响应消息中”必选”字段的约定
响应消息中标记为”M”的字段，表示返回成功时该字段在在响应消息中必须携
带，当返回失败时这些字段并不会携带。
1.2.5 接口中密码字段的传输加密方式说明
接口中密码字段的传输加密方式：AES （cbc 填充模式）
1.2.6 关于接口请求最外层的 ext
接口请求最外层的 ext（Req 最外层的 ext）作为接口的控制参数，不入库。

2 数据类型
2.1 通用复合类型
2.1.1 多语言属性 DialectInfo
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| langInfo | LangInfo | M |  | 语言信息 |
| value | String | M |  | 属性值（名称、描述） |

2.1.2 语言信息 LangInfo
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| language | String | M | 8 | 语言类型，参见 ISO-639 定 义，例如 zh：中文, en：英文 |
| country | String | M | 8 | 地区代码，参见 ISO-3166 定 义，例如 CN：中国 US：美国 HK: 香港(繁体) |

3 服务接口说明
3.1 消息格式说明
3.1.1 接入认证消息头说明
3.1.1.1 请求消息
3.1.1.1.1 示例
POST /payment/createPaymentBySms/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/ json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob", PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",
Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"

{
" userId ":"8613912345678",
" productName ":" Anvanced%20Sword ",
" productOrderId ":"001002432",
" productDesc ":" This%20is%20the%20advanced%20sword%20with%20526",
" amount ":"1",
" totalFee ":"200",
"currency":"USD",
" accessChannel ":"2"
}
3.1.1.1.2 消息头名称说明
1. Authorization
取值为： WSSE realm="SDP",profile="UsernameToken",type="Appkey"。
2. X-WSSE
取值为： UsernameToken Username="App Key 的值", PasswordDigest="PasswordDigest 的值",
Nonce="随机数", Created="随机数生成时间"。
➢ PasswordDigest：根据公式PasswordDigest = Base64 (SHA256 (Nonce + Created +
Password))生成。其中，Password即App Secret的值，SHA256的值byte以utf8编码格式转码
后再进行Base64。
➢ Nonce：App发送请求时生成的一个随机数。 例如，66C92B11FF8A425FB8D4CCFE0ED9ED1F。
➢ Created： 随机数生成时间。 采用标准UTC格式，24小时制， 为YYYY-MM-DD'T'hh:mm:ss'Z'。
例如，2014-01-07T01:58:21Z。 有效期10分钟 （可配） ， 格式如2022-07-07T09:58:21Z表示2022

年7月 7日上午9点 58分21秒， 2022-07-07T21:58:21Z表示2022年7月7 日晚上9点58分
21秒。
其中，App Key为AEP分配的App标识。App Secret为 AEP分配的App密钥。
3.1.1.2 响应消息
3.1.1.2.1 示例
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 560
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob", PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",
Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"

{
"code":"0000000",
"description":"Success.",
"result":{
"accessChannel":"2",
"amount":"1",
"appkey":"f9c971222a034c46844a64d14ffb5a2e",
"applyTime":"2014-04-30T00:01:25Z",
"currency":"USD",
"merchantAccount":"92bee9a1-1aae-494e-a2a6-1071c00ad161",
"paymentId":"000002020904201404300001250001",
"productDesc":"This is the advanced sword with attack point 526",
"productName":"Anvanced Sword",
"productOrderId":"2180930404",
"status":"1",
"totalFee":"200"
}
}
3.1.2 通用消息头说明
3.1.2.1 请求消息
3.1.2.1.1 示例
CallChainInfo: TraceID="xxx", SeqNo="xxx", CallingNodeID="xxx", TraceFlag="xxx"
TraceInfo: TraceTaskID="xxx", HasComparedTrace="xxx", ETraceID="xxx",
TraceOrder="xxx", PackageName="xxx"
Client-Info: beID="xxx"
3.1.2.1.2 消息头名称说明
1. CallChainInfo调用链上下文定义
取值为：  CallChainInfo: TraceID="xxx", SeqNo="xxx", CallingNodeID="xxx",
CalledClusterID="", TraceFlag="xxx"
➢ TraceID：调用链唯一标识。

➢ SeqNo：埋点序列号，标识调用链中埋点先后顺序。
➢ CallingNodeID：调用者的服务实例标识，由调用方服务实例所在节点全局唯一标识 +
节点内服务实例唯一标识构成，如订单管理集群中某个节点上的订购服务实例：
OrderNode001.OrderService。
➢ CalledClusterID：被调用服务（集群）标识，是CalledNodeID 的上层 ClusterID，为
集群全局唯一标识 + 集群内服务唯一标识构成，单机也必须有集群唯一标识。如订单管理集群
中订购服务（集群）：OrderCluster01.OrderService。请求不需要填，ApiGw 会在响应中返回。
➢ TraceFlag：埋点日志输出的标志。
2. TraceInfo跟踪上下文定义
取值为：  TraceInfo: TraceTaskID="xxx", HasComparedTrace="xxx", ETraceID="xxx",
TraceOrder="xxx", PackageName="xxx"。
➢ TraceTaskID：跟踪任务号。
➢ HasComparedTrace：表示是否有匹配任务。
➢ EtraceID：唯一标识此次消息的流程。
➢ TraceOrder：消息发送的顺序，所有消息收端，收到traceOrder，进行traceOrder+1处
理，首节点消息中没有traceOrder，则初始化为０。
➢ PackageName：包路径参数
3. Client-Info客户端信息
取值为： beID="xxx"。
➢ beID：多租场景下的租户ID，非多租场景，可选。
3.1.2.2 响应消息
3.1.2.2.1 示例
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 560
CallChainInfo: TraceID="xxx", SeqNo="xxx", CallingNodeID="xxx", TraceFlag="xxx"
TraceInfo: TraceTaskID="xxx", HasComparedTrace="xxx", ETraceID="xxx",
TraceOrder="xxx", PackageName="xxx"
Client-Info: beID="xxx"
{
"code":"0000000",
"description":"Success.",
"result":{
"accessChannel":"2",
"amount":"1",
"appkey":"f9c971222a034c46844a64d14ffb5a2e",
"applyTime":"2014-04-30T00:01:25Z",
"currency":"USD",
"merchantAccount":"92bee9a1-1aae-494e-a2a6-1071c00ad161",
"paymentId":"000002020904201404300001250001",
"productDesc":"This is the advanced sword with attack point 526",
"productName":"Anvanced Sword",
"productOrderId":"2180930404",
"status":"1",
"totalFee":"200"
}
}