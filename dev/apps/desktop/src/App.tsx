import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import FirstRunGate from "./components/FirstRunGate";
import AppShell from "./components/AppShell";
import JobList from "./components/JobList";
import UrlBatch from "./components/UrlBatch";
import type { JobSnapshot } from "@limbo/shared";

function App() {
  const [jobCount, setJobCount] = useState(0);

  useEffect(() => {
    let unlistenJobs: (() => void) | undefined;

    void invoke<JobSnapshot[]>("get_jobs_snapshot")
      .then((jobs) => setJobCount(jobs.length))
      .catch(() => {});

    void listen<JobSnapshot>("job-updated", () => {
      void invoke<JobSnapshot[]>("get_jobs_snapshot")
        .then((jobs) => setJobCount(jobs.length))
        .catch(() => {});
    }).then((fn) => {
      unlistenJobs = fn;
    });

    return () => {
      unlistenJobs?.();
    };
  }, []);

  return (
    <FirstRunGate>
      <AppShell jobCount={jobCount}>
        <UrlBatch />
        <JobList />
      </AppShell>
    </FirstRunGate>
  );
}

export default App;
