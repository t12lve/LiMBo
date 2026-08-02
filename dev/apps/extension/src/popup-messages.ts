// Runtime message contract between the popup UI and the background service
// worker (`chrome.runtime.sendMessage`/`onMessage`). Kept local to the
// extension — unlike `@limbo/shared`'s WS messages — since these never leave
// the browser process.
import type { TrimRange, VideoFormat } from "@limbo/shared";

export type PopupRequest =
  | { type: "popup.formats"; url: string }
  | {
      type: "popup.download";
      payload: { url: string; formatId: string; trim?: TrimRange };
    };

export type FormatsResult =
  | {
      ok: true;
      title: string;
      duration: number;
      thumbnail: string;
      formats: VideoFormat[];
    }
  | { ok: false; error: string };

export type DownloadResult =
  | { ok: true; queued: boolean }
  | { ok: false; error: string };

export function isPopupRequest(value: unknown): value is PopupRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const { type } = value as { type: unknown };
  return type === "popup.formats" || type === "popup.download";
}
