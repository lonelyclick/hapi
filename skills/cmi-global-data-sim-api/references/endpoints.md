# 中国移动国际全球数据卡平台 API (V4.2) 接口明细

说明：本文件为从 PDF 提取的正文并按 3.2.x 接口段落分组，保留原文格式与字段表。
如需精确字段定义，请以原文为准。

## 3.2.1 获取Token 接口
3.2.1.1 接口功能
该接口用于获取AccessToken
接口:SBO.directGetAccessToken
3.2.1.2 请求方法
请设置成“POST”。
3.2.1.3 请求URI
http(s)://ip:port/aep/APP_getAccessToken_SBO/v1
3.2.1.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| id | String | M | 64 | 渠道商AppKey |
| type | Integer | M |  | 登录账号名类型 106：渠道商 |

3.2.1.4.1 请求消息样例
POST ip:port/aep/APP_getAccessToken_SBO/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    " id ":"bob",
    " type":"106"
}

3.2.1.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。 |

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| description | String | O | 1024 | 返回码描述。 |
| accessToken | String | O | 64 | 生成的accessToken信息 |
| expireTime | String | O | 14 | accessToken过期时间，默认10分钟 后的一个14位绝对UTC时间，精确到 秒 |

3.2.1.5.1 响应消息样例
POST /ip:port/aep/APP_getAccessToken_SBO/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code":"8613912345678",
    "description":"",
    "accessToken":"1000000",
    "expireTime": "",
}


## 3.2.2 查询套餐信息接口
3.2.2.1 接口功能
查询套餐信息
VSBO.getDataBundle
3.2.2.2 请求方法
请设置成“POST”。
3.2.2.3 请求URI
http(s)://ip:port/aep/app_getDataBundle_SBO/v1
3.2.2.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| partnerId | Stirng | O | 20 | 渠道商ID |
| dataBundleId | String | O | 20 | 套餐ID |
| dataBundleName | String | O | 20 | 套餐名称 |
| Group_id | String | O | 32 | 套餐组ID |
| language | String | O |  | 语言类型 参见ISO-639定义，例如 zh：中文, en：英文 |
| country | String | O |  | 地区代码，参见ISO-3166定义，例如 CN：中国 US：美国 HK: 香港(繁体) |
| mcc | String | O |  | 国家码 |
| status | Integer | O |  | 套餐状态 （外部传入1：正常） |
| currency | List<String> | O |  | 币种 |
| beginIndex | Integer | O |  | 开始索引，如果不填，默认为0。 |
| count | Integer | O |  | 返回数量，如果不填，默认50。 |
| cooperationMode | String | M | 1 | 1： 代销 2： A2Z |
| ext | Map<String,String> | O |  | 扩展属性； |

3.2.2.4.1 请求消息样例
POST /ip:port/aep/app_getDataBundle_SBO/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "accessToken":"8613912345678",
    "Partner":"",
    "dataBundleId":"1000000",
    "dataBundleName":"",
    "Group_id":"1000000",
    "language":"zh",
    "country":"CN",
    "mcc":"1000000",
    "stauts":"1000000",
    "currency": "USD",
    "beginIndex":"0",
    "count":"50",
    "ext":
    {
    }
}

3.2.2.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。 |
| description | String | O | 1024 | 返回码描述。 |
| dataBundles | List<DataBundle> | M |  | 套餐信息 |

DataBundle
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| id | String | M | 20 | 流量套餐包的唯一标识;新增时 可选。 |
| QC;name | List<DialectInfo> | M |  | 套餐包名称，支持多语言 |
| desc | List<DialectInfo> | M |  | 套餐包描述，支持多语言 |
| cardPools | Map<String,List<NetCapability>> | M |  | 卡池 ID 和关联的网络能力列 表。 1）套餐的网络能力，不能超过 卡池的网络能力集合。 2）套餐绑定中各卡池的网络能 力不能重叠。 |
| status | Integer | M | 1 | 套餐状态: 1: 正常 (发布套餐状态) 2: 下线暂停销售（不能购买和 批发，老订购关系可以继续使 用，可以还原） 3: 注销（软删除，购买页面没 |

有但是管理管理页面展示）QC;

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| activationMode | String | M | 1 | 套餐计费激活方式 1: 预订日期 或首话单开始计算套餐 2: 收到 IMSI 的LU 后开始计算套餐 3: 用户 IMSI(HIMSI+VIMSI)的流量 使用超过指定限额后 |
| type | Int32 | M | 1 | 流量限制类型: 1 ：周期内限量 2 ：单日限量 |
| periodType | Int32 | M | 1 | 周期类型: 0:24 小时 1:自然天 2:自然月 3:自然年 |
| period | Int32 | M | 3 | 套餐持续周期数; 比如包天，包 3 天，包 7 天等、包 2 月、包 2 年. |
| QC;imgurl | String | M | 1000 | 套餐封面 url |
| priceInfo | List<PriceInfo> | O |  | 价格信息。 |
| refuelingPackage | List<RefuelingPackage> | O |  | 关联加油包对象 |
| createTime | String | M | 14 | 创建时间, UTC; YYYYMMDDHHMMSS |
| expireTime | String | M | 14 | 失效时间, UTC; YYYYMMDDHHMMSS |
| lastModifyTime | String | M | 14 | 最近修改时间, UTC; YYYYMMDDHHMMSS |
| originalPriceInfo | List<PriceInfo> | O |  | 套餐原始价格信息 |
| ext | Map<String,String> | M |  | 扩展属性。 ext 扩展参数描述： |
| priority | String | O |  | 套餐的优先级 |
| isPromotionalPackage | String | M |  | 此套餐是否促销套餐 0：不是促销套餐 1：是促销套餐 |
| purchasesCount | String | O |  | 促销套餐最大可购买份数。 当 isPromotionalPackage 为 1 时携带。 |
| discount | String | O |  | 套餐折扣，表示为原价的百分比 |
| deductionModel | String | M |  | 套餐扣费模式: 1：标准模式 2：绑定模式 |
| deductionUrl | String | O |  | 扣费 URL |
| cooperationMode | String | O | 1 | 套餐合作模式（若为渠道商用户 一定有值）： 1： 代销 2： A2Z |

RefuelingPackage
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| refuelingID | String | M | 20 | 加油包 ID |
| nameCN | String | O | 100 | 简体中文名称 |
| nameTW | String | O | 100 | 繁体中文名称 |
| nameEN | String | O | 100 | 英文名称 |
| flowValue | int | M |  | 流量值 |
| flowUnit | String | M | 1 | 流量单位 1：MB 2: GB |
| hkd | String | M | 20 | 港币价格（单位：分） |
| usd | String | M | 20 | 美元价格（单位：分） |
| cny | String | M | 20 | 人民币价格（单位：分） |
| createTime | String | M | 14 | 创建时间, UTC; YYYYMMDDHHMMSS |
| isOrderingAllowed | String | M |  | 加油包是否允许订购 1、是 2、否 |

PriceInfo

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| currencyCode | String | M | 20 | 币种 |
| price | String | M | 20 | 价格(单位：分) |

NetCapability
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| mcc | String | M | 20 | 支持的国家码 |
| mnc | String | O | 20 | 支持的运营商网络标识 |

3.2.2.5.1 响应消息样例
POST /ip:port/aep/app_getDataBundle_SBO/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code":"8613912345678",
    "description":"102",
    "dataBundles":
    {
        "id":"",
        "name":
        {
            "langInfo":"",
            "value":"",
        }
        ,
        "desc":
        {
            "langInfo":"",
            "value":"",
        }
        ,
        "cardPools":
        {
            "mcc":"",
            "mnc":""
        }
        ,
        "status":"",
        "activationMode":"",
        "type":"",
        "periodType":"",
        "period":"",
        "imgurl":"",
        "priceInfo":
        {
            "currencyCode":"",
            "price":"",
            "unit":""
        }
        ,
        "refuelingPackage":
        {
            "refuelingID":"",
            "nameCN":"",
            "nameTW":"",
            "nameEN":"",
            "flowVrange":"",
            "flowUnight":"",
            "hkd":"",
            "usd":"",
            "cny":"",
            "createTime":"",
            "isOrderingAllowed":""
        }
        ,
        "createTime":"",
        "expireTime":"",
        "lastModifyTime":"",
        "originalPriceInfo":
        {
            "currencyCode":"",
            "price":"",
            "unit":""
        }
        ,
        "ext":""
    }
}


## 3.2.3 激活已订购的套餐，同时包含使用之前已经激活的套餐能力
套餐激活并使用
3.2.3.1 请求方法
请设置成“POST”。
3.2.3.2 请求URI
http(s)://ip:port/aep/APP_activeDataBundle_SBO/v1
3.2.3.3 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| hImsi | String | O |  | 6~15 主卡对应的IMSI号 hImsi、msisdn、iccid三者必传一 |
| msisdn | String | O | 20 | 主卡对应的手机号码 hImsi、msisdn、iccid三者必传一 |
| iccid | String | O | 20 | 主卡的ICCID hImsi、msisdn、iccid三者必传一 |
| dataBundleId | String | M | 20 | 套餐 ID |
| mcc | String | M | 20 | 国家标识 |
| ext | Map<String,String> | O |  | 扩展属性； |

