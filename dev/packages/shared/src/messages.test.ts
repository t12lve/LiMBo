import { describe, expect, it } from "vitest";
import {
  isWsClientMessage,
  isWsServerMessage,
  type WsClientMessage,
} from "./messages";

describe("isWsClientMessage", () => {
  it("accepts a JSON round-trip of download.create", () => {
    const message: WsClientMessage = {
      type: "download.create",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      formatId: "18",
      trim: { startSec: 10, endSec: 60 },
    };

    const parsed: unknown = JSON.parse(JSON.stringify(message));

    expect(isWsClientMessage(parsed)).toBe(true);
  });

  it.each([
    { startSec: -1, endSec: 60 },
    { startSec: 60, endSec: 60 },
    { startSec: 10, endSec: Number.POSITIVE_INFINITY },
  ])("rejects download.create with invalid trim %#", (trim) => {
    expect(
      isWsClientMessage({
        type: "download.create",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        formatId: "18",
        trim,
      }),
    ).toBe(false);
  });
});

describe("isWsServerMessage", () => {
  it("rejects a job.progress message with an invalid phase", () => {
    expect(
      isWsServerMessage({
        type: "job.progress",
        id: "job-1",
        percent: 45.2,
        speed: "1.25MiB/s",
        eta: "00:04",
        phase: "invalid",
      }),
    ).toBe(false);
  });

  it.each(["job.created", "job.done", "job.error"] as const)(
    "rejects %s with an incomplete job snapshot",
    (type) => {
      expect(isWsServerMessage({ type, job: {} })).toBe(false);
    },
  );

  it("rejects formats.result with an invalid video format", () => {
    expect(
      isWsServerMessage({
        type: "formats.result",
        formats: [{ formatId: "18" }],
        title: "Video",
        duration: 120,
        thumbnail: "https://example.com/thumbnail.jpg",
      }),
    ).toBe(false);
  });

  it("rejects jobs.snapshot with an incomplete job snapshot", () => {
    expect(
      isWsServerMessage({
        type: "jobs.snapshot",
        jobs: [{ id: "job-1" }],
      }),
    ).toBe(false);
  });

  it("accepts prefs.snapshot with a valid defaultQuality", () => {
    expect(
      isWsServerMessage({
        type: "prefs.snapshot",
        defaultQuality: "best_image",
      }),
    ).toBe(true);
    expect(
      isWsServerMessage({
        type: "prefs.snapshot",
        defaultQuality: "best_sound",
      }),
    ).toBe(true);
  });

  it("rejects prefs.snapshot with an invalid defaultQuality", () => {
    expect(
      isWsServerMessage({
        type: "prefs.snapshot",
        defaultQuality: "720p",
      }),
    ).toBe(false);
  });
});
