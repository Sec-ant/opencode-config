#!/bin/bash
# Unified chrome-devtools-mcp wrapper for macOS and WSL.
# Detects platform via uname and launches Chromium accordingly.

set -euo pipefail

OS="$(uname -s)"

if [[ "$OS" == "Darwin" ]]; then
  # ── macOS: direct launch via --executablePath ──
  exec npx -y chrome-devtools-mcp@latest \
    --no-usage-statistics \
    --executablePath /Applications/Chromium.app/Contents/MacOS/Chromium \
    --ignoreDefaultChromeArg=--disable-extensions \
    "--chromeArg=--disable-extensions-except=$HOME/.config/opencode/ublock-origin/uBlock0.chromium,$HOME/.config/opencode/meow-header" \
    "--chromeArg=--load-extension=$HOME/.config/opencode/ublock-origin/uBlock0.chromium,$HOME/.config/opencode/meow-header" \
    --chromeArg=--headless=new \
    --chromeArg=--no-sandbox \
    "--chromeArg=--user-data-dir=$HOME/.config/opencode/chromium-mcp"

elif [[ "$OS" == "Linux" ]]; then
  # ── WSL: launch Windows Chrome, then connect via --browserUrl ──
  #
  # Windows .exe called via WSL interop consume stdin.
  # Save stdin (fd 3) before any .exe calls, then restore it for npx.

  CHROME_PORT=9222
  USER_DATA_DIR="C:/Temp/chromium-mcp"

  # Save stdin before calling any Windows .exe (they consume stdin via WSL interop)
  exec 3<&0 0</dev/null

  # Detect Windows paths dynamically
  WIN_LOCALAPPDATA=$(/mnt/c/Windows/System32/cmd.exe /c "echo %LOCALAPPDATA%" 2>/dev/null | tr -d '\r\n')
  WSL_LOCALAPPDATA=$(wslpath "$WIN_LOCALAPPDATA")

  CHROME_EXE="${WSL_LOCALAPPDATA}/Chromium/Application/chrome.exe"

  # Auto-detect uBlock Origin extension version (Windows path for chrome.exe)
  UBLOCK_ID="cjpalhdlnbpafiamejdnhcphjbkeiagm"
  UBLOCK_WSL_BASE="${WSL_LOCALAPPDATA}/Chromium/User Data/Default/Extensions/${UBLOCK_ID}"
  # Resolve to a clean path and find the latest version directory
  UBLOCK_WSL_BASE=$(realpath "$UBLOCK_WSL_BASE" 2>/dev/null || echo "$UBLOCK_WSL_BASE")
  UBLOCK_WSL_DIR=$(ls -1d "${UBLOCK_WSL_BASE}/"*/ 2>/dev/null | head -1 | sed 's:/$::')
  if [[ -z "$UBLOCK_WSL_DIR" ]]; then
    echo "Warning: uBlock Origin extension not found, launching without it" >&2
    UBLOCK_EXT=""
  else
    UBLOCK_EXT=$(wslpath -w "$UBLOCK_WSL_DIR")
  fi

  get_win_pid_on_port() {
    /mnt/c/Windows/System32/netstat.exe -ano 2>/dev/null \
      | grep ":${CHROME_PORT}.*LISTENING" \
      | awk '{print $NF}' \
      | head -1 \
      | tr -d '\r' \
      || true
  }

  kill_win_pid() {
    local pid="$1"
    if [[ -n "$pid" && "$pid" != "0" ]]; then
      /mnt/c/Windows/System32/taskkill.exe /F /T /PID "$pid" >/dev/null 2>&1 || true
    fi
  }

  WIN_CHROME_PID=""
  CHROME_PID=""

  cleanup() {
    if [[ -n "$WIN_CHROME_PID" ]]; then
      kill_win_pid "$WIN_CHROME_PID"
    fi
    if [[ -n "$CHROME_PID" ]]; then
      kill "$CHROME_PID" 2>/dev/null || true
      wait "$CHROME_PID" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT INT TERM

  # Kill leftover Chrome from a previous crashed session
  stale_pid=$(get_win_pid_on_port)
  if [[ -n "$stale_pid" && "$stale_pid" != "0" ]]; then
    kill_win_pid "$stale_pid"
    sleep 1
  fi

  "$CHROME_EXE" \
    --headless=new \
    --no-first-run \
    --no-sandbox \
    --user-data-dir="$USER_DATA_DIR" \
    ${UBLOCK_EXT:+--disable-extensions-except="$UBLOCK_EXT"} \
    ${UBLOCK_EXT:+--load-extension="$UBLOCK_EXT"} \
    --remote-debugging-port="$CHROME_PORT" \
    >/dev/null 2>&1 &
  CHROME_PID=$!

  for _ in $(seq 1 60); do
    if curl -s "http://127.0.0.1:${CHROME_PORT}/json/version" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done

  WIN_CHROME_PID=$(get_win_pid_on_port)

  # Restore stdin for MCP stdio transport
  exec 0<&3 3<&-

  npx -y chrome-devtools-mcp@latest \
    --no-usage-statistics \
    --browserUrl "http://127.0.0.1:${CHROME_PORT}"

else
  echo "Unsupported platform: $OS" >&2
  exit 1
fi