3.2.3.3.1 请求消息样例
POST /ip:port/aep/APP_activeDataBundle_SBO/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "accessToken":"",
    "hImsi":"",
    "msisdn":"",
    "iccid":"",
    "dataBundleId":"",
    "mcc":"",
    "ext":""
}

3.2.3.4 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。 |
| description | String | O | 1024 | 返回码描述。 |
| ext | Map<String,String> |  |  | 扩展属性； |

3.2.3.4.1 响应消息样例
POST /ip:port/aep/APP_activeDataBundle_SBO/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    " code ":"",
    " decsription":"",
    " ext ":"",
}


## 3.2.4 查询H-IMSI 位置和状态
3.2.4.1 接口功能
该接口查询H-IMSI的位置和状态
3.2.4.2 请求方法
请设置成“POST”。
3.2.4.3 请求URI
http(s)://ip:port/aep/APP_HIMSI_TERMSTATE_SBO/v1
3.2.4.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| imsi | String | O |  | IMSI号码（imsi和icccid必填一个） |
| iccid | String | O |  | ICCID号码（imsi和 icccid必填一 个） |
| ext | Map<String,String> | O |  | 扩展属性； |

3.2.4.4.1 请求消息样例
POST /ip:port/aep/APP_HIMSI_TERMSTATE_SBO/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "accessToken":"",
    "imsi":"",
    "iccid":"",
    "ext":""
}

3.2.4.5 响应消息
请求成功时响应消息体中的参数说明如下所示。

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。 |
| description | String | O | 1024 | 返回码描述。 |
| imsi | String | M |  | 终端用户的 IMSI 号码 |
| msisdn | String | O |  | 终端用户的 MSISDN 号码 |
| mobileCountryCode | String | O |  | 直接返回 MCC 信息 |
| ext | Map<String,String> | O |  | 扩展属性； |

3.2.4.5.1 响应消息样例
POST /ip:port/aep/APP_HIMSI_TERMSTATE_SBO/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code ":"",
    "decsription":"",
    "imsa":"",
    "msisdn":"",
    "mobileCountryCode":"",
    "ext ":"",
}


## 3.2.5 订单同步接口
3.2.5.1 接口功能
该接口用于创建订单
3.2.5.2 请求方法
请设置成“POST”。
3.2.5.3 请求URI
http(s)://ip:port/aep/APP_createOrder_SBO/v1
3.2.5.4 请求消息
请求消息体中的参数说明如下所示。

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| thirdOrderId | String | M |  | 发起方订单ID |
| includeCard | Integer | M |  | 0：不包含 |
| is_Refuel | String | M | 1 | 是否是加油包 0：是 1：不是 |
| refuelingId | String | O | 20 | 加油包ID，若is_Refuel为0 必填 |
| dataBundleId | String | O | 20 | 套餐 ID |
| quantity | Integer | M |  | 购买数量 |
| ICCID | String | O | 20 | ICCID号码 |
| sendLang | String | O |  | 发送购买短信使用的语言 1： 中文繁体 2:  英文 3： 中文简体 |
| setActiveTime | String | O | 8 | 套餐指定激活日期 格式 YYYYMMDD |
| transactionCode | String | O | 32 | 交易流水号，选填，如果填了，与库里 的数据不能重复且相同时间只处理一 个。空格和空串都默认不做校验 |

3.2.5.4.1 响应消息样例
POST /ip:port/aep/APP_createOrder_SBO/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "accessToken":"",
    "thirdOrderId":"",
    "includeCard":"0",
    "is_Refuel":"0",
    "refuelingId":"",
    "dataBundleId":"",
    "quantity":"",
    "ICCID":"",
    "sendLang":"",
    "setActiveTime":"",
    "transactionCode":""
}

3.2.5.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M |  | 返回码。 |
| description | String | O |  | 返回码描述。 |
| orderID | String | M |  | 订单ID |
| totalAmount | Long | M |  | 订单金额 |
| quantity | Integer | M |  | 购买数量 |
| price | String | M |  | 单价 |
| currency | String | M |  | 币种 |
| ext | Map<String,String> | O |  | 扩展属性； |

3.2.5.5.1 响应消息样例
POST /ip:port/aep/APP_createOrder_SBO/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code ":"",
    "decsription":"",
    "orderID":"",
    "toatlAmount":"",
    "quantity":"",
    "price":"",
    "currency":"",
    "ext ":"",
}


## 3.2.6 查询用户套餐接口
3.2.6.1 接口功能
终端查询用户已订购套餐列表接口

接口：SBO.getSubedUserDataBundle
3.2.6.2 请求方法
请设置成“POST”。
3.2.6.3 请求URI
http(s)://ip:port/aep/APP_getSubedUserDataBundle_SBO/v1
3.2.6.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| hImsi | String | O | 20 | 主卡的Imsi号；与iccid必填其一 |
| iccid | String | O |  | iccid号，与himsi必填其一 |
| status | String | O | 1 | 套餐状态，不传默认查询全部状态 1:使用中 2:已使用 3:未使用 4:已过期 |
| language | String | M |  | 语言 0：中文简体 1：中文繁体 2：英文 |
| beginIndex | Int32 | O |  | 个数开始索引，如果不填，默认为0。 |
| count | Int32 | O |  | 返回数量，如果不填，默认50。 |
| mcc | String | O |  | 国家码，不传默认查询全部套餐 |
| ext | Map<String,String> | O |  | 扩展属性； |

3.2.6.4.1 请求消息样例
POST /ip:port/aep/APP_getSubedUserDataBundle_SBO/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"

{
    "accessToken":"",
    "hImsi":"",
    "iccid":"",
    "status":"",
    "language":"",
    "beginIndex":"",
    "count":"",
    "mcc":"",
    "ext":""
}

3.2.6.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。 |
| description | String | O | 1024 | 返回码描述。 |
| userDataBundles | List<UserDataBundle> | M |  | 已订购的套餐列表； |

UserDataBundle
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| bundleDesc | List<DialectInfo> | M | 400 | 套餐包描述 |
| name | List<DialectInfo> | M | 60 | 套餐包名称 |
| dataBundleId | String | M | 20 | 套餐标识 |
| status | Integer | O | 2 | 订购关系状态 1：未激活 2：已过期 3：已激活 99：已退款 |
| remainderDays | Integer | O | 11 | 可够买加油包天数（套餐剩余天 数） （仅套餐状态为已激活，且流量限 制类型为单日限量时返回） |
| orderID | String | O | 50 | 订单 ID |
| subscriptionKey | String | O | 50 | 子订单标识 |
| price | PriceInfo | O |  | 订购价格 |

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| orderChannel | String | O | 20 | 订购渠道 |
| createTime | String | O | 14 | 订购时间 |
| expireTime | String | O | 30 | 过期时间 |
| endTime | String | O | 30 | 套餐过期时间 |
| activeTime | String | O | 30 | 套餐激活时间 |
| setActiveTime | String | O | 30 | 用户设定的套餐指定激活日期 （仅套餐计费激活方式为方式一返 回） |
| isSupportFuelpack | String | O | 1 | 是否支持加油包： 1：是 2：否 |
| packageType | String | O | 1 | 套餐类型: 1：周期内限量 2：单日限量 |
| deductionModel | String | M | 1 | 套餐扣费模式: 1：标准模式 2：绑定模式 |
| remainFlow | String | O |  | 套餐为已激活状态时，返回 剩余可用流量，单位 MB，四舍五 入，保留两位小数 |
| remainTime | String | O |  | 套餐为已激活状态时，返回 剩余可用时间 格式：x 小时 y 分 z 秒 |

PriceInfo
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| currencyCode | String | M | 20 | 币种 |
| price | String | M | 20 | 价格 |
| unit | String | M | 20 | 单位（单位：分） |

3.2.6.5.1 响应消息样例
POST /ip:port/aep/APP_getSubedUserDataBundle_SBO/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code ":"",
    "decsription":"",
    "userDataBundles":
    {
        "bundleDesc":
        {
            "langInfo":
            {
                "language":"",
                "country":""
            }
            ,
            "value":""
        }
        ,
        "name":
        {
            "langInfo":":{ "language":"","country":""},"value":"" },"dataBundleID":"","status":"","remainderDay":"", "orderID":"","subscriptionKey":"","price":{ "currencyCode":"","price":"""unit":"" },"orderChannel":"","createTime":"","expireTime":"", "endTime":"","activeTime":"","setActiveTime":"","isSupportFuelpack":"", "packageType":"","deductionModel":"",}

}


    }
}
原文缺失：示例末尾括号已补全
## 3.2.7 查询运营商信息接口
3.2.7.1 接口功能
查询SBO配置的运营商信息
3.2.7.2 请求方法
请设置成“POST”。
3.2.7.3 请求URI
http(s)://ip:port/aep/APP_queryCarrier_SBO/v1
3.2.7.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| language | String | M |  | 0：中文简体 1：中文繁体 2：英文 |
| mcc | String | O |  | 国家码 |
| continent | String | O |  | 大洲名称（语言同language） |
| ext | Map<String,String> | O |  | 扩展属性 |

