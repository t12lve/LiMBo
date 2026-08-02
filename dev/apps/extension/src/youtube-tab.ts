// Reads the active tab URL so the popup can ask Desktop/yt-dlp for formats on any site.
import { extractPageVideoUrl } from "@limbo/shared";

export type ActiveVideoTab =
  | { ok: true; url: string }
  | { ok: false; url: string | null };

/** Resolves the active tab in the current window to an http(s) URL, if any. */
export async function getActiveVideoTab(): Promise<ActiveVideoTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url ?? null;

  if (!tabUrl) {
    return { ok: false, url: null };
  }

  const normalized = extractPageVideoUrl(tabUrl);
  return normalized ? { ok: true, url: normalized } : { ok: false, url: tabUrl };
}
