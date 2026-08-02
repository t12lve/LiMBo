import type { JobPhase, JobSnapshot, TrimRange, VideoFormat } from "./types";

export type WsClientMessage =
  | { type: "hello" }
  | { type: "auth"; token: string }
  | { type: "formats.list"; url: string }
  | {
      type: "download.create";
      url: string;
      formatId: string;
      trim?: TrimRange;
    }
  | { type: "job.cancel"; id: string };

export type WsServerMessage =
  | { type: "hello.ok"; token: string }
  | { type: "auth.ok" }
  | { type: "auth.fail"; error: string }
  | {
      type: "formats.result";
      formats: VideoFormat[];
      title: string;
      duration: number;
      thumbnail: string;
    }
  | { type: "formats.error"; error: string }
  | { type: "job.created"; job: JobSnapshot }
  | {
      type: "job.progress";
      id: string;
      percent: number;
      speed: string;
      eta: string;
      phase: JobPhase;
    }
  | { type: "job.done"; job: JobSnapshot }
  | { type: "job.error"; job: JobSnapshot }
  | { type: "jobs.snapshot"; jobs: JobSnapshot[] };

type JsonRecord = Record<string, unknown>;

const JOB_PHASES = new Set<JobPhase>([
  "queued",
  "fetching_meta",
  "downloading",
  "merging",
  "trimming",
  "done",
  "error",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function hasString(value: JsonRecord, key: string): boolean {
  return typeof value[key] === "string";
}

function isTrimRange(value: unknown): value is TrimRange {
  return (
    isRecord(value) &&
    typeof value.startSec === "number" &&
    typeof value.endSec === "number"
  );
}

function isJobPhase(value: unknown): value is JobPhase {
  return typeof value === "string" && JOB_PHASES.has(value as JobPhase);
}

export function isWsClientMessage(value: unknown): value is WsClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "hello":
      return true;
    case "auth":
      return hasString(value, "token");
    case "formats.list":
      return hasString(value, "url");
    case "download.create":
      return (
        hasString(value, "url") &&
        hasString(value, "formatId") &&
        (value.trim === undefined || isTrimRange(value.trim))
      );
    case "job.cancel":
      return hasString(value, "id");
    default:
      return false;
  }
}

export function isWsServerMessage(value: unknown): value is WsServerMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "hello.ok":
      return hasString(value, "token");
    case "auth.ok":
      return true;
    case "auth.fail":
    case "formats.error":
      return hasString(value, "error");
    case "formats.result":
      return (
        Array.isArray(value.formats) &&
        hasString(value, "title") &&
        typeof value.duration === "number" &&
        hasString(value, "thumbnail")
      );
    case "job.created":
    case "job.done":
    case "job.error":
      return isRecord(value.job);
    case "job.progress":
      return (
        hasString(value, "id") &&
        typeof value.percent === "number" &&
        hasString(value, "speed") &&
        hasString(value, "eta") &&
        isJobPhase(value.phase)
      );
    case "jobs.snapshot":
      return Array.isArray(value.jobs);
    default:
      return false;
  }
}
