import { getCurrentWindow } from "@tauri-apps/api/window";

/** Title-bar controls: X minimizes to the taskbar; OS/taskbar "Close" still quits the app. */
export default function WindowControls() {
  async function minimize() {
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.warn("[LiMBo] minimize failed", err);
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => void minimize()}
        className="flex h-7 w-8 items-center justify-center rounded text-[var(--limbo-muted)] hover:bg-white/10 hover:text-[var(--limbo-ivory)]"
        title="Réduire"
        aria-label="Réduire"
      >
        <span className="mb-1.5 block w-2.5 border-b border-current" />
      </button>
      <button
        type="button"
        onClick={() => void minimize()}
        className="flex h-7 w-8 items-center justify-center rounded text-[var(--limbo-muted)] hover:bg-[var(--limbo-crimson)] hover:text-[var(--limbo-ivory)]"
        title="Réduire dans la barre des tâches (clic droit → Fermer pour quitter)"
        aria-label="Réduire dans la barre des tâches"
      >
        ✕
      </button>
    </div>
  );
}
