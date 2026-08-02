import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import FirstRunGate from "./components/FirstRunGate";
import JobList from "./components/JobList";
import PrefsBar from "./components/PrefsBar";
import UrlBatch from "./components/UrlBatch";

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
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ soundOnFinish?: boolean }>("queue-idle", (event) => {
      if (event.payload?.soundOnFinish !== false) {
        playFinishBeep();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  return (
    <FirstRunGate>
      <main className="flex h-screen w-screen flex-col items-center gap-5 overflow-y-auto bg-neutral-950 p-8">
        <h1 className="text-4xl font-bold tracking-tight text-white">LiMBo</h1>
        <PrefsBar />
        <UrlBatch />
        <JobList />
      </main>
    </FirstRunGate>
  );
}

export default App;