3.2.7.4.1 请求消息样例
POST /ip:port/aep/APP_queryCarrier_SBO/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "language":"0",
    "mcc":"104",
    "continent":"",
    "ext":""
}


3.2.7.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。 |
| description | String | O | 1024 | 返回码描述。 |
| stateList | List<Carrier> | O |  | 国家的列表 |
| ext | Map<String,String> |  |  | 扩展参数 |

Carrier
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| country | String | M |  | 国家 |
| continent | String | M |  | 大洲名称 |
| carrier | String | M |  | 运营商名称 |
| isHot | String | M |  | 是否热门国家 |
| imageUrl | String | O |  | 图片 URL 地址 |
| APN | String | M |  | APN |
| mcc | String | M |  | 支持的国家码 |

3.2.7.5.1 响应消息样例
POST /ip:port/aep/APP_queryCarrier_SBO/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code ":"",
    "decsription":"",
    "stateList":
    {
        "country":"",
        "continent":"",
        "carrier":"",
        "isHot":"",
        "imageUrl":"",
        "APN":"",
        "mcc":"",
    }
    ,
    "ext":"",

}
原文缺失：示例末尾括号已补全
## 3.2.8 UPCC 查询流量接口
3.2.8.1 接口功能
该命令用于查询用户所有配额数据信息
3.2.8.2 请求方法
请设置成“POST”。
3.2.8.3 请求URI
http(s)://ip:port/aep/APP_getSubscriberAllQuota_SBO/v1
3.2.8.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| himsi | String | O |  | himsi 号，与 iccid 必填一 |
| iccid | String | O |  | iccid 与 himsi 必填一 |
| beginTime | String | O |  | 开始时间 YYYYMMDD |
| endTime | String | O |  | 结束时间 YYYYMMDD |
| childOrderId | String | O |  | 子订单 id（传入该参数则只 有此参数生效） |
| thirdOrderId | String | O |  | 第三方订单 ID |
| ext | Map<String,String> | O |  | 扩展属性； |

3.2.8.4.1 请求消息样例
POST /ip:port/aep/APP_getSubscriberAllQuota_SBO/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "himsi":"",
    "iccid":"",
    "beginTime":"",
    "endTime":"",
    "childOrderId":"",
    "thirdOrderId":"",
    "ext":""
}

3.2.8.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码：0-成功；非0-失败； |
| description | String | O | 1024 |  |
| quotaList | List<QuotaRes> |  |  | 流量列表 |

QuotaRes
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| subscriberQuota | SubscriberQuota | O |  | 实时流量对象 |
| historyQuota | List<HistoryQuota> | O |  | 历史流量对象 |
| ext | Map<String,String> | O |  | 扩展属性； |

SubscriberQuata

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| qtavalue | String | M |  | 套餐总流量（周期内/单日可用高 速流量（套餐的流量上限属 性），不含加油包流量） |
| qtabalance | String | M |  | 剩余高速流量 |
| qtaconsumption | String | M |  | 已使用高速流量（从套餐激活开 始到查询时间点/当日） |
| type | String | M |  | 流量限制类型： 1.周期内限量 2.单日限量 |
| refuelingTotal | String | M |  | 购买加油包流量总和（已激活/当 日已激活的加油包流量总和） |
| qtaconsumptionTotal | String | M |  | 已使用总流量（高速+限速）, 从 套餐激活开始到查询时间点/当日 已使用高速流量及限速流量总和 |
| directionalAppFlow | List<DirectionalAppFlow> | O |  | 定向应用流量信息 |

DirectionalAppFlow
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| directionalAppTotalFlow | String | O |  | 定向应用组总流量 |
| directionalAppUsedFlow | String | M |  | 定向应用组已用流量 |
| directionalAppName | List<String> | M |  | 定向应用组应用名称 |

HistoryQuota

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| time | String | M |  | 使用时间 YYYYMMDD |
| qtaconsumption | String | M |  | 使用总流量 |
| mcc | String | M |  | 使用国家 |
| appName | String | O |  | 应用名称 |

3.2.8.5.1 响应消息样例
{
    "code": "0000000",
    "description": "Success",
    "subscriberQuota":
    {
        "qtavalue": "300.00",
        "qtabalance": "0.00",
        "qtaconsumption": "300.00",
        "type": "1",
        "refuelingTotal": "0.00",
        "qtaconsumptionTotal": "325.11",
        "directionalAppFlow":
        [
            {
                "directionalAppTotalFlow": null,
                "directionalAppUsedFlow": "121.89",
                "directionalAppName":
                [
                    "youtube"
                ]
            }
            ,
            {
                "directionalAppTotalFlow": "150.00",
                "directionalAppUsedFlow": "0.10",
                "directionalAppName":
                [
                    "iqiyi"
                ]
            }
        ]
    }
    ,
    "historyQuota":
    [
        {
            "time": "20240308",
            "qtaconsumption": "121.89",
            "mcc": "454",
            "appName": "youtube"
        }
        ,
        {
            "time": "20240308",
            "qtaconsumption": "0.10",
            "mcc": "454",
            "appName": "iqiyi"
        }
        ,
        {
            "time": "20240308",
            "qtaconsumption": "325.11",
            "mcc": "454",
            "appName": null
        }
    ]
    ,
    "ext": null
}



## 3.2.9 套餐提前释放接口
3.2.9.1 接口功能
提前结束某一张或多张SIM卡的使用中套餐。
3.2.9.2 请求方法
请设置成“POST”。
3.2.9.3 请求URI
http(s)://ip:port/aep/SBO_package_end/v1
3.2.9.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| iccidPackageList | IccidPackage[] | M |  | Iccid套餐对象列表 |
| accessToken | String | M | 50 | token |

ICCIDpackage:
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| iccid | String | O |  | iccid 号（ICCID 和 IMSI）必填 一 |
| imsi | String | O |  | imsi 号（ICCID 和 IMSI）必填一 |
| packageid | String | 必选 |  | 套餐 ID |

3.2.9.4.1 请求消息样例
POST /ip:port/aep/SBO_package_end/v1 HTTP/1.1
Host: aep.sdp.com

Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "iccidPackageList":
    {
        "iccid":"",
        "imsi":"",
        "packageid":""
    }
    ,
    "accessToken":""
}

3.2.9.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码：0-成功；非0-失败； |
| description | String |  | 1024 |  |
| errorList | List<Parameter> | O |  | iccid 或 IMSI 修改未成功列表 参数名称：ICCID 或 imsi 参数值：失败原因 |

Parameter
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| parameterName | String | M | 128 | 参数名称 |
| parameterValue | String | M | 1024 | 参数值 |

3.2.9.5.1 响应消息样例
POST /ip:port/aep/SBO_package_end/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code ":"",
    "decsription":"" "errorList":
    {
        "parameterName":"" "parameterValue":""
    }
}


## 3.2.10 卡状态查询接口
3.2.10.1 接口功能
查询SIM卡的状态和基本信息，支持查询一张SIM卡或多张SIM卡状态。
3.2.10.2 请求方法
请设置成“POST”。
3.2.10.3 请求URI
http(s)://ip:port/aep/SBO_query_SIMInfo/v1
3.2.10.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| querySIMInfoVOList | List<QuerySIMInfoVO> | M |  | SIM信息查询对象集合，其中各对象参 数主卡imsi码，与iccid必填一 |

QuerySIMInfoVO
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| imsi | String | O |  | 主卡 imsi码，与iccid必填一 |
| iccid | String | O |  | iccid号，与imsi必填一 |

3.2.10.4.1 请求消息样例
POST /ip:port/aep/SBO_query_SIMInfo/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "querySIMInfoVOList":
    {
        "imsi":"",
        "iccid":""
    }
}


3.2.10.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码：0-成功；非0-失败； |
| description | String | O | 1024 | 返回描述 |
| himsis | List<HImsi> | O |  | 主卡信息列表 仅含 IMSI 和卡片状态有值 |

HImsi
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| hImsi | String | M | 20 | 主卡对应的 imsi 号； |
| QC;msisdn | String | M | 20 | 主卡手机号码； |
| QC;iccid | String | M | 20 | 主卡的 iccid 号； |
| QC;status | Int32 | M | 1 | 主卡的状态. 0: 正常 1: 暂停 3: 注销 QC; |
| cardHlrId | String | O | 20 | 主卡所属的 HLR 标记; |
| cardOtaId | String | O | 20 | 主卡所属的 OTA 设备标记; |
| createTime | String | M | 14 | 创建时间, UTC; YYYYMMDDHHMMSS |
| expireTime | String | M | 14 | 失效时间, UTC; YYYYMMDDHHMMSS |
| lastModifyTime | String | M | 14 | 最近修改时间, UTC; YYYYMMDDHHMMSS |
| serviceUsageMode | String | O |  | 卡套餐的激活方式: 0: 手动激活 1: 自动激活 |
| realRuleList | realRule[] | O |  | 实名制信息列表对象，若为空 |

