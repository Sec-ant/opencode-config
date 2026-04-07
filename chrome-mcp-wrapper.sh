#!/bin/bash
# Wrapper script: launches Windows Chromium with remote-debugging-port,
# then starts chrome-devtools-mcp connecting via --browserUrl.
# When MCP exits, Chrome is automatically killed.
#
# IMPORTANT: Windows .exe called via WSL interop consume stdin.
# We must save stdin (fd 3) before any .exe calls, then restore it for npx.

CHROME_EXE="/mnt/c/Users/Secant/AppData/Local/Chromium/Application/chrome.exe"
CHROME_PORT=9222
USER_DATA_DIR="C:/Temp/chromium-mcp"          # Windows path for chrome.exe
USER_DATA_DIR_WSL="/mnt/c/Temp/chromium-mcp"  # WSL path for shell commands
UBLOCK_EXT="C:/Users/Secant/AppData/Local/Chromium/User Data/Default/Extensions/cjpalhdlnbpafiamejdnhcphjbkeiagm/1.70.0_0"

# Save original stdin to fd 3, then close stdin for the setup phase.
# This prevents Windows .exe (netstat, taskkill, chrome) from consuming
# the MCP initialize request that OpenCode sends on stdin.
exec 3<&0 0</dev/null

# Resolve the Windows PID listening on CHROME_PORT
get_win_pid_on_port() {
  /mnt/c/Windows/System32/netstat.exe -ano 2>/dev/null \
    | grep ":${CHROME_PORT}.*LISTENING" \
    | awk '{print $NF}' \
    | head -1 \
    | tr -d '\r'
}

# Kill a specific Windows process tree by PID
kill_win_pid() {
  local pid="$1"
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    /mnt/c/Windows/System32/taskkill.exe /F /T /PID "$pid" >/dev/null 2>&1
  fi
}

WIN_CHROME_PID=""

cleanup() {
  # Kill only OUR Chrome by its Windows PID (avoids race with new wrappers)
  if [ -n "$WIN_CHROME_PID" ]; then
    kill_win_pid "$WIN_CHROME_PID"
  fi
  # Also try WSL kill as fallback
  if [ -n "$CHROME_PID" ]; then
    kill "$CHROME_PID" 2>/dev/null
    wait "$CHROME_PID" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

# Kill any leftover Chrome from a previous crashed session on this port
stale_pid=$(get_win_pid_on_port)
if [ -n "$stale_pid" ] && [ "$stale_pid" != "0" ]; then
  kill_win_pid "$stale_pid"
  sleep 1
fi

# Launch Chrome headless with remote debugging port and uBlock Origin
"$CHROME_EXE" \
  --headless=new \
  --no-first-run \
  --no-sandbox \
  --user-data-dir="$USER_DATA_DIR" \
  --disable-extensions-except="$UBLOCK_EXT" \
  --load-extension="$UBLOCK_EXT" \
  --remote-debugging-port="$CHROME_PORT" \
  >/dev/null 2>&1 &
CHROME_PID=$!

# Wait for Chrome to be ready
for i in $(seq 1 60); do
  if curl -s "http://127.0.0.1:${CHROME_PORT}/json/version" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Capture OUR Chrome's Windows PID (for targeted cleanup)
WIN_CHROME_PID=$(get_win_pid_on_port)

# Restore original stdin from fd 3 for the MCP server (stdio transport)
exec 0<&3 3<&-

# Start MCP server, forwarding stdin/stdout (MCP uses stdio transport)
npx -y chrome-devtools-mcp@latest \
  --no-usage-statistics \
  --browserUrl "http://127.0.0.1:${CHROME_PORT}"

# cleanup runs via trap on exit
