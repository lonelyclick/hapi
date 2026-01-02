#!/bin/bash
set -e

cd "$(dirname "$0")"

export PATH="$HOME/.bun/bin:$PATH"

EXE_PATH="cli/dist-exe/bun-linux-x64/hapi"

echo "=== Committing and pushing changes..."
git add -A
git commit -m "deploy" --allow-empty || true
git push

echo "=== Building single executable..."
bun run build:single-exe
sync

# 验证构建成功
if [[ ! -f "$EXE_PATH" ]]; then
    echo "ERROR: Build failed - executable not found"
    exit 1
fi

EXE_TIME=$(stat -c %Y "$EXE_PATH")
NOW=$(date +%s)
AGE=$((NOW - EXE_TIME))

if [[ $AGE -gt 60 ]]; then
    echo "ERROR: Executable is $AGE seconds old - build may have failed"
    exit 1
fi

echo "=== Build verified (age: ${AGE}s)"

echo "=== Killing old processes..."
fuser -k 3006/tcp 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true

echo "=== Restarting services..."
echo "guang" | sudo -S systemctl restart hapi-daemon.service
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
