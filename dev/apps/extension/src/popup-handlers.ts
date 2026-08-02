// Background-side handlers for popup runtime messages (see
// `popup-messages.ts`). `formats.list`/`download.create` are WS "fire and
// forget" sends — the WS protocol has no request id to correlate a reply —
// so `requestFormats` simply waits for the next `formats.result` /
// `formats.error` the desktop bridge pushes back (only one popup talks to
// the SW at a time) with a timeout as a safety net.
import type { TrimRange } from "@limbo/shared";
import { onServerMessage, send } from "./ws-client";
import { enqueueDraft } from "./queue";
import type { DownloadResult, FormatsResult } from "./popup-messages";

const FORMATS_TIMEOUT_MS = 15000;

/** Sends `formats.list` and resolves with the matching `formats.result`/`formats.error`. */
export function requestFormats(url: string): Promise<FormatsResult> {
  return new Promise((resolve) => {
    let settled = false;

    const unsubscribe = onServerMessage((msg) => {
      if (msg.type === "formats.result") {
        finish({
          ok: true,
          title: msg.title,
          duration: msg.duration,
          thumbnail: msg.thumbnail,
          formats: msg.formats,
        });
      } else if (msg.type === "formats.error") {
        finish({ ok: false, error: msg.error });
      }
    });

    const timeoutId = setTimeout(() => {
      finish({
        ok: false,
        error: "Le bureau LiMBo n'a pas répondu (délai dépassé).",
      });
    }, FORMATS_TIMEOUT_MS);

    function finish(result: FormatsResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(result);
    }

    send({ type: "formats.list", url }).catch((err: unknown) => {
      finish({
        ok: false,
        error: `Bureau LiMBo injoignable : ${toMessage(err)}`,
      });
    });
  });
}

/** Sends `download.create`, falling back to the offline draft queue if the desktop bridge is unreachable. */
export async function requestDownload(payload: {
  url: string;
  formatId: string;
  trim?: TrimRange;
}): Promise<DownloadResult> {
  try {
    await send({ type: "download.create", ...payload });
    return { ok: true, queued: false };
  } catch {
    await enqueueDraft({ id: crypto.randomUUID(), ...payload });
    return { ok: true, queued: true };
  }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
