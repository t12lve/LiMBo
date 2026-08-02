import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { JobSnapshot } from "@limbo/shared";

/// Mirrors `job_runner::JOB_UPDATED_EVENT` on the Rust side.
const JOB_UPDATED_EVENT = "job-updated";

type Listener = () => void;

/**
 * Client-side mirror of the Rust `JobRunner`'s job list, kept in sync via the `job-updated`
 * Tauri event and seeded from `get_jobs_snapshot` on startup (covers jobs created/updated before
 * the listener attached, and gives the UI something to render immediately).
 *
 * Exposes `subscribe`/`getSnapshot` for `useSyncExternalStore` so React re-renders on every
 * job mutation without polling.
 */
class JobsStore {
  private jobs: JobSnapshot[] = [];
  private listeners = new Set<Listener>();
  private unlisten: UnlistenFn | null = null;
  private initPromise: Promise<void> | null = null;

  /** Idempotent: safe to call from every mounting consumer. */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.unlisten = await listen<JobSnapshot>(JOB_UPDATED_EVENT, (event) => {
      this.upsert(event.payload);
    });

    // Fetched after the listener is attached so any event racing this call is superseded by
    // (or already reflected in) the snapshot below.
    const snapshot = await invoke<JobSnapshot[]>("get_jobs_snapshot");
    this.jobs = snapshot;
    this.emit();
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.initPromise = null;
    this.jobs = [];
  }

  async cancel(id: string): Promise<void> {
    await invoke("cancel_job", { id });
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): JobSnapshot[] => this.jobs;

  private upsert(job: JobSnapshot): void {
    const index = this.jobs.findIndex((existing) => existing.id === job.id);
    this.jobs =
      index === -1
        ? [...this.jobs, job]
        : this.jobs.map((existing, i) => (i === index ? job : existing));
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const jobsStore = new JobsStore();