则不需要实名制

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| ext | Map<String,String> | O |  | 扩展属性 |

realRule
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| ruleID | String | M |  | 规则编码 |
| name | String | M |  | 实名制名称 |
| mcc | String[] | M |  | 实名制规则覆盖的 mcc |
| certificatesType | String | O |  | 证件类型 1、护照 2、港澳通行证 3、香港身份证 4、澳门身份证 |
| certificatesTime | String | O |  | 证件到期时间 format:YYYY-MM-DD |
| authStatus | String | O |  | 认证状态 1、待认证 2、认证中 3、认证通过 4、认证失败 5、证件已过期 |

3.2.10.5.1 响应消息样例
POST /ip:port/aep/SBO_query_SIMInfo/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code":"",
    "description":"",
    "himsis":
    {
        "hImsi":"",
        "msisdn":"",
        "iccid":"",
        "status":"",
        "cardHlrID":"",
        "cardOtaId":"",
        "createTime":"",
        "expireTime":"",
        "lastModifyTime":"",
        "serviceUsageMode":"",
        "realRuleList":
        {
            "ruleID":"",
            "name":"",
            "mcc":"",
            "certificatesType":"",
            "certificatesTime":"",
            "authStatus":"",
        }
        ,
        "ext":"",
    }
}


## 3.2.11 用户使用轨迹查询接口
3.2.11.1 接口功能
某个卡片中的某个套餐的使用轨迹查询，按时间顺序返回用户指定套餐使用过的所有 IMSI(包括
HIMSI和所有VIMSI)位置更新的国家和时间。
3.2.11.2 请求方法
请设置成“POST”。
3.2.11.3 请求URI
http(s)://ip:port/aep/SBO_query_usingTrajectories/v1
3.2.11.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| imsi | String | O |  | 主卡 imsi码，与iccid必填一 |
| iccid | String | O |  | iccid号，与imsi必填一 |
| packageID | String | M |  | 套餐 ID |
| orderID | String | O |  | 全球卡ID |
| subscriptionKey | String | O |  | 子订单ID，对应用户套餐查询响应 subscriptionKey 值 language    语言 0：中文 1：英文 |

2：中文繁体
3.2.11.4.1 请求消息样例
POST /ip:port/aep/SBO_query_usingTrajectories/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "imsi":"",
    "iccid":"",
    "packageID":"",
    "orderID":"",
    "subscriptionKey":"",
    "language":""
}

3.2.11.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码：0-成功；非0-失败； |
| description | String | O | 1024 |  |
| trajectoriesList | List<trajectories> | O |  | 主卡使用轨迹列表 |

             Trajectories
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| hImsi | String | M | 20 | 主卡对应的 imsi 号； |
| QC;vimsi | String | O | 20 | 主卡分配的 V-IMSI |
| mcc | String | M | 20 | 国家码标识 |
| QC;country | String | M | 20 | 国家名称 |
| beginTime | String | M | 8 | 开始时间 YYYYMMDD |
| useTime | String | M | 8 | 结束时间, YYYYMMDD |
| qtavalue | String | O |  | 使用流量（MB） |

3.2.11.5.1 响应消息样例
POST /ip:port/aep/SBO_query_usingTrajectories/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE:  UsernameToken  Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code":"",
    "description":"",
    "trajectoriesList":
    {
        "hImsi":"",
        "vimsi":"",
        "mcc":"",
        "country":"",
        "beginTime":"",
        "useTime":"",
        "qtavalue":"",
    }
}


## 3.2.12 渠道商退订
3.2.12.1 接口功能
只有渠道商可调用，渠道商退订。
3.2.12.2 请求方法
请设置成“POST”。
3.2.12.3 请求URI
http(s)://ip:port/aep/SBO_channel_unsubscribe/v1
3.2.12.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| orderId | String | O | 32 | 全球卡平台订单ID（总订单ID） |
| thirdOrderId | String | O | 200 | 第三方订单ID，与orderId必填其 一，都填以orderId查到的订单为准。 |
| accessToken | String | M | 50 | 获取的accessToken信息 |

3.2.12.4.1 请求消息样例
POST /ip:port/aep/SBO_channel_unsubscribe/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "orderId":"",
    "thirdOrderId":"",
    "accessToken":""
}

3.2.12.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码：0000000-成功；非0000000- 失败； |
| msg | String | M | 1024 | 返回描述 |

3.2.12.5.1 响应消息样例
POST /ip:port/aep/SBO_channel_unsubscribe/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code":"",
    "msg":""
}


## 3.2.13 ESIM 卡信息查询接口
3.2.13.1 接口功能
查询ESIM卡信息
3.2.13.2 请求方法
请设置成“POST”。

3.2.13.3 请求URI
http(s)://ip:port/aep/SBO_queryEsimCardInfo/v1
3.2.13.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| iccid | String | M |  | ICCID号码 |
| accessToken | String | M |  | 渠道商token |

3.2.13.4.1 请求消息样例
POST /ip:port/aep/SBO_queryEsimCardInfo/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "iccid":"",
    "accessToken":""
}

3.2.13.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。 |
| description | String | O | 1024 | 返回码描述。 |
| cardInfo | EsimCardInfo | O |  | ESIM卡信息对象 |

 EsimCardInfo
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| eid | String | M |  | EID |
| activationCode | String | M |  | 激活码 |
| smdpAddress | String | M |  | SM-DP+地址 |
| installDevice | String | O |  | 安装设备 |
| installCount | Integer | O |  | 安装次数 |
| installTime | String | O |  | 安装时间，格式yyyy-MM-dd HH:mm:ss |
| updateTime | String | O |  | 更新时间，格式yyyy-MM-dd HH:mm:ss |
| state | String | M |  | ESIM-状态 |
| downloadUrl | String | M |  | Download URL |

3.2.13.5.1 响应消息样例
POST /ip:port/aep/SBO_queryEsimCardInfo/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "data":
    {
        "smdpAddress": "",
        "activationCode": "",
        "state": "",
        "eid": "",
        "installTime": "",
        "installDevice": ,
        "installCount": "",
        "updateTime": "",
        "downloadUrl": ""
    }
    ,
    "code": "",
    "msg": ""
}


## 3.2.14 UPCC 模板查询接口
3.2.14.1 接口功能
查询渠道商关联的UPCC模板
3.2.14.2 请求方法
请设置成“POST”。
3.2.14.3 请求URI
http(s)://ip:port/aep/SBO_queryUpccTemplate/v1
3.2.14.4 请求消息
请求消息体中的参数说明如下所示。

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| templateId | String | O |  | 模板ID |
| accessToken | String | M |  | 渠道商获取的Token |
| templateName | String | O |  | 模板名称 |
| templateDesc | String | O |  | 模板描述 |
| supportHotspot | String | O |  | 是否支持热点： 1：是 2：否 |

3.2.14.4.1 请求消息样例
POST /ip:port/aep/SBO_queryUpccTemplate/v1 HTTP/1.1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "accessToken": "",
    "templateId": "",
    "templateName": "",
    "templateDesc": "",
    "supportHotspot": ""
}

3.2.14.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。0000000表示成功，其他失 败 |
| msg | String | O | 1024 | 返回码描述。 |
| upccTemplate | List<UpccTemplate> | M |  | Upcc模板信息 |

     UpccTemplate
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| templateId | String | M |  | 模板 ID |
| templateName | String | M |  | 模板名称 |
| templateDesc | String | M |  | 模板描述 |
| supportHotspot | String | M |  | 是否支持热点 1：是 2：否 |

3.2.14.5.1 响应消息样例
POST /ip:port/aep/SBO_queryUpccTemplate/v1
Host: aep.sdp.com
Content-Type: application/json
Content-Length: 212
Accept: application/json
Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey"
X-WSSE: UsernameToken Username="bob",PasswordDigest="weYI3nXd8LjMNVksCKFV8t3rgHh3Rw==",Nonce="WScqanjCEAC4mQoBE07sAQ==", Created="2009-03-24T12:30:04Z"
{
    "code": "",
    "msg": "",
    "upccTemplate":
    [
        {
            "templateId": "",
            "templateName": "",
            "templateDesc": "",
            "supportHotspot": ""
        }
    ]
}


## 3.2.15 渠道商激活通知
3.2.15.1 接口功能
渠道商名下的卡激活普通/流量池套餐确认激活时发生通知。
3.2.15.2 请求方法
请设置成“POST”。
3.2.15.3 请求 URI
南向：合作方侧提供
3.2.15.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| iccid | String | M |  | ICCID |
| packageId | String | M |  | 套餐 ID/流量池ID |
| mcc | String | O |  | 激活国家 |
| cmccNumberProvince | String | O |  | 国内号码归属省份 |
| thirdOrderId | String | O |  | 对端订单 ID |
| activeTime | String | M |  | 套餐激活时间 YYYYMMDDHHmmss |
| endTime | String | M |  | 套餐结束时间 YYYYMMDDHHmmss |
| orderId | String | M |  | 订单 id，总ID |

