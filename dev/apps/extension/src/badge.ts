// Renders extension action badge state. Callers decide the *meaning* of the
// value: a `number` is treated as a download progress percent ("NN%", cleared
// at 100), while a `string` is shown verbatim (e.g. an offline-queue count) or
// clears the badge when empty.

const BADGE_BACKGROUND_COLOR = "#2563eb";

export function updateBadge(value: number | string): void {
  const text = toBadgeText(value);
  void chrome.action.setBadgeText({ text });
  if (text) {
    void chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND_COLOR });
  }
}

export function clearBadge(): void {
  updateBadge("");
}

function toBadgeText(value: number | string): string {
  if (value === "") {
    return "";
  }
  if (typeof value === "string") {
    return value.length > 4 ? value.slice(0, 4) : value;
  }
  if (!Number.isFinite(value)) {
    return "";
  }
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return percent >= 100 ? "" : `${percent}%`;
}
