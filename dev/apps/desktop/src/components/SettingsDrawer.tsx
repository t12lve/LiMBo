import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

type PostQueueAction = "none" | "sleep" | "shutdown" | "force_shutdown";
type DefaultQuality = "best_image" | "best_sound";

type AppConfig = {
  output_dir: string | null;
  sound_on_finish: boolean;
  post_queue_action: PostQueueAction;
  cookies_browser: string;
  default_quality: string;
  launch_at_startup: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function SettingsDrawer({ open: isOpen, onClose }: Props) {
  const [outputDir, setOutputDir] = useState<string>("");
  const [sound, setSound] = useState(true);
  const [action, setAction] = useState<PostQueueAction>("none");
  const [cookies, setCookies] = useState("edge");
  const [quality, setQuality] = useState<DefaultQuality>("best_image");
  const [startup, setStartup] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    void invoke<AppConfig>("get_app_config").then((cfg) => {
      setOutputDir(cfg.output_dir ?? "");
      setSound(cfg.sound_on_finish ?? true);
      setAction(cfg.post_queue_action ?? "none");
      setCookies(cfg.cookies_browser ?? "chrome");
      setQuality(cfg.default_quality === "best_sound" ? "best_sound" : "best_image");
      setStartup(cfg.launch_at_startup ?? false);
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  async function persist(next: Record<string, unknown>) {
    const cfg = await invoke<AppConfig>("update_prefs", { prefs: next });
    setSound(cfg.sound_on_finish);
    setAction(cfg.post_queue_action);
    setCookies(cfg.cookies_browser);
    setQuality(cfg.default_quality === "best_sound" ? "best_sound" : "best_image");
    setStartup(cfg.launch_at_startup);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await invoke("set_output_dir", { path: selected });
      setOutputDir(selected);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-40 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        aria-label="Fermer les réglages"
        onClick={onClose}
      />
      <aside className="relative z-50 flex h-full w-[72%] max-w-[320px] flex-col gap-3 overflow-y-auto border-l border-[var(--limbo-gold)]/40 bg-[var(--limbo-panel)] p-4 text-xs text-[var(--limbo-ivory)] shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--limbo-gold)]">
            Réglages
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--limbo-muted)] hover:text-[var(--limbo-gold)]"
          >
            Fermer
          </button>
        </div>

        <label className="flex flex-col gap-1">
          Dossier de téléchargement
          <button
            type="button"
            onClick={() => void pickFolder()}
            className="truncate rounded border border-[var(--limbo-border)] bg-black/40 px-2 py-1.5 text-left text-[11px] text-[var(--limbo-ivory)] hover:border-[var(--limbo-gold)]"
            title={outputDir}
          >
            {outputDir || "Choisir…"}
          </button>
        </label>

        <label className="flex flex-col gap-1">
          Type par défaut
          <select
            value={quality}
            onChange={(e) => {
              const v = e.target.value as DefaultQuality;
              setQuality(v);
              void persist({ defaultQuality: v });
            }}
            className="rounded border border-[var(--limbo-border)] bg-black/40 px-2 py-1.5 text-[var(--limbo-ivory)]"
          >
            <option value="best_image">Meilleure image</option>
            <option value="best_sound">Meilleur son</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          Cookies (batch desktop)
          <select
            value={cookies}
            onChange={(e) => {
              setCookies(e.target.value);
              void persist({ cookiesBrowser: e.target.value });
            }}
            className="rounded border border-[var(--limbo-border)] bg-black/40 px-2 py-1.5 text-[var(--limbo-ivory)]"
          >
            <option value="chrome">Chrome</option>
            <option value="edge">Edge</option>
            <option value="brave">Brave</option>
            <option value="firefox">Firefox</option>
            <option value="none">Aucun</option>
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              void persist({ soundOnFinish: e.target.checked });
            }}
          />
          Son à la fin
        </label>

        <label className="flex flex-col gap-1">
          Après la file
          <select
            value={action}
            onChange={(e) => {
              const v = e.target.value as PostQueueAction;
              setAction(v);
              void persist({ postQueueAction: v });
            }}
            className="rounded border border-[var(--limbo-border)] bg-black/40 px-2 py-1.5 text-[var(--limbo-ivory)]"
          >
            <option value="none">Ne rien faire</option>
            <option value="sleep">Mettre en veille</option>
            <option value="shutdown">Éteindre (60s)</option>
            <option value="force_shutdown">Forcer l’arrêt</option>
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={startup}
            onChange={(e) => {
              setStartup(e.target.checked);
              void persist({ launchAtStartup: e.target.checked });
            }}
          />
          Lancer au démarrage Windows (minimisé)
        </label>

        <p className="text-[10px] leading-snug text-[var(--limbo-muted)]">
          L’extension envoie ses cookies sans fermer le navigateur. « Cookies
          navigateur » sert au collage Desktop (ferme Edge sinon erreur cookie
          database — le message dit souvent « Chrome » même pour Edge).
        </p>

        <p className="text-[10px] leading-snug text-[var(--limbo-muted)]">
          La croix réduit LiMBo dans la barre des tâches. Pour quitter : clic droit
          sur l’icône → Fermer la fenêtre.
        </p>

        <button
          type="button"
          onClick={() => {
            void getCurrentWindow().close();
          }}
          className="mt-1 rounded border border-[var(--limbo-crimson)] px-2 py-1.5 text-[var(--limbo-ivory)] hover:bg-[var(--limbo-crimson)]"
        >
          Quitter LiMBo
        </button>

        {saved && <span className="text-[var(--limbo-gold)]">Enregistré</span>}
      </aside>
    </div>
  );
}
