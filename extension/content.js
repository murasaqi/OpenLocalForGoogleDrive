// Runs on drive.google.com. Answers page-context queries from the
// background service worker: currently selected item IDs and the
// breadcrumb trail (used as a fallback path resolver).
//
// May be injected twice (declared at page load + on-demand via
// chrome.scripting when the tab predates the extension), so guard
// against registering the listener twice.

if (!window.__openLocalGdriveLoaded) {
  window.__openLocalGdriveLoaded = true;

  const DRIVE_ID_PATTERN = /^[-\w]{10,120}$/;

  const collectSelectedIds = () => {
    const nodes = document.querySelectorAll('[aria-selected="true"][data-id]');
    const ids = Array.from(nodes)
      .map((node) => node.getAttribute("data-id"))
      .filter((id) => id !== null && DRIVE_ID_PATTERN.test(id));
    return Array.from(new Set(ids));
  };

  const collectBreadcrumbs = () => {
    const navs = Array.from(document.querySelectorAll('nav[role="navigation"]'));
    const breadcrumbNav = navs.find((nav) => nav.querySelector('[role="listitem"]'));
    if (!breadcrumbNav) return [];
    return Array.from(breadcrumbNav.querySelectorAll('[role="listitem"]'))
      .map((item) =>
        item
          .querySelector('[role="link"],[role="button"]')
          ?.getAttribute("aria-label")
          ?.trim()
      )
      .filter((label) => Boolean(label));
  };

  // In-page toast so errors are visible even when OS notifications are
  // suppressed (focus assist, disabled notification permission, ...).
  const TOAST_ID = "__open-local-gdrive-toast";
  const TOAST_DISMISS_MS = 8000;

  const showToast = (text) => {
    document.getElementById(TOAST_ID)?.remove();
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.setAttribute("role", "alert");
    toast.textContent = text;
    Object.assign(toast.style, {
      position: "fixed",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
      maxWidth: "480px",
      padding: "14px 20px",
      background: "#202124",
      color: "#ffffff",
      fontSize: "13px",
      lineHeight: "1.6",
      borderRadius: "8px",
      borderLeft: "4px solid #ea4335",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      zIndex: "2147483647",
      cursor: "pointer",
      fontFamily: "'Google Sans', Roboto, sans-serif",
      whiteSpace: "pre-line",
      overflowWrap: "anywhere",
      transition: "opacity 0.3s",
      opacity: "0",
    });
    toast.addEventListener("click", () => toast.remove());
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
    });
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    }, TOAST_DISMISS_MS);
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "get-page-context") {
      sendResponse({
        href: location.href,
        selectedIds: collectSelectedIds(),
        breadcrumbs: collectBreadcrumbs(),
      });
    }
    if (message?.type === "show-toast") {
      showToast(String(message.message ?? "").slice(0, 300));
      sendResponse({ ok: true });
    }
  });
}