3.2.15.4.1 请求消息样例
 "POST / HTTP/1.1"
 "Accept: application/json, application/*+json"
 "X-WSSE: UsernameToken Username="1cd6a5f869d64bd29a5fc30f36138593",PasswordDigest="r1vpyIL/mANzAcOeVLW9WIPLjsQnMRXImVO1L9o2Lfo=",Nonce="2F903601C019AF329C3CC717371FF566", Created="2022-07-08T04:26:50Z""
 "Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey""
 "Content-Type: application/json;charset=UTF-8"
 "Connection: Keep-Alive"
 "User-Agent: Apache-HttpClient/4.5.5 (Java/1.8.0_102)"
 "Accept-Encoding: gzip,deflate"

 "{"iccid":"","packageId":"D181029081532_215358","activeTime":"20220708082647","endTime":"20220711082647",
 "mcc":"466","orderId":"212454265645"}"
3.2.15.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码：0-成功；非0-失败； |
| msg | String | M | 1024 | 返回描述 |

3.2.15.5.1  响应消息格式
{
    "code": "0",
    "description": "Success"
}


## 3.2.16 流量通知接口
3.2.16.1 接口功能
当用户产生流量时，由全球卡平台通知合作方。
3.2.16.2 请求方法
请设置成“POST”。
3.2.16.3 请求 URI
南向：合作方侧提供
3.2.16.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| imsi | String | O |  | IMSI码，与iccid必填一 |
| iccid | String | O |  | iccid号，与imsi必填一 |
| qtavalue | String | M |  | 已使用流量（byte） |
| timestamp | String | M |  | 时间 UTC YYYYMMDDHHMMSS |

3.2.16.4.1 请求消息样例

 "POST / HTTP/1.1"
 "Accept: application/json, application/*+json"
 "X-WSSE: UsernameToken Username="1cd6a5f869d64bd29a5fc30f36138593",PasswordDigest="r1vpyIL/mANzAcOeVLW9WIPLjsQnMRXImVO1L9o2Lfo=",Nonce="2F903601C019AF329C3CC717371FF566", Created="2022-07-08T04:26:50Z""

 "Authorization: WSSE realm="SDP", profile="UsernameToken", type="Appkey""
 "Content-Type: application/json;charset=UTF-8"
 "Connection: Keep-Alive"
 "User-Agent: Apache-HttpClient/4.5.5 (Java/1.8.0_102)"
 "Accept-Encoding: gzip,deflate"

{
    "iccid":"89852342022006915895",
    "imsi":"454120381956774",
    "qtavalue":"101804370",
    "timestamp":"20240109175959"
}


3.2.16.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码：0-成功；非0-失败； |
| description | String | O | 1024 |  |

3.2.16.5.1 响应消息样例
{
    "code": "0",
    "description": "Success"
}


## 3.2.17 esim 状态通知接口
3.2.17.1 接口功能
esim状态变更通知
3.2.17.2 请求方法
请设置成“POST”。
3.2.17.3 请求 URI
http(s)://ip:port/aep/gsma/rsp2/es2plus/handleDownloadProgressInfo
3.2.17.4 请求消息
请求消息体中的参数说明如下所示。

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| header | EsimNotifyReqHeaderM |  |  |  |
| eid | String | O | 32 | eid |
| iccid | String | M |  | 18-20 iccid |
| profileType | String | M |  | 1-64 配置类型 |
| timeStamp | String | M | 10 | 执行时间 |
| notificationPointId | String | M |  | 1-3 配置文件下载安装步骤： 1：检查资格和重试上限 2：失败 3：BPP下载 4：BPP安装 5：已删除 101：已安装 102：已关闭 |
| notificationPointStatus | EsimNotifyStatus |  |  | M  执行结果 |
| resultData | String | O |  | 2-512 从 eUICC返回配置文件安装的结 果 |

EsimNotifyStatus
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |

/O长
度
备注
status String M

3.2.17.4.1 请求消息样例

{
    "header":
    {
        "functionRequesterIdentifier": "24a3b946405843d2a1bc69780e7ba717",
        "functionCallIdentifier": "handleDownloadProgressInfo"
    }
    ,
    "iccid": "89852342022019785558",
    "eid": "89043051202200005223001347834515",
    "profileType": "CMI_gds_esim_02",
    "timeStamp": "1709712641",
    "notificationPointId": "102",
    "notificationPointStatus":
    {
        "status": "Executed-Success"
    }
}


3.2.17.1 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| header | EsimNotifyResHeaderM |  |  |  |

EsimNotifyResHeader
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |

/O长
度
备注
functionEx
ecutionStatusFunctionExe
cutionStatusMiccid String M
FunctionExecutionStatus
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |

/O长
度
备注
status String M
statusCodeData
StatusCodeData

StatusCodeData
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |

/O长
度
备注
subjectCode String M
reasonCode String M
message String M

3.2.17.1.1 响应消息样例

{
    "header":
    {
        "functionExecutionStatus":
        {
            "status": "Executed-Success",
            "statusCodeData":
            {
                "subjectCode": "0",
                "reasonCode": "0",
                "message": "success"
            }
        }
        ,
        "iccid": "89852342022019785558"
    }
}



## 3.2.18 渠道商自建套餐接口
3.2.18.1 接口功能
渠道商自建套餐接口
3.2.18.2 请求方法
请设置成“POST”。
3.2.18.3 请求 URI
http(s)://ip:port/aep/SBO_add_package/v1
3.2.18.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| name | String | M | 256 | 套餐名称 |
| desc | String | M | 256 | 描述 |
| keepPeriod | String | M | 128 | 套餐持续周期 |
| effectiveDay | String | O | 128 | 订购以后有效期 |
| flowLimitType | Integer | M | 10 | 流量限制类型 1-周期内限量 2-单日限量 |
| controlLogic | Integer | M | 10 | 达量控制逻辑 1-达量限速 2-达量释放 |
| isSupportedHotspots | Integer | M | 10 | 是否支持热点： 1-支持 2-不支持 |
| isSupportDirect | String | M | 128 | 是否支持定向应用： 1-支持 2-不支持 |
| packageConsumptions | List<PackageConsumption> | O |  |  |
| noLimitTemplateId | String | M | 128 | 无上限模板Id |
| mccList | List<String> | M |  | 支持的国家/地区数组，例： [406,407] 调用 |
| supportRefuel | Integer | M | 10 | 是否支持加油包： 1-支持 2-不支持 |
| refuelList | List<String> | O |  | 加油包ID数组 |
| directAppInfos | List<DirectAppInfo> | O |  | 定向应用信息 |
| periodUnit | String | O |  | 套餐周期类型 1：24小时 2：自然日 3：自然月 4：自然年 |

3.2.18.4.1 请求消息样例

{
    "accessToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoxMDYsInVzZXJpZCI6IjZiZGE2MGIx ZTA0ZTQ4ODA4NjlhZjkxNDQ4ODdmZGFiIiwiaWF0IjoxNzA5Nzk1Njk3fQ.rzAu8N9PDuM5j_ 3ON_1LPtHz8rHKbNFMMvc_k- EQTDgWnW1jHdI7ol0cHaWDWJ81Z12MPRC0KE4FM2UhLKuL0Q",
    "name": "haoran_1",
    "desc": "",
    "keepPeriod": "10",
    "effectiveDay": "180",
    "flowLimitType": 2,
    "controlLogic": 1,
    "isSupportedHotspots": 1,
    "packageConsumptions":
    [
        {
            "consumption": 100,
            "upccTemplateId": "P23061314267445"
        }
        ,
        {
            "consumption": 300,
            "upccTemplateId": "P23061314278118"
        }
    ]
    ,
    "noLimitTemplateId": "P23061314255918",
    "mccList":
    [
        "342",
        "402",
        "206"
    ]
    ,
    "supportRefuel": 1,
    "refuelList":
    [
        "R2402291445123241410",
        "R2402231520074242650"
    ]
    ,
    "isSupportDirect": "1",
    "directAppInfos":
    [
        {
            "appDetailInfos":
            [
                {
                    "appConsumption":
                    [
                        {
                            "consumption": 10240,
                            "upccTemplateId": "P24022110231944"
                        }
                        ,
                        {
                            "consumption": 102400,
                            "upccTemplateId": "P24022110247073"
                        }
                    ]
                    ,
                    "appId": "1760202763620319232",
                    "noLimitTemplateId": "P24022111211572"
                }
                ,
                {
                    "appConsumption":
                    [
                        {
                            "consumption": 10240,
                            "upccTemplateId": "P24022110212376"
                        }
                        ,
                        {
                            "consumption": 102400,
                            "upccTemplateId": "P24022110215681"
                        }
                    ]
                    ,
                    "appId": "1760202564336353280",
                    "noLimitTemplateId": "P24022111193893"
                }
            ]
            ,
            "directType": "2",
            "isUsePackage": "2"
        }
        ,
        {
            "appDetailInfos":
            [
                {
                    "appConsumption":
                    [
                    ]
                    ,
                    "appId": "1760202953232220160",
                    "noLimitTemplateId": "P24022111224160"
                }
            ]
            ,
            "directType": "1"
        }
    ]
}


