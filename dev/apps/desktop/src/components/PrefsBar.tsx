import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type PostQueueAction = "none" | "sleep" | "shutdown" | "force_shutdown";

type AppConfig = {
  sound_on_finish: boolean;
  post_queue_action: PostQueueAction;
  cookies_browser: string;
};

export default function PrefsBar() {
  const [sound, setSound] = useState(true);
  const [action, setAction] = useState<PostQueueAction>("none");
  const [cookies, setCookies] = useState("chrome");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void invoke<AppConfig>("get_app_config").then((cfg) => {
      setSound(cfg.sound_on_finish ?? true);
      setAction(cfg.post_queue_action ?? "none");
      setCookies(cfg.cookies_browser ?? "chrome");
    });
  }, []);

  async function persist(next: {
    soundOnFinish?: boolean;
    postQueueAction?: PostQueueAction;
    cookiesBrowser?: string;
  }) {
    const cfg = await invoke<AppConfig>("update_prefs", { prefs: next });
    setSound(cfg.sound_on_finish);
    setAction(cfg.post_queue_action);
    setCookies(cfg.cookies_browser);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  return (
    <section className="flex w-full max-w-2xl flex-wrap items-end gap-3 rounded-md border border-neutral-800 bg-neutral-900/60 p-3 text-xs text-neutral-300">
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
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-white"
        >
          <option value="none">Ne rien faire</option>
          <option value="sleep">Mettre en veille</option>
          <option value="shutdown">Éteindre (60s)</option>
          <option value="force_shutdown">Forcer l’arrêt</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        Cookies (Instagram…)
        <select
          value={cookies}
          onChange={(e) => {
            setCookies(e.target.value);
            void persist({ cookiesBrowser: e.target.value });
          }}
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-white"
        >
          <option value="chrome">Chrome</option>
          <option value="edge">Edge</option>
          <option value="brave">Brave</option>
          <option value="firefox">Firefox</option>
          <option value="none">Aucun</option>
        </select>
      </label>

      {saved && <span className="text-emerald-400">Enregistré</span>}
    </section>
  );
}
