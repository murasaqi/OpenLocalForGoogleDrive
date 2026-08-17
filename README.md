# Open Local for Google Drive

Google DriveのWebページ(drive.google.com)で表示中のフォルダを、ワンクリックで
ローカルのGoogle Drive for Desktopフォルダ(例: `G:\My Drive\...`)としてエクスプローラーで開く
Chrome拡張機能です。ファイルを選択した状態なら、そのファイルを選択状態でハイライト表示します。

## 仕組み

```
[drive.google.com] ──クリック──▶ 拡張機能 (MV3)
        │  URLのフォルダID / 選択アイテムID / パンくず
        ▼
Native Messaging Host (Node.js)
        │  DriveFSのメタデータDB (SQLite) でID→ローカルパスを解決
        ▼
explorer.exe "G:\My Drive\..."   (ファイル時は /select, でハイライト)
```

- パス解決はGoogle Drive for DesktopのメタデータDB
  (`%LOCALAPPDATA%\Google\DriveFS\<アカウント>\metadata_sqlite_db`)を読み取り専用で参照します。
  DriveのUI変更や表示言語の影響を受けません。
- DBで解決できない場合は、ページのパンくずリストからのフォールバック解決を試みます。
- マイドライブ / 共有ドライブ / 複数アカウントに対応。npm依存ゼロ(Node組み込みの`node:sqlite`使用)。

## 必要環境

- Windows + Google Drive for Desktop(ストリーミングでドライブレターにマウントされていること)
- Node.js 22.5以降(`node:sqlite`を使用。動作確認はNode 24)
- Google Chrome

## セットアップ

1. **拡張機能を読み込む**
   1. Chromeで `chrome://extensions` を開く
   2. 「デベロッパーモード」をON
   3. 「パッケージ化されていない拡張機能を読み込む」で本リポジトリの `extension/` フォルダを選択
   4. 拡張IDが `akmpfhnifeafnahlnfkhacjgcbeekgpo` であることを確認
      (manifest.jsonの`key`で固定しているため、通常はこのIDになります)

2. **ネイティブホストを登録**(管理者権限不要)

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
   ```

   拡張IDが異なる場合は `-ExtensionId <実際のID>` を付けて実行してください。

3. Chromeを再起動(または拡張機能をリロード)

## 使い方

- Driveでフォルダを開いた状態でツールバーの拡張アイコンをクリック
  → そのフォルダがエクスプローラーで開きます(ショートカット: `Ctrl+Shift+9`)
- ファイル/フォルダを選択した状態(プレビュー表示中も可)でクリック
  → 選択アイテムをエクスプローラーでハイライト表示します
- ファイルのURL (`/file/d/…`) を直接開いている場合も、そのファイルをハイライト表示します
- マイドライブ直下 (`/drive/my-drive`) → `<マウント>\My Drive` を開きます
- 共有ドライブ一覧 (`/drive/shared-drives`) → `<マウント>\Shared drives` を開きます

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| 「ネイティブホストに接続できません」 | `scripts\install.ps1` を実行したか、実行後にChromeを再起動したか確認 |
| 「ローカルのGoogle Driveに見つかりません」 | 対象がまだ同期されていないか、「共有アイテム」等ローカルにマウントされないアイテムです |
| 「マウントドライブが見つかりません」 | Google Drive for Desktopが起動しているか確認 |
| ミラーリング(ローカルコピー)モード | 現状はストリーミング(ドライブレターマウント)のみ対応です |

ホスト単体の動作確認:

```powershell
npm test
```

## アンインストール

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
```

その後、`chrome://extensions` から拡張機能を削除してください。

## 開発

```
extension/          Chrome拡張 (MV3)
  background.js     クリック→ID解決→ネイティブメッセージ送信→エラー通知
  content.js        選択アイテムID・パンくず取得
  lib/drive-url.js  URL分類(純関数)
host/
  open-local-host.mjs   ネイティブホスト エントリポイント
  lib/framing.mjs       native messagingフレーミング(4byte LE長+JSON)
  lib/resolver.mjs      メタデータDB検索・パス解決
  lib/mount.mjs         マウントドライブ検出
scripts/
  install.ps1 / uninstall.ps1   ホスト登録・解除
  generate-icons.mjs            アイコンPNG生成
tests/              node:test によるユニット/統合テスト
```

- ホスト⇔拡張のプロトコル:
  - 要求: `{action:'open', itemId?, special?:'myDrive'|'sharedDrives', breadcrumbs?, dryRun?}`
  - 応答: `{ok:true, path, selected}` | `{ok:false, error}`
- `dryRun:true` でエクスプローラーを起動せずパス解決のみ行えます(テストで使用)。

## License

MIT