3.2.18.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。0000000 - 成功 |
| description | String | O | 1024 | 返回码描述。 |
| data | String | M | 256 | 套餐id |

3.2.18.5.1 响应消息样例

{
    "code": "0000000",
    "description": "Success",
    "data": "D2403071535388188171"
}


## 3.2.19 渠道商修改套餐接口
3.2.19.1 接口功能
渠道商修改套餐接口
3.2.19.2 请求方法
请设置成“POST”。
3.2.19.3 请求 URI
http(s)://ip:port/aep/SBO_update_package/v1

3.2.19.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| id | String | M | 256 | 套餐id |
| name | String | O | 256 | 套餐名称 |
| desc | String | O | 256 | 套餐描述 |
| keepPeriod | String | O | 128 | 套餐持续周期 |
| effectiveDay | String | M | 128 | 订购以后有效期 |
| isSupportDirect | String | O | 128 | 是否支持定向应用： 1-支持 2-不支持 |
| packageConsumptions | List<PackageConsumption> | O |  |  |
| noLimitTemplateId | String | O | 128 | 无上限模板Id |
| mccList | List<String> | O |  | 支持国家/地区数组 |
| supportRefuel | Integer | O | 10 | 是否支持加油包： 1-支持 2-不支持 |
| refuelList | List<String> | O |  | 加油包ID数组 |
| directAppInfos | List<DirectAppInfo> | O |  | 定向应用信息 |

PackageConsumption
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| consumption | Integer | M |  | 用量 单位MB |
| upccTemplateId | Integer | M |  | Upcc模板ID |

DirectAppInfo
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| directType | String | M |  | 定向应用类型 1-限速 2-免流 |
| isUsePackage | String | O |  | 免流模式下流量用尽后是否继续使用套 餐通用流量 1-是 2-否 |
| appDetailInfos | List<AppDetailInfo> | M |  | 定向应用信息 |

AppDetailInfo
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| appId | String | M |  | 应用 id |
| noLimitTemplateId | String | O |  | 免流模式下该参数为流量用尽后的速度 模板 id 限速模式下为限速模板id |
| appConsumption | List<PackageConsumption> | O |  | 定向应用用量 |

3.2.19.4.1 请求消息样例

{
    "accessToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoxMDYsInVzZXJpZCI6IjZiZGE2 MGIxZTA0ZTQ4ODA4NjlhZjkxNDQ4ODdmZGFiIiwiaWF0IjoxNzA5NzgyMDEyfQ.UjFvt 2iInEZPJwIuTM0UJu8La4jhfNVtS3f8iCPs1j_vBLUKw8kiSrnKHkkR35fJtozF6Aqb1F51sn2-jnLFFg",
    "id": "D2402231109310122724",
    "keepPeriod": "14",
    "effectiveDay": "100"
}


3.2.19.5 响应消息
请求成功时响应消息体中的参数说明如下所示。

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。0000000 - 成功 |
| description | String | O | 1024 | 返回码描述。 |

3.2.19.5.1 响应消息样例
{
    "code": "0000000",
    "description": "Success"
}


## 3.2.20 渠道商删除套餐接口
3.2.20.1 接口功能
渠道商删除套餐接口
3.2.20.2 请求方法
请设置成“POST”。
3.2.20.3 请求 URI
http(s)://ip:port/aep/SBO_del_package/v1
3.2.20.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| id | String | M | 256 | 套餐id |

3.2.20.4.1 请求消息样例

{
    "accessToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoxMDYsInVzZXJpZCI6IjZiZGE2MGIx ZTA0ZTQ4ODA4NjlhZjkxNDQ4ODdmZGFiIiwiaWF0IjoxNzA5Nzk1Njk3fQ.rzAu8N9PDuM5j_ 3ON_1LPtHz8rHKbNFMMvc_k- EQTDgWnW1jHdI7ol0cHaWDWJ81Z12MPRC0KE4FM2UhLKuL0Q",
    "id": "D2403071535388188171"
}


3.2.20.5 、响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。0000000 - 成功 |
| description | String | O | 1024 | 返回码描述。 |

3.2.20.5.1 响应消息样例

{
    "code": "0000000",
    "description": "Success"
}



## 3.2.21 渠道商自建加油包接口
3.2.21.1 接口功能
渠道商自建加油包接口
3.2.21.2 请求方法
请设置成“POST”。
3.2.21.3 请求 URI
http(s)://ip:port/aep/SBO_add_packageRefuel/v1
3.2.21.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| flowValue | String | M | 256 | 流量值 单位MB |

3.2.21.4.1 请求消息样例
{
    "accessToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoxMDYsInVzZXJpZCI6IjZiZGE2MGIx  ZTA0ZTQ4ODA4NjlhZjkxNDQ4ODdmZGFiIiwiaWF0IjoxNzA5Nzk1Njk3fQ.rzAu8N9PDuM5j_ 3ON_1LPtHz8rHKbNFMMvc_k- EQTDgWnW1jHdI7ol0cHaWDWJ81Z12MPRC0KE4FM2UhLKuL0Q",
    "flowValue": "40960"
}


3.2.21.5 、响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。0000000 - 成功 |
| description | String | O | 1024 | 返回码描述。 |
| data | RefuelPackInfo | M |  | 加油包信息 |

3.2.21.5.1 响应消息样例
{
    "code": "0000000",
    "description": "Success",
    "data":
    {
        "id": "R2403071521207715011",
        "name": "40960MB add-on"
    }
}


## 3.2.22 渠道商加油包查询接口
3.2.22.1 接口功能
查询渠道商加油包接口
3.2.22.2 请求方法
请设置成“POST”。
3.2.22.3 请求 URI
http(s)://ip:port/aep/SBO_query_packageRefuel/v1

3.2.22.4 请求消息
请求消息体中的参数说明如下所示。

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| pageNo | String | O | 10 | 当前页 默认1 |
| pageSize | String | O | 10 | 页大小 默认10 |

3.2.22.4.1 请求消息样例
{
    "accessToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoxMDYsInVzZXJpZCI6IjZiZGE2MGIx ZTA0ZTQ4ODA4NjlhZjkxNDQ4ODdmZGFiIiwiaWF0IjoxNzA5Nzk1Njk3fQ.rzAu8N9PDuM5j_ 3ON_1LPtHz8rHKbNFMMvc_k- EQTDgWnW1jHdI7ol0cHaWDWJ81Z12MPRC0KE4FM2UhLKuL0Q",
    "pageNo": "1",
    "pageSize":""
}


3.2.22.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。0000000 - 成功 |
| description | String | O | 1024 | 返回码描述。 |
| data | List<RefuelPack> | M |  |  |

RefuelPack
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| id | String | M | 128 | 加油包id |
| name | String | M | 256 | 加油包名称 |
| flowValue | Integer | M | 10 | 流量值 |
| flowUnit | Integer | M | 1 | 流量值单位 1-MB |

3.2.22.5.1 响应消息样例

{
    "code": "0000000",
    "description": "Success",
    "data":
    [
        {
            "id": "R2403071521207715011",
            "name": "40960MB add-on",
            "flowValue": 40960,
            "flowUnit": "1"
        }
        ,
        {
            "id": "R2402291445123241410",
            "name": "20480MB add-on",
            "flowValue": 20480,
            "flowUnit": "1"
        }
        ,
        {
            "id": "R2402231520074242650",
            "name": "10240MB add-on",
            "flowValue": 10240,
            "flowUnit": "1"
        }
        ,
        {
            "id": "R2402221642265481584",
            "name": "1024MB add-on",
            "flowValue": 1024,
            "flowUnit": "1"
        }
        ,
        {
            "id": "R2402221627575904176",
            "name": "500MB add-on",
            "flowValue": 500,
            "flowUnit": "1"
        }
    ]
    ,
    "count": 5
}



## 3.2.23 渠道商删除加油包接口
3.2.23.1 接口功能
渠道商删除加油包接口
3.2.23.2 请求方法
请设置成“POST”。
3.2.23.3 请求 URI
http(s)://ip:port/aep/SBO_del_packageRefuel/v1
3.2.23.4 请求消息
请求消息体中的参数说明如下所示。

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| refuelId | String | M | 256 | 加油包ID |

3.2.23.4.1 请求消息样例

{
    "accessToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoxMDYsInVzZXJpZCI6IjZiZGE2MGIx ZTA0ZTQ4ODA4NjlhZjkxNDQ4ODdmZGFiIiwiaWF0IjoxNzA5Nzk1Njk3fQ.rzAu8N9PDuM5j_ 3ON_1LPtHz8rHKbNFMMvc_k- EQTDgWnW1jHdI7ol0cHaWDWJ81Z12MPRC0KE4FM2UhLKuL0Q",
    "refuelId": "R2402221642190475846"
}


