#!/bin/bash
# HAPI API 调用帮助脚本
# 自动处理认证和 Token 获取

set -e

HAPI_SERVER="${HAPI_SERVER:-http://localhost:3006}"
SETTINGS_FILE="${HOME}/.hapi/settings.json"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 获取 CLI API Token
get_cli_token() {
    if [[ -f "$SETTINGS_FILE" ]]; then
        jq -r '.cliApiToken // empty' "$SETTINGS_FILE" 2>/dev/null
    fi
}

# 获取 JWT Token
get_jwt_token() {
    local cli_token=$(get_cli_token)
    if [[ -z "$cli_token" ]]; then
        echo -e "${RED}Error: CLI API Token not found in $SETTINGS_FILE${NC}" >&2
        exit 1
    fi

    local response=$(curl -s -X POST "${HAPI_SERVER}/api/auth" \
        -H "Content-Type: application/json" \
        -d "{\"accessToken\": \"${cli_token}\"}")

    local token=$(echo "$response" | jq -r '.token // empty')
    if [[ -z "$token" ]]; then
        echo -e "${RED}Error: Failed to get JWT token${NC}" >&2
        echo "$response" >&2
        exit 1
    fi

    echo "$token"
}

# 调用 API
call_api() {
    local method="$1"
    local endpoint="$2"
    local data="$3"

    local jwt_token=$(get_jwt_token)

    if [[ "$method" == "GET" ]]; then
        curl -s -X GET "${HAPI_SERVER}/api${endpoint}" \
            -H "Authorization: Bearer ${jwt_token}" \
            -H "Content-Type: application/json"
    else
        curl -s -X "$method" "${HAPI_SERVER}/api${endpoint}" \
            -H "Authorization: Bearer ${jwt_token}" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

# 显示帮助
show_help() {
    echo "HAPI API 调用帮助脚本"
    echo ""
    echo "用法: $0 <command> [args]"
    echo ""
    echo "命令:"
    echo "  trigger-review [daily|proactive]  触发 Advisor 审查"
    echo "  suggestions                       获取待处理建议"
    echo "  accept <suggestion_id>            接受建议"
    echo "  reject <suggestion_id>            拒绝建议"
    echo "  sessions                          获取会话列表"
    echo "  api <method> <endpoint> [data]    自定义 API 调用"
    echo "  token                             获取 JWT Token"
    echo ""
    echo "示例:"
    echo "  $0 trigger-review daily"
    echo "  $0 suggestions"
    echo "  $0 api GET /sessions"
    echo "  $0 api POST /settings/advisor/trigger-review '{\"type\":\"daily\"}'"
}

# 主函数
case "$1" in
    trigger-review)
        review_type="${2:-daily}"
        echo -e "${YELLOW}Triggering ${review_type} review...${NC}"
        result=$(call_api POST "/settings/advisor/trigger-review" "{\"type\":\"${review_type}\"}")
        echo "$result" | jq .
        ;;

    suggestions)
        echo -e "${YELLOW}Getting pending suggestions...${NC}"
        result=$(call_api GET "/settings/advisor/suggestions")
        echo "$result" | jq .
        ;;

    accept)
        if [[ -z "$2" ]]; then
            echo -e "${RED}Error: suggestion_id required${NC}"
            exit 1
        fi
        echo -e "${YELLOW}Accepting suggestion $2...${NC}"
        result=$(call_api POST "/settings/advisor/suggestions/$2/accept" "{}")
        echo "$result" | jq .
        ;;

    reject)
        if [[ -z "$2" ]]; then
            echo -e "${RED}Error: suggestion_id required${NC}"
            exit 1
        fi
        echo -e "${YELLOW}Rejecting suggestion $2...${NC}"
        result=$(call_api POST "/settings/advisor/suggestions/$2/reject" "{}")
        echo "$result" | jq .
        ;;

    sessions)
        echo -e "${YELLOW}Getting sessions...${NC}"
        result=$(call_api GET "/sessions")
        echo "$result" | jq .
        ;;

    api)
        if [[ -z "$2" ]] || [[ -z "$3" ]]; then
            echo -e "${RED}Error: method and endpoint required${NC}"
            exit 1
        fi
        result=$(call_api "$2" "$3" "$4")
        echo "$result" | jq . 2>/dev/null || echo "$result"
        ;;

    token)
        get_jwt_token
        ;;

    help|--help|-h)
        show_help
        ;;

    *)
        show_help
        exit 1
        ;;
esac
