#!/bin/bash
set -e

cd "$(dirname "$0")"

export PATH="$HOME/.bun/bin:$PATH"

echo "Committing and pushing changes..."
git add -A
git commit -m "deploy" --allow-empty || true
git push

echo "Building single executable..."
bun run build:single-exe
sync

echo "Restarting services..."
echo "guang" | sudo -S systemctl restart hapi-daemon.service
echo "guang" | sudo -S systemctl restart hapi-server.service

echo "Done!"
