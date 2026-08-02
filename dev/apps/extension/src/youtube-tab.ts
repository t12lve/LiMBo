// Reads the active tab's URL and normalizes it to a canonical YouTube watch
// URL via `extractYoutubeVideoUrl`, so the popup can decide up front whether
// it is looking at a YouTube video (and which one) before asking the SW for
// formats.
import { extractYoutubeVideoUrl } from "@limbo/shared";

export type ActiveYoutubeTab =
  | { isYoutube: true; url: string }
  | { isYoutube: false; url: string | null };

/** Resolves the active tab in the current window and normalizes its URL, if any. */
export async function getActiveYoutubeTab(): Promise<ActiveYoutubeTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url ?? null;

  if (!tabUrl) {
    return { isYoutube: false, url: null };
  }

  const normalized = extractYoutubeVideoUrl(tabUrl);
  return normalized
    ? { isYoutube: true, url: normalized }
    : { isYoutube: false, url: tabUrl };
}
