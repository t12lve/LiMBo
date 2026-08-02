import { describe, expect, it } from "vitest";
import { extractPageVideoUrl, extractYoutubeVideoUrl } from "./youtube";

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

describe("extractPageVideoUrl", () => {
  it("keeps youtube canonical", () => {
    expect(
      extractPageVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"),
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("accepts other http sites", () => {
    expect(extractPageVideoUrl("https://vimeo.com/123")).toBe(
      "https://vimeo.com/123",
    );
  });

  it("rejects chrome urls", () => {
    expect(extractPageVideoUrl("chrome://extensions")).toBeNull();
  });
});
