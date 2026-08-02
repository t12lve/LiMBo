import type { JobPhase, JobSnapshot, TrimRange, VideoFormat } from "./types";

export type WsClientMessage =
  | { type: "hello" }
  | { type: "auth"; token: string }
  | { type: "formats.list"; url: string; cookies?: string }
  | {
      type: "download.create";
      url: string;
      formatId: string;
      trim?: TrimRange;
      cookies?: string;
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTrimRange(value: unknown): value is TrimRange {
  return (
    isRecord(value) &&
    isFiniteNumber(value.startSec) &&
    isFiniteNumber(value.endSec) &&
    value.startSec >= 0 &&
    value.endSec > value.startSec
  );
}

function isJobPhase(value: unknown): value is JobPhase {
  return typeof value === "string" && JOB_PHASES.has(value as JobPhase);
}

function isVideoFormat(value: unknown): value is VideoFormat {
  return (
    isRecord(value) &&
    hasString(value, "formatId") &&
    hasString(value, "label") &&
    hasString(value, "ext") &&
    (value.height === null || isFiniteNumber(value.height)) &&
    typeof value.hasAudio === "boolean" &&
    typeof value.hasVideo === "boolean"
  );
}

function isJobSnapshot(value: unknown): value is JobSnapshot {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "url") &&
    hasString(value, "title") &&
    isJobPhase(value.phase) &&
    isFiniteNumber(value.percent) &&
    hasString(value, "speed") &&
    hasString(value, "eta") &&
    (value.error === undefined || typeof value.error === "string")
  );
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
      return (
        hasString(value, "url") &&
        (value.cookies === undefined || typeof value.cookies === "string")
      );
    case "download.create":
      return (
        hasString(value, "url") &&
        hasString(value, "formatId") &&
        (value.trim === undefined || isTrimRange(value.trim)) &&
        (value.cookies === undefined || typeof value.cookies === "string")
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
        value.formats.every(isVideoFormat) &&
        hasString(value, "title") &&
        isFiniteNumber(value.duration) &&
        hasString(value, "thumbnail")
      );
    case "job.created":
    case "job.done":
    case "job.error":
      return isJobSnapshot(value.job);
    case "job.progress":
      return (
        hasString(value, "id") &&
        isFiniteNumber(value.percent) &&
        hasString(value, "speed") &&
        hasString(value, "eta") &&
        isJobPhase(value.phase)
      );
    case "jobs.snapshot":
      return Array.isArray(value.jobs) && value.jobs.every(isJobSnapshot);
    default:
      return false;
  }
}
