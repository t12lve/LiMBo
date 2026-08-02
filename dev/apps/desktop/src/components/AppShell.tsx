import { useState, type ReactNode } from "react";
import SettingsDrawer from "./SettingsDrawer";
import WindowControls from "./WindowControls";

type Props = {
  children: ReactNode;
  jobCount?: number;
};

function SteppingDisc({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 32 32"
      aria-hidden
    >
      <circle cx="16" cy="16" r="15" fill="#8a1830" />
      <circle cx="16" cy="16" r="11" fill="none" stroke="#e8c878" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="7" fill="none" stroke="#e8c878" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="3" fill="#e8c878" />
    </svg>
  );
}

export default function AppShell({ children, jobCount = 0 }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[var(--limbo-bg)] text-[var(--limbo-ivory)]">
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 20% 120%, rgba(160,20,50,0.35), transparent 50%), linear-gradient(165deg,#1a0c12 0%,#0c0608 60%,#1a1018 100%)",
        }}
      />

      <header
        className="relative z-10 flex shrink-0 items-center justify-between border-b border-[var(--limbo-border)] bg-[var(--limbo-panel)]/90 py-1.5 pl-3 pr-1"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <SteppingDisc />
          <span className="text-sm font-bold tracking-[0.14em] text-[var(--limbo-gold)]">
            LIMBO
          </span>
        </div>
        <div className="flex items-center gap-1">
          {jobCount > 0 && (
            <span className="mr-1 text-[10px] uppercase tracking-wider text-[var(--limbo-muted)]">
              file · {jobCount}
            </span>
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded border border-[var(--limbo-border)] px-2 py-1 text-[var(--limbo-gold)] hover:border-[var(--limbo-gold)]"
            title="Réglages"
            aria-label="Ouvrir les réglages"
          >
            ⚙
          </button>
          <WindowControls />
        </div>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        {children}
      </main>

      <footer className="relative z-10 shrink-0 border-t border-[var(--limbo-border)]/60 px-3 py-1.5 text-center text-[9px] tracking-[0.2em] text-[var(--limbo-muted)]">
        COUR DE LIMBO
      </footer>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
