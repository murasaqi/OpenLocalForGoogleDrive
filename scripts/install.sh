#!/usr/bin/env bash
# Registers the native messaging host for the "Open Local for Google Drive"
# Chrome extension on macOS (registration itself is current user only; no
# admin rights required). If Node.js 24+ is missing, attempts to install it
# via Homebrew.
#
# Usage:
#   bash scripts/install.sh
#   bash scripts/install.sh --extension-id <id>
#   bash scripts/install.sh --skip-node-install
set -euo pipefail

EXTENSION_ID="akmpfhnifeafnahlnfkhacjgcbeekgpo"
SKIP_NODE_INSTALL=0
REQUIRED_NODE_MAJOR=24

while [[ $# -gt 0 ]]; do
  case "$1" in
    --extension-id)
      if [[ $# -lt 2 ]]; then
        echo "--extension-id には拡張IDを指定してください" >&2
        exit 1
      fi
      EXTENSION_ID="$2"
      shift 2
      ;;
    --skip-node-install)
      SKIP_NODE_INSTALL=1
      shift
      ;;
    *)
      echo "不明な引数: $1" >&2
      exit 1
      ;;
  esac
done

if ! [[ "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo "拡張IDが不正です: $EXTENSION_ID (a-pの32文字が必要です)" >&2
  exit 1
fi

node_major_version() {
  command -v node >/dev/null 2>&1 || return 1
  node -v | sed 's/^v//' | cut -d. -f1
}

install_node_via_brew() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrewが見つからないためNode.jsを自動インストールできません。https://brew.sh からHomebrewをインストールするか、https://nodejs.org からNode.js ${REQUIRED_NODE_MAJOR}以降を手動でインストールして再実行してください。" >&2
    exit 1
  fi
  echo "Node.js ${REQUIRED_NODE_MAJOR}以降が見つかりません。Homebrewでインストールします..."
  brew install node
}

CURRENT_MAJOR="$(node_major_version || true)"
if [[ -z "$CURRENT_MAJOR" || "$CURRENT_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]]; then
  if [[ "$SKIP_NODE_INSTALL" -eq 1 ]]; then
    echo "Node.js ${REQUIRED_NODE_MAJOR}以降が必要です(現在: ${CURRENT_MAJOR:-未インストール})。node:sqliteを使用するためです。'brew install node' または https://nodejs.org からインストールしてください。" >&2
    exit 1
  fi
  install_node_via_brew
  CURRENT_MAJOR="$(node_major_version || true)"
  if [[ -z "$CURRENT_MAJOR" || "$CURRENT_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]]; then
    echo "Node.jsをインストールしましたが、Node.js ${REQUIRED_NODE_MAJOR}以降を検出できません。新しいターミナルを開いて install.sh を再実行してください。" >&2
    exit 1
  fi
  echo "Node.js $(node -v) をインストールしました。"
fi

if ! node --no-warnings -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "この Node.js ($(node -v)) では node:sqlite を利用できません。'brew install node' で Node.js ${REQUIRED_NODE_MAJOR}以降に更新してください。" >&2
  exit 1
fi

NODE_BIN="$(command -v node)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST_DIR="$REPO_ROOT/host"
HOST_NAME="jp.andent.open_local_gdrive"
# macOS protects ~/Documents, ~/Desktop and ~/Downloads (TCC "Files and
# Folders"): a repo cloned into one of those (a very common location) leaves
# Chrome unable to read/execute a native messaging host that lives inside
# it, even though the manifest registration itself succeeds silently and
# the script works fine when run directly from a terminal. Copying the
# runtime files into ~/Library/Application Support (not TCC-protected)
# avoids that regardless of where this repo happens to be checked out.
INSTALL_DIR="$HOME/Library/Application Support/OpenLocalForGoogleDrive"
WRAPPER_PATH="$INSTALL_DIR/host/open-local-host.sh"
MANIFEST_PATH="$INSTALL_DIR/$HOST_NAME.json"
NMH_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

if [[ ! -f "$HOST_DIR/open-local-host.mjs" ]]; then
  echo "ホストのエントリポイントが見つかりません: $HOST_DIR/open-local-host.mjs" >&2
  exit 1
fi

# Start from a clean copy so modules removed from the repo don't linger.
rm -rf "$INSTALL_DIR/host"
mkdir -p "$INSTALL_DIR/host/lib"
cp "$HOST_DIR/open-local-host.mjs" "$INSTALL_DIR/host/open-local-host.mjs"
cp "$HOST_DIR"/lib/*.mjs "$INSTALL_DIR/host/lib/"

# GUI-launched Chrome does not reliably inherit a Homebrew/nvm-augmented
# shell PATH, so the wrapper hardcodes the node path resolved just above
# rather than relying on a bare `node` lookup at runtime.
cat > "$WRAPPER_PATH" <<EOF
#!/bin/sh
exec "$NODE_BIN" --no-warnings "$INSTALL_DIR/host/open-local-host.mjs" "\$@"
EOF
chmod +x "$WRAPPER_PATH"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Open Local for Google Drive native messaging host",
  "path": "$WRAPPER_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

# Unlike Windows, macOS Chrome has no registry-equivalent lookup: it scans
# this fixed directory for a manifest file named after the host.
mkdir -p "$NMH_DIR"
cp "$MANIFEST_PATH" "$NMH_DIR/$HOST_NAME.json"

echo "登録が完了しました:"
echo "  Node.js       : $(node -v)"
echo "  host runtime  : $INSTALL_DIR/host/ (リポジトリからコピー)"
echo "  host manifest : $NMH_DIR/$HOST_NAME.json"
echo "  extension ID  : $EXTENSION_ID"
echo ""
echo "Chromeを再起動(または拡張機能をリロード)してからお使いください。"
echo "(リポジトリのファイルを更新した場合は install.sh を再実行してコピーを更新してください)"
