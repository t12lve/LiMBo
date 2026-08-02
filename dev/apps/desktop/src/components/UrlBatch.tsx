import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Default yt-dlp selector: best video + best audio, fallback to single best stream. */
const DEFAULT_FORMAT = "bv*+ba/b";

export default function UrlBatch() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const urls = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  async function handleSubmit() {
    if (urls.length === 0 || busy) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const count = await invoke<number>("enqueue_urls", {
        urls,
        formatId: DEFAULT_FORMAT,
      });
      setMessage(`${count} téléchargement${count > 1 ? "s" : ""} ajouté${count > 1 ? "s" : ""} (meilleure qualité avec son).`);
      setText("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex w-full max-w-xl flex-col gap-2">
      <label className="text-sm font-medium text-neutral-300" htmlFor="limbo-urls">
        Coller des liens (un par ligne)
      </label>
      <textarea
        id="limbo-urls"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"https://www.youtube.com/watch?v=...\nhttps://vimeo.com/..."}
        className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
      />
      <button
        type="button"
        disabled={urls.length === 0 || busy}
        onClick={() => void handleSubmit()}
        className="rounded-md bg-white px-3 py-2 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy
          ? "Ajout…"
          : urls.length === 0
            ? "Télécharger la sélection"
            : `Télécharger ${urls.length} lien${urls.length > 1 ? "s" : ""}`}
      </button>
      {message && <p className="text-xs text-emerald-400">{message}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
