// Offline draft queue: when the desktop bridge is unreachable, downloads are
// captured as `DraftJob`s in `chrome.storage.session` (cleared when the
// browser fully exits, unlike `storage.local`) instead of being dropped. The
// queue is flushed as `download.create` requests once `ws-client` reports
// `auth.ok`.
import type { TrimRange } from "@limbo/shared";
import { connectAndAuth, send } from "./ws-client";
import { updateBadge } from "./badge";

export type DraftJob = {
  id: string;
  url: string;
  formatId: string;
  trim?: TrimRange;
  cookies?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
};

const QUEUE_STORAGE_KEY = "limboDraftQueue";

let flushing = false;

async function readQueue(): Promise<DraftJob[]> {
  const result = await chrome.storage.session.get(QUEUE_STORAGE_KEY);
  const queue = result[QUEUE_STORAGE_KEY];
  return Array.isArray(queue) ? (queue as DraftJob[]) : [];
}

async function writeQueue(queue: DraftJob[]): Promise<void> {
  await chrome.storage.session.set({ [QUEUE_STORAGE_KEY]: queue });
  updateBadge(queue.length > 0 ? String(queue.length) : "");
}

/** Persists a draft job for later delivery and opportunistically tries to connect/flush now. */
export async function enqueueDraft(draft: DraftJob): Promise<void> {
  const queue = await readQueue();
  queue.push(draft);
  await writeQueue(queue);

  connectAndAuth()
    .then(() => flushQueue())
    .catch(() => {
  // Stays queued in storage.session; will be retried on the next reconnect
  // once LiMBo Desktop is running (no limbo:// cold-start from the extension).
    });
}

/** Sends every queued draft as `download.create`. Re-queues any that fail to send. */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const queue = await readQueue();
    if (queue.length === 0) return;

    const remaining: DraftJob[] = [];
    for (const draft of queue) {
      try {
        await send({
          type: "download.create",
          url: draft.url,
          formatId: draft.formatId,
          trim: draft.trim,
          cookies: draft.cookies,
          hasAudio: draft.hasAudio,
          hasVideo: draft.hasVideo,
        });
      } catch (err) {
        console.warn("[LiMBo] queue: failed to flush draft", draft.id, err);
        remaining.push(draft);
      }
    }
    await writeQueue(remaining);
  } finally {
    flushing = false;
  }
}
