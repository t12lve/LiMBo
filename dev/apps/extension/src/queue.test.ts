import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetChromeStores } from "./test/chrome-mock";
import type { DraftJob } from "./queue";

const mocks = vi.hoisted(() => ({
  connectAndAuth: vi.fn(async () => {}),
  send: vi.fn(async () => {}),
  updateBadge: vi.fn(),
}));

vi.mock("./ws-client", () => ({
  connectAndAuth: mocks.connectAndAuth,
  send: mocks.send,
}));
vi.mock("./badge", () => ({ updateBadge: mocks.updateBadge }));

const QUEUE_STORAGE_KEY = "limboDraftQueue";

const { enqueueDraft, flushQueue } = await import("./queue");

function draft(id: string): DraftJob {
  return { id, url: `https://example.com/${id}`, formatId: "limbo:combo:bv*+ba/b" };
}

async function readQueue(): Promise<DraftJob[]> {
  const result = await chrome.storage.session.get(QUEUE_STORAGE_KEY);
  const queue = result[QUEUE_STORAGE_KEY];
  return Array.isArray(queue) ? (queue as DraftJob[]) : [];
}

async function seed(jobs: DraftJob[]): Promise<void> {
  await chrome.storage.session.set({ [QUEUE_STORAGE_KEY]: jobs });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetChromeStores();
  mocks.connectAndAuth.mockImplementation(async () => {});
  mocks.send.mockImplementation(async () => {});
});

describe("enqueueDraft", () => {
  it("persists the draft and updates the badge when the bridge is unreachable", async () => {
    mocks.connectAndAuth.mockRejectedValueOnce(new Error("desktop offline"));

    await enqueueDraft(draft("a"));

    expect(await readQueue()).toEqual([draft("a")]);
    expect(mocks.updateBadge).toHaveBeenCalledWith("1");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("flushes the draft when the bridge is reachable", async () => {
    await enqueueDraft(draft("a"));

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect(await readQueue()).toEqual([]));
    expect(mocks.updateBadge).toHaveBeenLastCalledWith("");
  });
});

describe("flushQueue", () => {
  it("sends every queued draft and clears the queue", async () => {
    await seed([draft("a"), draft("b")]);

    await flushQueue();

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ type: "download.create", url: "https://example.com/a" }));
    expect(await readQueue()).toEqual([]);
  });

  it("re-queues drafts that fail to send", async () => {
    await seed([draft("a"), draft("b")]);
    mocks.send.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    await flushQueue();

    expect(await readQueue()).toEqual([draft("a")]);
  });

  it("is a no-op when the queue is empty", async () => {
    await flushQueue();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not start a second flush while one is in progress", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.send.mockImplementationOnce(async () => {
      await gate;
    });
    await seed([draft("a"), draft("b")]);

    const first = flushQueue();
    const second = flushQueue(); // returns immediately: `flushing` guard is set synchronously
    release();
    await Promise.all([first, second]);

    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
