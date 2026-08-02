import { describe, expect, it } from "vitest";
import { parseYtDlpProgressLine } from "./progress";

describe("parseYtDlpProgressLine", () => {
  it("parses a typical yt-dlp progress line", () => {
    const line =
      "[download]  45.2% of  10.00MiB at  1.25MiB/s ETA 00:04";

    expect(parseYtDlpProgressLine(line)).toEqual({
      percent: 45.2,
      speed: "1.25MiB/s",
      eta: "00:04",
    });
  });

  it("returns null for unrelated lines", () => {
    expect(parseYtDlpProgressLine("[info] Downloading")).toBeNull();
  });
});