3.2.23.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。0000000 - 成功 |
| description | String | O | 1024 | 返回码描述。 |

3.2.23.5.1 响应消息样例

{
    "code": "0000000",
    "description": "Success"
}


## 3.2.24 查询渠道商关联应用接口
3.2.24.1 接口功能
查询渠道商关联应用API接口
3.2.24.2 请求方法
请设置成“POST”。
3.2.24.3 请求 URI
http(s)://ip:port/aep/SBO_channel_app/v1
3.2.24.4 请求消息
请求消息体中的参数说明如下所示。

| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| accessToken | String | M |  | 获取的accessToken信息 |
| appName | String |  |  | Ｏ 10 应用名称 |

3.2.24.4.1 请求消息样例

{
    "accessToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoxMDYsInVzZXJpZCI6IjZiZGE2MGIx ZTA0ZTQ4ODA4NjlhZjkxNDQ4ODdmZGFiIiwiaWF0IjoxNzA5Nzk1Njk3fQ.rzAu8N9PDuM5j_ 3ON_1LPtHz8rHKbNFMMvc_k- EQTDgWnW1jHdI7ol0cHaWDWJ81Z12MPRC0KE4FM2UhLKuL0Q",
    "appName": ""
}


3.2.24.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。0000000 - 成功 |
| description | String | O | 1024 | 返回码描述。 |
| data | List<PackageDirectionalDTO> | M |  |  |

PackageDirectionalDTO
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| id | String | M | 128 | 应用 id |
| appName | String | M | 256 | 应用名称 |
| appUpccInfo | List<AppUpccInfo> | M |  | 应用模板列表 |

AppUpccInfo
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| upccTemplateId | String | M | 128 | 模板 id |
| templateName | String | M | 256 | 模板名称 |
| templateDesc | String | M | 256 | 模板描述 |
| rate | Integer | M | 10 | 速率 |
| unit | String | M | 256 | 速率单位 1:kb/s 2:mb/s |

3.2.24.5.1 响应消息样例

{
    "code": "0000000",
    "description": "Success",
    "data":
    [
        {
            "id": "1760202564336353280",
            "appName": "youtube",
            "appUpccInfo":
            [
                {
                    "upccTemplateId": "P24022110212376",
                    "templateName": "youtube-² » Ï Þ Ë Ù",
                    "templateDesc": "Ê ¹ ÓÃyoutube ² » Ï Þ Ë Ù ¿ É Î Þ Ï Þ Ê ¹ ÓÃ\n",
                    "rate": 256,
                    "unit": "2"
                }
                ,
                {
                    "upccTemplateId": "P24022110215681",
                    "templateName": "youtube-10M",
                    "templateDesc": "g_default_youtube_10m\n",
                    "rate": 10,
                    "unit": "2"
                }
                ,
                {
                    "upccTemplateId": "P24022110219677",
                    "templateName": "youtube-1M",
                    "templateDesc": "g_default_youtube_1m\n",
                    "rate": 1,
                    "unit": "2"
                }
                ,
                {
                    "upccTemplateId": "P24022111193893",
                    "templateName": "youtube-0kb",
                    "templateDesc": "g_default_youtube_block\n",
                    "rate": 0,
                    "unit": "2"
                }
            ]
        }
        ,
        {
            "id": "1760202763620319232",
            "appName": "iqiyi",
            "appUpccInfo":
            [
                {
                    "upccTemplateId": "P24022110231944",
                    "templateName": "iqiyi-² » Ï Þ Ë Ù",
                    "templateDesc": "g_default_iqiyi_256M\n",
                    "rate": 256,
                    "unit": "2"
                }
                ,
                {
                    "upccTemplateId": "P24022110247073",
                    "templateName": "iqiyi-1M",
                    "templateDesc": "g_default_iqiyi_1M\n",
                    "rate": 1,
                    "unit": "2"
                }
                ,
                {
                    "upccTemplateId": "P24022110248122",
                    "templateName": "iqiyi-10M",
                    "templateDesc": "g_default_iqiyi_10M\n",
                    "rate": 10,
                    "unit": "2"
                }
                ,
                {
                    "upccTemplateId": "P24022111211572",
                    "templateName": "iqiyi-okb",
                    "templateDesc": "g_default_iqiyi_block\n",
                    "rate": 0,
                    "unit": "2"
                }
            ]
        }
        ,
        {
            "id": "1760202953232220160",
            "appName": "youku",
            "appUpccInfo":
            [
                {
                    "upccTemplateId": "P24022110220513",
                    "templateName": "youku-10M",
                    "templateDesc": "g_default_youku_10M\n",
                    "rate": 10,
                    "unit": "2"
                }
                ,
                {
                    "upccTemplateId": "P24022110228830",
                    "templateName": "youku-² » Ï Þ Ë Ù",
                    "templateDesc": "g_default_youku_256M \n",
                    "rate": 256,
                    "unit": "2"
                }
                ,
                {
                    "upccTemplateId": "P24022110235743",
                    "templateName": "youku-1M",
                    "templateDesc": "g_default_youku_1M\n",
                    "rate": 1,
                    "unit": "2"
                }
                ,
                {
                    "upccTemplateId": "P24022111224160",
                    "templateName": "youku-0kb",
                    "templateDesc": "g_default_youku_block\n",
                    "rate": 0,
                    "unit": "2"
                }
            ]
        }
    ]
}



## 3.2.25 渠道商关联国家查询接口
3.2.25.1 接口功能
渠道商关联国家API接口
3.2.25.2 请求方法
请设置成“POST”。
3.2.25.3 请求 URI
http(s)://ip:port/aep/APP_getCountryGroupInfo_SBO/v1
3.2.25.4 请求消息
请求消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| isSupportedHotspots | String | M | 1 | 是否支持热点 1：支持 2：不支持 |
| accessToken | String | M |  | 获取的accessToken信息 |

3.2.25.4.1 响应消息样例

{
    "accessToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJyb2xlIjoxMDYsInVzZXJpZCI6IjZiZGE2MGIx ZTA0ZTQ4ODA4NjlhZjkxNDQ4ODdmZGFiIiwiaWF0IjoxNzA5Nzk1Njk3fQ.rzAu8N9PDuM5j_ 3ON_1LPtHz8rHKbNFMMvc_k- EQTDgWnW1jHdI7ol0cHaWDWJ81Z12MPRC0KE4FM2UhLKuL0Q",
    "isSupportedHotspots": "2"
}


3.2.25.5 响应消息
请求成功时响应消息体中的参数说明如下所示。
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| code | String | M | 10 | 返回码。0000000 - 成功 |
| msg | String | O | 1024 | 返回码描述。 |
| data | List<CardPoolMccDTO> | M |  | 渠道商关联国家信息 |

CardPoolMccDTO
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| mcc | String | M |  | Mcc |
| countryName | String | M |  | 国家名称 |
| consumption | List<MccInfoDTO> | M |  | 国家用量信息 |

MccInfoDTO
| 参数名 | 类型 | M/O | 长度 | 说明 |
| --- | --- | --- | --- | --- |
| consumption | BigInteger | O |  | 当国家不存在用量分档的时候为空，单 位 MB |
| is_only_supported_hotspots | String | M |  | 是否只支持热点 1：是(此国家只能用以支持热点套餐) 2：否(此国家可以被任何套餐使用) |

3.2.25.5.1 响应消息样例

