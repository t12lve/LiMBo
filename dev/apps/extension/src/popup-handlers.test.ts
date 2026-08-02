import { describe, expect, it, vi } from "vitest";
import { requestFormats } from "./popup-handlers";

const { handlers, send } = vi.hoisted(() => ({
  handlers: new Set<(message: unknown) => void>(),
  send: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./ws-client", () => ({
  onServerMessage: (handler: (message: unknown) => void) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  },
  send,
}));

describe("requestFormats", () => {
  it("waits for the stale result before sending the replacement request", async () => {
    const first = requestFormats("https://youtube.com/watch?v=first");
    const second = requestFormats("https://youtube.com/watch?v=second");

    await expect(first).resolves.toMatchObject({ ok: false });
    expect(send).toHaveBeenCalledTimes(1);

    for (const handler of handlers) {
      handler({
        type: "formats.result",
        title: "First",
        duration: 1,
        thumbnail: "",
        formats: [],
      });
    }
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    for (const handler of handlers) {
      handler({
        type: "formats.result",
        title: "Second",
        duration: 2,
        thumbnail: "",
        formats: [
          {
            formatId: "second",
            label: "720p",
            ext: "mp4",
            height: 720,
            hasAudio: true,
            hasVideo: true,
          },
        ],
      });
    }

    await expect(second).resolves.toMatchObject({
      ok: true,
      title: "Second",
      formats: [{ formatId: "second" }],
    });
  });
});
