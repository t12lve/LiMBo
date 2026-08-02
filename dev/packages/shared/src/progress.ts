export function parseYtDlpProgressLine(
  line: string,
): { percent: number; speed: string; eta: string } | null {
  const match = line.match(
    /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+.+?\s+at\s+(\S+)\s+ETA\s+(\S+)/,
  );

  if (!match) {
    return null;
  }

  return {
    percent: Number(match[1]),
    speed: match[2],
    eta: match[3],
  };
}
