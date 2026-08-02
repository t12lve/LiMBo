export type JobPhase =
  | "queued"
  | "fetching_meta"
  | "downloading"
  | "merging"
  | "trimming"
  | "done"
  | "error";

export type TrimRange = { startSec: number; endSec: number };

export type VideoFormat = {
  formatId: string;
  label: string;
  ext: string;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
};

export type JobSnapshot = {
  id: string;
  url: string;
  title: string;
  phase: JobPhase;
  percent: number;
  speed: string;
  eta: string;
  error?: string;
};

/** Desktop default quality preference synced to the extension via prefs.snapshot. */
export type DefaultQuality = "best_image" | "best_sound";
