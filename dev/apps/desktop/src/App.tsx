import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import FirstRunGate from "./components/FirstRunGate";
import AppShell from "./components/AppShell";
import JobList from "./components/JobList";
import UrlBatch from "./components/UrlBatch";
import type { JobSnapshot } from "@limbo/shared";

function playFinishBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // AudioContext may be blocked until user gesture; ignore.
  }
}

function App() {
  const [jobCount, setJobCount] = useState(0);

  useEffect(() => {
    let unlistenIdle: (() => void) | undefined;
    let unlistenJobs: (() => void) | undefined;

    void listen<{ soundOnFinish?: boolean }>("queue-idle", (event) => {
      if (event.payload?.soundOnFinish !== false) {
        playFinishBeep();
      }
    }).then((fn) => {
      unlistenIdle = fn;
    });

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
      unlistenIdle?.();
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
