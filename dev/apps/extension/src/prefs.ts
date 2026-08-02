import type { DefaultQuality } from "@limbo/shared";

const STORAGE_KEY = "limboDefaultQuality";

let cached: DefaultQuality = "best_image";

export function getDefaultQuality(): DefaultQuality {
  return cached;
}

export function setDefaultQuality(quality: DefaultQuality): void {
  cached = quality;
  void chrome.storage.local.set({ [STORAGE_KEY]: quality });
}

export async function loadDefaultQualityFromStorage(): Promise<DefaultQuality> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const value = result[STORAGE_KEY];
    if (value === "best_sound" || value === "best_image") {
      cached = value;
    }
  } catch {
    // ignore
  }
  return cached;
}