{
    "code": "0000000",
    "msg": "Success",
    "cardPoolMccDTOS":
    [
        {
            "mcc": "342",
            "countryName": "Barbados",
            "consumption":
            [
                {
                    "consumption": null,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
        ,
        {
            "mcc": "454",
            "countryName": "Hong Kong",
            "consumption":
            [
                {
                    "consumption": 500,
                    "isOnlySupportedHotspots": "2"
                }
                ,
                {
                    "consumption": 1024,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
        ,
        {
            "mcc": "455",
            "countryName": "Macau",
            "consumption":
            [
                {
                    "consumption": null,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
        ,
        {
            "mcc": "257",
            "countryName": "Belarus",
            "consumption":
            [
                {
                    "consumption": null,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
        ,
        {
            "mcc": "402",
            "countryName": "Bhutan",
            "consumption":
            [
                {
                    "consumption": null,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
        ,
        {
            "mcc": "206",
            "countryName": "Belgium",
            "consumption":
            [
                {
                    "consumption": null,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
        ,
        {
            "mcc": "702",
            "countryName": "Belize",
            "consumption":
            [
                {
                    "consumption": null,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
        ,
        {
            "mcc": "736",
            "countryName": "Bolivia",
            "consumption":
            [
                {
                    "consumption": null,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
        ,
        {
            "mcc": "616",
            "countryName": "Benin",
            "consumption":
            [
                {
                    "consumption": null,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
        ,
        {
            "mcc": "338$$$$$$",
            "countryName": "Bermuda",
            "consumption":
            [
                {
                    "consumption": null,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
        ,
        {
            "mcc": "460",
            "countryName": "China",
            "consumption":
            [
                {
                    "consumption": 100,
                    "isOnlySupportedHotspots": "2"
                }
                ,
                {
                    "consumption": 300,
                    "isOnlySupportedHotspots": "2"
                }
                ,
                {
                    "consumption": 10240,
                    "isOnlySupportedHotspots": "2"
                }
            ]
        }
    ]
}

4 HTTP 状态码
步骤 1 GET方法
200 OK：获取资源成功。
302 FOUND：重定向响应。可以直接通过GET方法获取定位响应消息头中URI对应
的资源。
500 SERVER ERROR：服务内部错误。
步骤 2 POST方法
200 OK：更新资源成功。
201 CREATED: 新增资源成功。

400 BAD REQUEST：参数错误，或参数格式错误。
步骤 3 通用状态码
401 UNAUTHORIZED：鉴权失败。或所请求资源不属于对应账号不属于鉴权账号的
子账号。或所查询的资源不属于请求账号的资源。
404 NOT FOUND：资源找不到。
405 METHOD NOT ALLOWED：资源对应该方法不支持。
429 TOO MANY REQUESTS：同一时间请求数过多。
500 SERVER ERROR：服务器内部错误。
5 通用返回码
表5-1 通用返回码
返回码 描述
0000000 成功。
1000000 缺少Authorization请求头/Authorization请求头错误/鉴权失
败，缺少X-WSSE请求头/X-WSSE请求头格式错误
1000001 PasswordDigest鉴权失败
1000002 UserName校验失败
1000003 Nonce校验失败。
1000004 Created校验失败。
1000005 必填参数{参数名变量}为空，
1000006 非法调用（App Key）不存在
1000007 参数{参数名变量}格式错误，不符合规范
1000008 accessToken校验失败原因
1000009 验证码已过期

返回码 描述
1000010 无可用激活套餐
1000012 imsi不存在
1000013 iccid不存在。
1000014 MSISDN不存在
1000015 套餐分数不足，促销套餐已超过购买数目
1000016 用户名已存在
1000017 验证码验证错误
1000018 原始密码不匹配
1000019 登录认证失败，请重试。
1000020 ICCID已绑定，不允重复绑定。
1000021 主卡已出库，则不让修改。
1000022 当月有激活记录，不允许修改
1000023 合作商扣费失败
1000024 套餐释放失败，UPCC销户失败
1000025 套餐失败
1000026 终端厂商接口调用异常
1000027 卡池IMSI不足
1000028 订单ID错误
1000029 主卡非正常状态，不予订购套餐
1000030 部分退订失败，退订分数不足
1000031 当前无已激活套餐，不允许购买加油包
1000032 流水编码重复，充值失败
1000033 充值币种错误，充值失败
1000034 币种与渠道商币种不一致，操作失败
1000035 订单时间与当前月份不一致，不支持退订
1000036 充值类型错误，充值失败(押金模式/预存模式无此充值类型)
1000037 充值后可用额度小于0，充值失败
1000038 未找到渠道商信息，操作失败
1000039 订单不存在，退订失败

返回码 描述
1000040 退订订单类型只支持套餐
1000041 退订订单状态只支持已完成
1000042 子单状态不统一，退订失败
1000043  套餐部分为已激活，操作失败
1000044 套餐非待激活状态，退订失败
1000045 套餐个数与子单个数不一致，退订失败
1000046 退订失败，请稍后重试
1000047 退款失败
1000048 充值后总额度不足，充值失败
1000049 充值后已用额度不足，充值失败
1000050 密码错误次数已达上限，账户锁定，请稍后再试
1000051 用户或密码错误
1000052 操作失败
1000053 账户不存在
1000054 当前用户类型无此操作权限
1000055 签名验证失败
1000056 主卡已过期
1000057 位置查询失败
1000058 Package does not support this country
1000059 Activation failed
1000060 The real name registration is incomplete, activationfailed
1000062 当前主卡销户已超过保留时间不允许修改状态
1000063 转省移动卡不存在厂商信息，不允许修改类型
1000065 Invalid ICCID (Non-CMI card or non ready to sell card)
1000066 The origin customer of card and data pool do not match
1000067 The card already exists in the data pool
1000068 Iccid import failed, please contact the administrator
1000069 The flow pool cycle is not in use (the validity period

返回码 描述
of the flow pool has expired)
1000070 The Data pool has not been approved and cannot be import
1000071 操作类型错误
1000072 没有查询到该批次卡
1000073 ICCID {}不属于该渠道商
1000074 流量池列表查询失败
1000076 No permission to operate this IMSI or ICCID
1000077 Did not order the card or package
1000079 临时用户只允许购买卡+套餐
1000081 渠道商用户/iccid 用户只允许购买套餐/加油包
1000082 缺少收货人地址信息
1000083 币种输入错误
1000084 个人用户不存在
1000085 客户信息不存在
1000086 Non CMI card, add-on pack/package ordering is not allowed
1000087 套餐指定激活日期为空或不在可允许范围内
1000088 主卡信息不存在
1000089 主卡类型为合作发卡
1000090 主卡形态不是eSIM 卡
1000091 主卡已出库
1000094 No activated package, add-on pack ordering is not allowed
1000095 Purchase quantity can only be 1 or X ( X is the remaining days of the
package)Package
1000096 Package does not exist or does not support add-on pack
1000097 Add-on pack is not allowed to order or has not been approved
1000099 The channel information does not exist or the status is abnormal
1000100 The current status is not allowed to order
1000101 The card has been attributed to other customers
1000102 Purchased failed, the currency is mismatch
1000103 Purchase failure, insufficient deposit

返回码 描述
1000105 不允许购买该套餐
1000107 iccid、orderID 必须填写一项
1000108 手机号、邮箱必须填写一项
1000109 护照国家必填不能为空
1000110 旧证件类型和ID 必须同时填写/不填写
1000111 出生年月格式错误：YYYYMMDD
1000112 证件图片仅支持JPG/PNG
1000113 证件图片尺寸不小于15×15 像素，最长边不超过4096 像素
1000114 证件图片文件大小不超过10MB
1000115 获取主卡信息失败,请确认ICCID 是否正确
1000116 获取订单信息失败,请确认订单是否存在
1000117 当前iccid/orderID 已存在在用状态信息
1000118 卡+套餐订单已实名认证通过不允许再次认证
1000119 获取规则信息失败,请确认认证编码是否正确
1000120 加密水印图片保存失败,请确认上传文件是否正确
1000121 当前证件已绑定卡数量超出X，限制1 证绑定X 个号码
1000122 旧证件类型/ID 不存在在用，不允许修改认证信息
1000123 旧认证信息姓名与输入姓名不一致，不允许修改认证信息
1000124 护照类型不符合要求
1000125 该认证请求正在处理中，请勿重复提交
1000126 H5 实名认证失败
1000127 未查询到当前订单订购的套餐
1000129 获取plmns 信息失败
1000131 没有找到厂商
1000132 没有找到套餐信息
1000134 无法获取vimsi 资源
1000135 该套餐对应的所有卡池中已没有vimsi 资源
1000136 分配V 卡 KI 不能为空
1000137 分配V 卡 KI 加密失败

返回码 描述
1000138 HSS 开户失败
1000139 Upcc 开户失败
1000140 验签失败
1000141 上传的文件大小过大
1000150 Wrong package data limit type
1000151 套餐状态不正常
1000152 超出促销套餐购买份数限制
1000153 主卡状态不正常
1000154 订单正在处理中，请勿重复提交
1000155 渠道商类型错误，充值失败
1000156 没有查询到该卡
1000158 Add-on pack is not associated with package
1000159 套餐组不存在
1000160 套餐组详情不存在
1000161 The card type is cooperative card issuance, and package/add-on
purchase is not allowed
1000162 交易流水号已存在，订单创建失败
1000163 不允许订购
1000164 iccid 为空
1000165 cmccNumber 或者cmccNumberProvince 为空
1000166 订单数量不唯一，操作失败
1000167 号码对应关系错误
1000168 无权限操作此速度模板id
1000169 当前在用套餐非此套餐，不能进行控速
1000170 未找到upcc 签约Id，控速失败
1000171 V 卡非动态签约卡池，不能进行控速
1000172 未找到符合要求的套餐
1000173 未查询到卡位置信息，无法进行控速
1000174 非渠道商用户

返回码 描述
1000175 此卡不属于渠道商
1000176 网络阻塞
1000177 ocr 识别异常
1000178 证件过期时间格式错误
1000179 证件已过期
1000180 未满16 周岁
1000201 参数格式错误，第三方订单id 和订单id 不能同时为空
2000000-2000006 Failed to call the service remotely

9000001 数据库异常
9000002 文件IO异常
9000003 服务网络波动，连接失败
9000004 超出QPS限制
9999999 其他系统级异常，异常返回描述与操作相关，便于定位异常功能
点。