import { parseDriveUrl } from "./lib/drive-url.js";
import { buildRequest } from "./lib/build-request.js";

const HOST_NAME = "jp.andent.open_local_gdrive";
const BADGE_CLEAR_DELAY_MS = 4000;

const ERROR_MESSAGES = {
  not_synced:
    "このアイテムはパソコンのGoogle Driveフォルダに存在しないため開けません。他のユーザーから共有されたアイテムはパソコンに同期されません。開きたい場合は、Driveで対象を右クリック →「整理」→「ショートカットを追加」でマイドライブに追加してください。",
  db_not_found:
    "Google Drive for Desktopのデータが見つかりません。インストール・起動されているか確認してください",
  mount_not_found:
    "Google Driveのマウントドライブ(例: G:)が見つかりません。Google Drive for Desktopが起動しているか確認してください",
  path_missing:
    "このアイテムはパソコンのGoogle Driveフォルダにまだ存在しないため開けません。作成・同期の直後なら、少し待ってからもう一度お試しください。他のユーザーから共有されたアイテムの場合は、右クリック →「整理」→「ショートカットを追加」でマイドライブに追加すると開けるようになります。",
  invalid_path: "安全のため、このアイテムのパスは開きませんでした(拡張機能の内部エラー)",
  explorer_failed: "エクスプローラーを起動できませんでした",
  bad_request: "拡張機能の内部エラーが発生しました",
  internal: "拡張機能の内部エラーが発生しました",
  host_unreachable:
    "ローカル連携プログラムに接続できません。リポジトリの scripts\\install.ps1 を実行し、Chromeを再起動してください",
};

// Short badge codes so failures are identifiable even when OS
// notifications are suppressed (focus assist, disabled permission, ...).
const BADGE_CODES = {
  not_synced: "SYNC",
  db_not_found: "DB",
  mount_not_found: "MNT",
  path_missing: "PATH",
  invalid_path: "INV",
  explorer_failed: "EXPL",
  bad_request: "REQ",
  internal: "INT",
  host_unreachable: "HOST",
  not_drive: "URL",
  no_target: "SEL",
};

// Badge fallback keeps failures visible even when OS notifications are
// suppressed (focus assist, disabled notification permission, ...).
const showErrorBadge = (code) => {
  chrome.action.setBadgeBackgroundColor({ color: "#D93025" });
  chrome.action.setBadgeText({ text: code });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), BADGE_CLEAR_DELAY_MS);
};

// Declared content scripts are only injected at page load, so a tab that was
// already open when the extension was installed/reloaded has no listener yet.
// activeTab + scripting lets us inject it on demand at click time.
const sendTabMessage = async (tabId, payload) => {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, payload);
  }
};

const getPageContext = async (tabId) => {
  try {
    return await sendTabMessage(tabId, { type: "get-page-context" });
  } catch {
    return null;
  }
};

// Errors are shown as an in-page toast (always visible). The OS notification
// is a fallback for when the tab cannot run our content script.
const notify = async (tabId, message, code = "!") => {
  showErrorBadge(code);
  try {
    await sendTabMessage(tabId, { type: "show-toast", message });
    return;
  } catch {
    // fall through to OS notification
  }
  chrome.notifications.create(
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "Open Local for Google Drive",
      message,
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
};

const sendToHost = (payload) =>
  new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: "host_unreachable" });
        return;
      }
      resolve(response ?? { ok: false, error: "internal" });
    });
  });

// tab.url can be empty when the activeTab grant races the click event;
// the content script's location.href covers that case.
const parseEffectiveUrl = (tabUrl, context) => {
  const fromTab = parseDriveUrl(tabUrl ?? "");
  if (fromTab.kind !== "notDrive") return fromTab;
  return parseDriveUrl(context?.href ?? "");
};

// Fire-and-forget diagnostics into the host's %TEMP% log file.
const logToHost = (data) => {
  try {
    chrome.runtime.sendNativeMessage(HOST_NAME, { action: "log", data }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // diagnostics only
  }
};

chrome.action.onClicked.addListener(async (tab) => {
  const debug = { step: "start", tabUrl: tab?.url ?? null };
  try {
    if (typeof tab?.id !== "number") {
      logToHost({ ...debug, step: "no-tab-id" });
      return;
    }

    const context = await getPageContext(tab.id);
    const parsed = parseEffectiveUrl(tab.url, context);
    debug.parsedKind = parsed.kind;
    debug.contextReceived = Boolean(context);
    debug.selectedCount = context?.selectedIds?.length ?? -1;
    debug.breadcrumbCount = context?.breadcrumbs?.length ?? -1;

    if (parsed.kind === "notDrive") {
      logToHost({ ...debug, step: "not-drive" });
      await notify(
        tab.id,
        "Google Drive (drive.google.com) のページで使用してください",
        BADGE_CODES.not_drive
      );
      return;
    }

    const request = buildRequest(parsed, context);
    if (!request) {
      logToHost({ ...debug, step: "no-request" });
      await notify(
        tab.id,
        "このページからは開けません。フォルダを開くか、アイテムを1つ選択してください",
        BADGE_CODES.no_target
      );
      return;
    }

    const response = await sendToHost(request);
    logToHost({ ...debug, step: "done", request, response });
    if (!response.ok) {
      const baseMessage = ERROR_MESSAGES[response.error] ?? `エラー: ${response.error}`;
      const message = response.path
        ? `${baseMessage}\n(探した場所: ${response.path})`
        : baseMessage;
      await notify(tab.id, message, BADGE_CODES[response.error] ?? "ERR");
    }
  } catch (error) {
    logToHost({ ...debug, step: "sw-exception", error: String(error?.message ?? error) });
    await notify(tab?.id, "内部エラーが発生しました", BADGE_CODES.internal);
  }
});
