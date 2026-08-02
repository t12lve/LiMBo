import { describe, expect, it } from "vitest";
import { formatTimecode, parseTimecode, validateTrim } from "./trim";

describe("parseTimecode", () => {
  it("parses mm:ss", () => {
    expect(parseTimecode("1:30")).toBe(90);
  });

  it("parses hh:mm:ss", () => {
    expect(parseTimecode("1:02:03")).toBe(3723);
  });

  it("rejects garbage", () => {
    expect(parseTimecode("abc")).toBeNull();
  });
});

describe("validateTrim", () => {
  it("accepts valid range", () => {
    expect(validateTrim(10, 60, 120)).toEqual({ ok: true });
  });

  it("rejects end <= start", () => {
    expect(validateTrim(60, 60, 120).ok).toBe(false);
  });

  it("rejects beyond duration", () => {
    expect(validateTrim(0, 200, 120).ok).toBe(false);
  });
});

describe("formatTimecode", () => {
  it("formats seconds", () => {
    expect(formatTimecode(90)).toBe("01:30");
  });
});
