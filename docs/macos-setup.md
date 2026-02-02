# macOS Daemon Setup

## Problem: WebSocket Connection Failing

When HAPI daemon connects through Cloudflare proxy (`https://remote.yohomobile.dev`), WebSocket connection fails with 401 errors.

**Solution:** Use internal network URL to bypass Cloudflare.

## Configuration

For macmini (or any macOS machine on the same internal network as the HAPI server):

```bash
# Internal network URL (replace with your server's internal IP)
export HAPI_SERVER_URL="http://192.168.0.32:3006"

# Full PATH including /usr/local/bin
export PATH="/usr/local/bin:/Users/guang/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Explicit path to claude executable (if not in standard PATH)
export HAPI_CLAUDE_PATH="/usr/local/bin/claude"
```

## Daemon Control Script

The `hapi-daemon.sh` script provides convenient daemon management:

```bash
cd ~/softwares/hapi
./hapi-daemon.sh start    # Start daemon
./hapi-daemon.sh stop     # Stop daemon
./hapi-daemon.sh restart  # Restart daemon
./hapi-daemon.sh status   # Show status
./hapi-daemon.sh logs     # Show recent logs
```

## Script Template

```bash
#!/bin/zsh
# HAPI Daemon Control Script for macOS

export CLI_API_TOKEN="your-token-here"
export HAPI_SERVER_URL="http://192.168.0.32:3006"
export PATH="/usr/local/bin:/Users/guang/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HAPI_CLAUDE_PATH="/usr/local/bin/claude"

HAPI_DIR="/Users/guang/softwares/hapi"
DAEMON_BIN="${HAPI_DIR}/cli/dist-exe/bun-darwin-arm64/hapi-daemon"

# Start daemon with environment
nohup env PATH="$PATH" CLI_API_TOKEN="$CLI_API_TOKEN" \
     HAPI_SERVER_URL="$HAPI_SERVER_URL" HAPI_CLAUDE_PATH="$HAPI_CLAUDE_PATH" \
     "$DAEMON_BIN" > ~/.hapi/logs/daemon.stdout.log 2>&1 &
```

## Auto-Start (Optional)

To auto-start daemon on login, create a LaunchAgent:

```bash
~/Library/LaunchAgents/com.hapi.daemon.plist
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hapi.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/guang/softwares/hapi/hapi-daemon.sh</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/guang/.hapi/logs/launchagent.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/guang/.hapi/logs/launchagent.stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/Users/guang/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HAPI_CLAUDE_PATH</key>
        <string>/usr/local/bin/claude</string>
    </dict>
</dict>
</plist>
```

Load with:
```bash
launchctl load ~/Library/LaunchAgents/com.hapi.daemon.plist
```
