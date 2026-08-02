import { getCurrentWindow } from "@tauri-apps/api/window";

/** Title-bar: reduce → taskbar; close (✕) → hide to system tray. */
export default function WindowControls() {
  async function minimizeToTaskbar() {
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.warn("[LiMBo] minimize failed", err);
    }
  }

  async function hideToTray() {
    try {
      await getCurrentWindow().hide();
    } catch (err) {
      console.warn("[LiMBo] hide failed", err);
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => void minimizeToTaskbar()}
        className="flex h-7 w-8 items-center justify-center rounded text-[var(--limbo-muted)] hover:bg-white/10 hover:text-[var(--limbo-ivory)]"
        title="Réduire (barre des tâches)"
        aria-label="Réduire"
      >
        <span className="mb-1.5 block w-2.5 border-b border-current" />
      </button>
      <button
        type="button"
        onClick={() => void hideToTray()}
        className="flex h-7 w-8 items-center justify-center rounded text-[var(--limbo-muted)] hover:bg-[var(--limbo-crimson)] hover:text-[var(--limbo-ivory)]"
        title="Masquer dans la zone de notification (clic droit → Quitter)"
        aria-label="Masquer dans la zone de notification"
      >
        ✕
      </button>
    </div>
  );
}
