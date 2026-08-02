export function parseTimecode(input: string): number | null {
  const parts = input.split(":");

  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !/^\d+$/.test(part))
  ) {
    return null;
  }

  const values = parts.map(Number);
  const [hours, minutes, seconds] =
    values.length === 3 ? values : [0, values[0], values[1]];

  if (minutes > 59 || seconds > 59) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

export function formatTimecode(sec: number): string {
  const totalSeconds = Math.max(0, Math.floor(sec));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function validateTrim(
  startSec: number,
  endSec: number,
  durationSec: number,
): { ok: true } | { ok: false; error: string } {
  if (
    !Number.isFinite(startSec) ||
    !Number.isFinite(endSec) ||
    !Number.isFinite(durationSec)
  ) {
    return { ok: false, error: "Les durées doivent être des nombres finis." };
  }

  if (startSec < 0 || endSec < 0 || durationSec <= 0) {
    return { ok: false, error: "Les durées doivent être positives." };
  }

  if (endSec <= startSec) {
    return {
      ok: false,
      error: "La fin du découpage doit être après son début.",
    };
  }

  if (endSec > durationSec) {
    return {
      ok: false,
      error: "La fin du découpage dépasse la durée de la vidéo.",
    };
  }

  return { ok: true };
}
