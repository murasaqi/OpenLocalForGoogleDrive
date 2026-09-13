#!/usr/bin/env bash
# Removes the native messaging host registration created by install.sh.
set -euo pipefail

HOST_NAME="jp.andent.open_local_gdrive"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST_DIR="$REPO_ROOT/host"
INSTALL_DIR="$HOME/Library/Application Support/OpenLocalForGoogleDrive"
NMH_MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"

if [[ -f "$NMH_MANIFEST" ]]; then
  rm -f "$NMH_MANIFEST"
  echo "host manifestを削除しました: $NMH_MANIFEST"
else
  echo "host manifestは登録されていません: $NMH_MANIFEST"
fi

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  echo "コピーされたホストランタイムを削除しました: $INSTALL_DIR"
fi

# Older installs wrote generated files directly under host/; clean those up too.
for generated in "$HOST_DIR/$HOST_NAME.json" "$HOST_DIR/open-local-host.sh"; do
  if [[ -f "$generated" ]]; then
    rm -f "$generated"
    echo "生成ファイルを削除しました: $generated"
  fi
done

echo "アンインストールが完了しました。"
