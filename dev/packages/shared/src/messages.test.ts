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
});
