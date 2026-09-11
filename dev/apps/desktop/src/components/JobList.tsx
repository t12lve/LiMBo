import type { JobPhase, JobSnapshot } from "@limbo/shared";
import { useEffect, useState, useSyncExternalStore } from "react";
import { jobsStore } from "../lib/jobs-store";

const PHASE_LABELS: Record<JobPhase, string> = {
  queued: "En file",
  fetching_meta: "Infos...",
  downloading: "Téléchargement",
  merging: "Fusion",
  trimming: "Découpe",
  done: "Terminé",
  error: "Erreur",
};

const CANCELLABLE_PHASES: JobPhase[] = [
  "queued",
  "fetching_meta",
  "downloading",
  "merging",
  "trimming",
];

function JobRow({ job }: { job: JobSnapshot }) {
  const [cancelling, setCancelling] = useState(false);
  const canCancel = CANCELLABLE_PHASES.includes(job.phase) && !cancelling;

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await jobsStore.cancel(job.id);
    } catch {
      setCancelling(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-md border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-white">
          {job.title || job.url}
        </span>
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={!canCancel}
          className="shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Annuler
        </button>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full rounded-full transition-all ${
            job.phase === "error" ? "bg-red-500" : "bg-white"
          }`}
          style={{ width: `${Math.min(100, Math.max(0, job.percent))}%` }}
        />
      </div>

      <div className="flex items-start justify-between text-xs text-neutral-400">
        <span className="min-w-0 whitespace-normal break-words">
          {PHASE_LABELS[job.phase]}
        </span>
        <span className="shrink-0 tabular-nums pl-2">
          {job.percent.toFixed(0)}%
          {job.speed ? ` · ${job.speed}` : ""}
          {job.eta ? ` · ETA ${job.eta}` : ""}
        </span>
      </div>
      {job.error && (
        <p className="text-xs leading-snug text-red-400" title={job.error}>
          {job.error}
        </p>
      )}
    </li>
  );
}

function JobList() {
  useEffect(() => {
    void jobsStore.init();
  }, []);

  const jobs = useSyncExternalStore(jobsStore.subscribe, jobsStore.getSnapshot);

  if (jobs.length === 0) {
    return <p className="text-sm text-neutral-500">Aucun téléchargement pour le moment.</p>;
  }

  return (
    <ul className="flex w-full max-w-xl flex-col gap-2">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </ul>
  );
}

export default JobList;
