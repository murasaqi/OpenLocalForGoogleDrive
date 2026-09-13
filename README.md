# Open Local for Google Drive

Google DriveのWebページ(drive.google.com)で表示中のフォルダを、ワンクリックで
ローカルのGoogle Drive for Desktopフォルダ(例: Windowsなら`G:\My Drive\...`、
macOSなら`~/Library/CloudStorage/GoogleDrive-<アカウント>/マイドライブ/...`)として
OSのファイルマネージャー(エクスプローラー/Finder)で開くChrome拡張機能です。
ファイルを選択した状態なら、そのファイルを選択状態でハイライト表示します。
Windows / macOS 両対応です。

## 仕組み

```
[drive.google.com] ──クリック──▶ 拡張機能 (MV3)
        │  URLのフォルダID / 選択アイテムID / パンくず
        ▼
Native Messaging Host (Node.js)
        │  DriveFSのメタデータDB (SQLite) でID→ローカルパスを解決
        ▼
explorer.exe (Windows) / open -R (macOS)   (ファイル時はハイライト表示)
```

- パス解決はGoogle Drive for DesktopのメタデータDBを読み取り専用で参照します。
  - Windows: `%LOCALAPPDATA%\Google\DriveFS\<アカウント>\metadata_sqlite_db`
  - macOS: `~/Library/Application Support/Google/DriveFS/<アカウント>/metadata_sqlite_db`
  DriveのUI変更や表示言語の影響を受けません。
- DBで解決できない場合は、ページのパンくずリストからのフォールバック解決を試みます。
- マイドライブ / 共有ドライブ / 複数アカウントに対応。npm依存ゼロ(Node組み込みの`node:sqlite`使用)。
- マウント直下のフォルダ名(マイドライブ/共有ドライブ相当)はWindowsでは常に英語固定ですが、
  macOSはOSのロケールに応じてローカライズされます(例: `ja_JP`なら`マイドライブ`/`共有ドライブ`)。
  本拡張機能はどちらにも対応しています。

## 必要環境

### Windows
- Windows + Google Drive for Desktop(ストリーミングでドライブレターにマウントされていること)
- Node.js 24以降(`node:sqlite`を使用。無い場合は`install.ps1`がwingetで自動インストールを試みます)
- Google Chrome

