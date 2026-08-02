// Background-side handlers for popup runtime messages (see
// `popup-messages.ts`). `formats.list` has no protocol request id, so this
// module keeps one active wire request and queues only the latest replacement
// until the active response (or timeout) has been consumed.
import type { TrimRange } from "@limbo/shared";
import { onServerMessage, send } from "./ws-client";
import { enqueueDraft } from "./queue";
import { exportNetscapeCookies } from "./export-cookies";
import type { DownloadResult, FormatsResult } from "./popup-messages";

const FORMATS_TIMEOUT_MS = 45000;

type PendingFormatsRequest = {
  url: string;
  resolve: (result: FormatsResult) => void;
  settled: boolean;
};

let activeFormatsRequest: PendingFormatsRequest | null = null;
let queuedFormatsRequest: PendingFormatsRequest | null = null;

/**
 * Sends one `formats.list` request at a time. A newer popup request cancels
 * the old popup waiter, then waits for its stale wire response before sending.
 */
export function requestFormats(url: string): Promise<FormatsResult> {
  return new Promise((resolve) => {
    const request: PendingFormatsRequest = { url, resolve, settled: false };
    if (activeFormatsRequest) {
      settleFormatsWaiter(activeFormatsRequest, cancelledFormatsResult());
      if (queuedFormatsRequest) {
        settleFormatsWaiter(queuedFormatsRequest, cancelledFormatsResult());
      }
      queuedFormatsRequest = request;
      return;
    }

    startFormatsRequest(request);
  });
}

function startFormatsRequest(request: PendingFormatsRequest): void {
  activeFormatsRequest = request;
  const unsubscribe = onServerMessage((msg) => {
    if (msg.type === "formats.result") {
      finishFormatsRequest(request, {
        ok: true,
        title: msg.title,
        duration: msg.duration,
        thumbnail: msg.thumbnail,
        formats: msg.formats,
      });
    } else if (msg.type === "formats.error") {
      finishFormatsRequest(request, { ok: false, error: msg.error });
    }
  });
  const timeoutId = setTimeout(() => {
    finishFormatsRequest(request, {
      ok: false,
      error: "Le bureau LiMBo n'a pas répondu (délai dépassé).",
    });
  }, FORMATS_TIMEOUT_MS);

  void (async () => {
    try {
      const cookies = await exportNetscapeCookies(request.url);
      await send({
        type: "formats.list",
        url: request.url,
        cookies: cookies || undefined,
      });
    } catch (err: unknown) {
      finishFormatsRequest(request, {
        ok: false,
        error: `Bureau LiMBo injoignable : ${toMessage(err)}`,
      });
    }
  })();

  function finishFormatsRequest(requestToFinish: PendingFormatsRequest, result: FormatsResult): void {
    if (activeFormatsRequest !== requestToFinish) return;
    activeFormatsRequest = null;
    clearTimeout(timeoutId);
    unsubscribe();
    settleFormatsWaiter(requestToFinish, result);

    const nextRequest = queuedFormatsRequest;
    queuedFormatsRequest = null;
    if (nextRequest) {
      // `ws-client` dispatches by iterating a Set; deferring avoids registering
      // the next listener while that same stale message is still being iterated.
      queueMicrotask(() => startFormatsRequest(nextRequest));
    }
  }
}

function settleFormatsWaiter(request: PendingFormatsRequest, result: FormatsResult): void {
  if (request.settled) return;
  request.settled = true;
  request.resolve(result);
}

function cancelledFormatsResult(): FormatsResult {
  return { ok: false, error: "La demande de formats a été remplacée par une requête plus récente." };
}

/** Sends `download.create`, falling back to the offline draft queue if the desktop bridge is unreachable. */
export async function requestDownload(payload: {
  url: string;
  formatId: string;
  trim?: TrimRange;
  hasAudio?: boolean;
  hasVideo?: boolean;
}): Promise<DownloadResult> {
  const cookies = await exportNetscapeCookies(payload.url);
  try {
    await send({
      type: "download.create",
      ...payload,
      cookies: cookies || undefined,
    });
    return { ok: true, queued: false };
  } catch {
    await enqueueDraft({
      id: crypto.randomUUID(),
      ...payload,
      cookies: cookies || undefined,
    });
    return { ok: true, queued: true };
  }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
