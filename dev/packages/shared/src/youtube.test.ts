import { describe, expect, it } from "vitest";
import { extractYoutubeVideoUrl } from "./youtube";

describe("extractYoutubeVideoUrl", () => {
  it("normalizes watch URLs", () => {
    expect(
      extractYoutubeVideoUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30",
      ),
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("handles youtu.be", () => {
    expect(extractYoutubeVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("handles shorts", () => {
    expect(
      extractYoutubeVideoUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("returns null for non-youtube", () => {
    expect(extractYoutubeVideoUrl("https://example.com")).toBeNull();
  });
});
