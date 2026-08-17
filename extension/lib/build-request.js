// Builds the native messaging request from the parsed page URL and the
// page context reported by the content script. Pure function (unit tested).
//
// A selected item wins over the URL only when the selection is unambiguous
// (exactly one item): Drive can keep a stale aria-selected row across
// navigations, and multiple selections have no single meaningful target.

export const buildRequest = (parsed, context) => {
  const breadcrumbs = Array.isArray(context?.breadcrumbs) ? context.breadcrumbs : [];
  const selectedIds = Array.isArray(context?.selectedIds) ? context.selectedIds : [];

  if (selectedIds.length === 1) {
    return { action: "open", itemId: selectedIds[0], breadcrumbs };
  }
  if (parsed.kind === "folder" || parsed.kind === "item") {
    return { action: "open", itemId: parsed.id, breadcrumbs };
  }
  if (parsed.kind === "myDrive") return { action: "open", special: "myDrive" };
  if (parsed.kind === "sharedDrives") return { action: "open", special: "sharedDrives" };
  return null;
};
