#!/bin/bash
set -e

cd "$(dirname "$0")"

export PATH="$HOME/.bun/bin:$PATH"

SERVER_EXE="cli/dist-exe/bun-linux-x64/hapi-server"
DAEMON_EXE="cli/dist-exe/bun-linux-x64/hapi-daemon"

# 解析参数
BUILD_DAEMON=false
for arg in "$@"; do
    case $arg in
        --daemon)
            BUILD_DAEMON=true
            ;;
    esac
done

echo "=== Committing and pushing changes..."
git add -A
git commit -m "deploy" --allow-empty || true
git push

# 生成东八区时间戳版本号 (v2026.01.02.1344)
VERSION="v$(TZ='Asia/Shanghai' date '+%Y.%m.%d.%H%M')"
echo "=== Updating version to $VERSION..."
cd cli
# 使用 node 来更新 package.json 的版本号
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('Updated cli/package.json version to $VERSION');
"
cd ..

# 构建 web 前端
echo "=== Building web assets..."
bun run build:web
(cd server && bun run generate:embedded-web-assets)

# 构建 server
echo "=== Building hapi-server..."
(cd cli && bun run build:exe:server)
sync

# 验证 server 构建成功
if [[ ! -f "$SERVER_EXE" ]]; then
    echo "ERROR: Server build failed - executable not found"
    exit 1
fi

SERVER_TIME=$(stat -c %Y "$SERVER_EXE")
NOW=$(date +%s)
SERVER_AGE=$((NOW - SERVER_TIME))

if [[ $SERVER_AGE -gt 60 ]]; then
    echo "ERROR: Server executable is $SERVER_AGE seconds old - build may have failed"
    exit 1
fi

echo "=== Server build verified (age: ${SERVER_AGE}s)"

# 构建主 CLI (用于 spawn session，不会触发 daemon 重启)
echo "=== Building hapi CLI..."
(cd cli && bun run build:exe)
sync

# 如果需要，构建 daemon
if [[ "$BUILD_DAEMON" == "true" ]]; then
    echo "=== Building hapi-daemon..."
    (cd cli && bun run build:exe:daemon)
    sync

    if [[ ! -f "$DAEMON_EXE" ]]; then
        echo "ERROR: Daemon build failed - executable not found"
        exit 1
    fi

    DAEMON_TIME=$(stat -c %Y "$DAEMON_EXE")
    DAEMON_AGE=$((NOW - DAEMON_TIME))

    if [[ $DAEMON_AGE -gt 60 ]]; then
        echo "ERROR: Daemon executable is $DAEMON_AGE seconds old - build may have failed"
        exit 1
    fi

    echo "=== Daemon build verified (age: ${DAEMON_AGE}s)"
fi

echo "=== Killing old processes..."
fuser -k 3006/tcp 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true

echo "=== Restarting services..."
if [[ "$BUILD_DAEMON" == "true" ]]; then
    echo "    (with daemon restart)"
    echo "guang" | sudo -S systemctl restart hapi-daemon.service
fi
echo "guang" | sudo -S systemctl restart hapi-server.service

# 等待服务启动
sleep 2

# 验证服务运行
if ! systemctl is-active --quiet hapi-server.service; then
    echo "ERROR: hapi-server.service failed to start"
    echo "guang" | sudo -S journalctl -u hapi-server.service -n 20 --no-pager
    exit 1
fi

echo "=== Done! Services restarted successfully."
if [[ "$BUILD_DAEMON" == "true" ]]; then
    echo "    (daemon was rebuilt and restarted)"
else
    echo "    (daemon was NOT rebuilt - sessions should remain online)"
fi
