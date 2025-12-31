import { configuration } from '../configuration'

type TenantAccessTokenResponse = {
    code?: number
    msg?: string
    tenant_access_token?: string
    expire?: number
}

export type FeishuApiResponse<T> = {
    code?: number
    msg?: string
    data?: T
}

type TokenCache = {
    value: string
    expiresAt: number
}

let tokenCache: TokenCache | null = null

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '')
}

export function getFeishuBaseUrl(): string {
    const fallback = 'https://open.feishu.cn'
    const baseUrl = configuration.feishuBaseUrl || fallback
    return normalizeBaseUrl(baseUrl || fallback)
}

export async function getFeishuTenantAccessToken(): Promise<string> {
    if (!configuration.feishuAppId || !configuration.feishuAppSecret) {
        throw new Error('Feishu appId/appSecret is not configured')
    }

    if (tokenCache && Date.now() < tokenCache.expiresAt) {
        return tokenCache.value
    }

    const url = `${getFeishuBaseUrl()}/open-apis/auth/v3/tenant_access_token/internal`
    const response = await postJson<TenantAccessTokenResponse>(url, {
        app_id: configuration.feishuAppId,
        app_secret: configuration.feishuAppSecret
    })

    if (response?.code && response.code !== 0) {
        throw new Error(`Feishu auth failed: ${response.msg || response.code}`)
    }
    if (!response?.tenant_access_token) {
        throw new Error('Feishu auth failed: missing tenant_access_token')
    }

    const expireSeconds = typeof response.expire === 'number' ? response.expire : 0
    const expiresAt = Date.now() + Math.max(0, expireSeconds - 60) * 1000
    tokenCache = {
        value: response.tenant_access_token,
        expiresAt
    }
    return response.tenant_access_token
}

export async function feishuPost<T>(
    path: string,
    body: unknown,
    token?: string
): Promise<FeishuApiResponse<T>> {
    const url = path.startsWith('http') ? path : `${getFeishuBaseUrl()}${path}`
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    }
    if (token) {
        headers.Authorization = `Bearer ${token}`
    }
    return await postJson<FeishuApiResponse<T>>(url, body, headers)
}

async function postJson<T>(
    url: string,
    body: unknown,
    headers: Record<string, string> = {}
): Promise<T> {
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    })
    return await parseJsonResponse<T>(response)
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text()
    let data: unknown = {}
    if (text) {
        try {
            data = JSON.parse(text)
        } catch {
            data = { raw: text }
        }
    }
    if (!response.ok) {
        const message = typeof data === 'object' && data ? JSON.stringify(data) : text
        throw new Error(`Feishu HTTP ${response.status}: ${message}`)
    }
    return data as T
}