### macOS
- macOS + Google Drive for Desktop(`~/Library/CloudStorage/GoogleDrive-<アカウント>`にマウントされていること)
- Node.js 24以降(`node:sqlite`を使用。無い場合は`install.sh`がHomebrewで自動インストールを試みます)
- Google Chrome
- Homebrew(Node.jsの自動インストールを使う場合のみ必要。https://brew.sh )

## セットアップ

1. **拡張機能を読み込む**
   1. Chromeで `chrome://extensions` を開く
   2. 「デベロッパーモード」をON
   3. 「パッケージ化されていない拡張機能を読み込む」で本リポジトリの `extension/` フォルダを選択
   4. 拡張IDが `akmpfhnifeafnahlnfkhacjgcbeekgpo` であることを確認
      (manifest.jsonの`key`で固定しているため、通常はこのIDになります)

2. **ネイティブホストを登録**

   **Windows:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
   ```
   - ホストの登録自体は管理者権限不要です(現在のユーザーのみに登録)
   - Node.js 24以降が見つからない場合はwingetで自動インストールを試みます
     (このステップのみUACの承認が必要。自動インストールを避ける場合は `-SkipNodeInstall` を指定)
   - 拡張IDが異なる場合は `-ExtensionId <実際のID>` を付けて実行してください。

   **macOS:**
   ```bash
   bash scripts/install.sh
   ```
   - ホストの登録自体は管理者権限不要です(現在のユーザーのみに登録、レジストリに相当する手順はありません)
   - Node.js 24以降が見つからない場合はHomebrewで自動インストールを試みます
     (自動インストールを避ける場合は `--skip-node-install` を指定)
   - 拡張IDが異なる場合は `--extension-id <実際のID>` を付けて実行してください。
   - ホスト本体は `~/Library/Application Support/OpenLocalForGoogleDrive/` にコピーして登録されます
     (`~/Documents` 等に置いたリポジトリからはChromeがホストを起動できないため)。
     リポジトリを更新したら `install.sh` を再実行してください。

3. Chromeを再起動(または拡張機能をリロード)

## 使い方

- Driveでフォルダを開いた状態でツールバーの拡張アイコンをクリック
  → そのフォルダがファイルマネージャー(エクスプローラー/Finder)で開きます
  (ショートカット: Windows `Ctrl+Shift+9` / macOS `Command+Shift+9`)
- ファイル/フォルダを選択した状態(プレビュー表示中も可)でクリック
  → 選択アイテムをファイルマネージャーでハイライト表示します
- ファイルのURL (`/file/d/…`) を直接開いている場合も、そのファイルをハイライト表示します
- マイドライブ直下 (`/drive/my-drive`) → マウント直下の「マイドライブ」相当フォルダを開きます
- 共有ドライブ一覧 (`/drive/shared-drives`) → マウント直下の「共有ドライブ」相当フォルダを開きます
  (フォルダ名はWindowsでは常に英語`My Drive`/`Shared drives`、macOSではOSのロケールに従います)

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| 「ネイティブホストに接続できません」 | Windows: `scripts\install.ps1`、macOS: `scripts/install.sh` を実行したか、実行後にChromeを再起動したか確認 |
| 「ローカルのGoogle Driveに見つかりません」 | 対象がまだ同期されていないか、「共有アイテム」等ローカルにマウントされないアイテムです |
| 「マウントが見つかりません」 | Google Drive for Desktopが起動しているか確認(Windows: ドライブレター、macOS: `~/Library/CloudStorage/GoogleDrive-*`) |
| ミラーリング(ローカルコピー)モード | 現状はストリーミング(仮想マウント)のみ対応です |

ホスト単体の動作確認:

```bash
npm test
```

## アンインストール

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
```

**macOS:**
```bash
bash scripts/uninstall.sh
```

その後、`chrome://extensions` から拡張機能を削除してください。

## 開発

```
extension/          Chrome拡張 (MV3)
  background.js     クリック→ID解決→ネイティブメッセージ送信→エラー通知
  content.js        選択アイテムID・パンくず取得
  lib/drive-url.js  URL分類(純関数)
host/
  open-local-host.mjs   ネイティブホスト エントリポイント(OS別のファイルマネージャー起動を含む)
  open-local-host.bat   Windows用起動ラッパー
  lib/framing.mjs        native messagingフレーミング(4byte LE長+JSON)
  lib/resolver.mjs       メタデータDB検索・パス解決(OS非依存部分)
  lib/special-folders.mjs  マイドライブ/共有ドライブ相当フォルダの解決(OSごとの命名規則を吸収)
  lib/mount.mjs          マウント検出ディスパッチャ(process.platformで振り分け)
  lib/mount.win.mjs      Windows: レジストリ+ドライブレター検出
  lib/mount.mac.mjs      macOS: ~/Library/CloudStorage 列挙
scripts/
  install.ps1 / uninstall.ps1   Windows: ホスト登録・解除
  install.sh / uninstall.sh     macOS: ホスト登録・解除
  generate-icons.mjs            アイコンPNG生成
tests/              node:test によるユニット/統合テスト
```

- ホスト⇔拡張のプロトコル:
  - 要求: `{action:'open', itemId?, special?:'myDrive'|'sharedDrives', breadcrumbs?, dryRun?}`
  - 応答: `{ok:true, path, selected}` | `{ok:false, error}`
- `dryRun:true` でファイルマネージャーを起動せずパス解決のみ行えます(テストで使用)。
- macOSでは `install.sh` が `host/` を `~/Library/Application Support/OpenLocalForGoogleDrive/` にコピーし、
  起動ラッパー `open-local-host.sh` をそこに生成します。`host/` を変更したら `install.sh` を再実行してください。

## License

MIT
