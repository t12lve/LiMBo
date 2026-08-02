import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type VideoRes = "best" | "2160" | "1440" | "1080" | "720" | "480";
type VideoFmt = "best" | "mp4" | "webm";

type PendingItem = {
  id: string;
  url: string;
  selected: boolean;
  videoRes: VideoRes;
  videoFmt: VideoFmt;
  withSound: boolean;
  soundOnly: boolean;
};

function buildFormatId(item: PendingItem): string {
  if (item.soundOnly) {
    return "ba/b";
  }

  const height =
    item.videoRes === "best" ? null : Number.parseInt(item.videoRes, 10);

  if (!item.withSound) {
    if (height) {
      return item.videoFmt === "best"
        ? `bv*[height<=${height}]/bv*`
        : `bv*[height<=${height}][ext=${item.videoFmt}]/bv*[height<=${height}]/bv*`;
    }
    return item.videoFmt === "best" ? "bv*" : `bv*[ext=${item.videoFmt}]/bv*`;
  }

  if (height) {
    return `bv*[height<=${height}]+ba/b`;
  }
  return "bv*+ba/b";
}

function newItem(url: string): PendingItem {
  return {
    id: crypto.randomUUID(),
    url,
    selected: true,
    videoRes: "best",
    videoFmt: "mp4",
    withSound: true,
    soundOnly: false,
  };
}

export default function UrlBatch() {
  const [paste, setPaste] = useState("");
  const [items, setItems] = useState<PendingItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => items.filter((i) => i.selected), [items]);

  function ingestPaste(raw: string) {
    const urls = raw
      .split(/[\r\n\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s));
    if (urls.length === 0) return;

    setItems((prev) => {
      const existing = new Set(prev.map((p) => p.url));
      const added = urls.filter((u) => !existing.has(u)).map(newItem);
      return [...prev, ...added];
    });
    setPaste("");
    setMessage(null);
    setError(null);
  }

  function updateItem(id: string, patch: Partial<PendingItem>) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        if (patch.soundOnly === true) {
          next.withSound = false;
        }
        if (patch.withSound === true) {
          next.soundOnly = false;
        }
        return next;
      }),
    );
  }

  async function launchBatch() {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      // Group by identical formatId to minimize invoke round-trips.
      const groups = new Map<string, string[]>();
      for (const item of selected) {
        const formatId = buildFormatId(item);
        const list = groups.get(formatId) ?? [];
        list.push(item.url);
        groups.set(formatId, list);
      }

      let total = 0;
      for (const [formatId, urls] of groups) {
        total += await invoke<number>("enqueue_urls", { urls, formatId });
      }

      setMessage(`${total} téléchargement${total > 1 ? "s" : ""} lancé${total > 1 ? "s" : ""}.`);
      setItems((prev) => prev.filter((i) => !i.selected));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex w-full max-w-2xl flex-col gap-3">
      <label className="text-sm font-medium text-neutral-300" htmlFor="limbo-paste">
        Coller des liens
      </label>
      <textarea
        id="limbo-paste"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (text.trim()) {
            e.preventDefault();
            ingestPaste(text);
          }
        }}
        onBlur={() => {
          if (paste.trim()) ingestPaste(paste);
        }}
        rows={2}
        placeholder="Colle ici — les liens s’ajoutent automatiquement à la liste"
        className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
      />

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>
              {selected.length}/{items.length} sélectionné{selected.length > 1 ? "s" : ""}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="underline hover:text-white"
                onClick={() => setItems((prev) => prev.map((i) => ({ ...i, selected: true })))}
              >
                Tout
              </button>
              <button
                type="button"
                className="underline hover:text-white"
                onClick={() => setItems((prev) => prev.map((i) => ({ ...i, selected: false })))}
              >
                Rien
              </button>
            </div>
          </div>

          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-md border border-neutral-800 bg-neutral-900 p-3"
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={(e) => updateItem(item.id, { selected: e.target.checked })}
                    className="mt-1"
                  />
                  <p className="min-w-0 flex-1 truncate text-xs text-neutral-200" title={item.url}>
                    {item.url}
                  </p>
                  <button
                    type="button"
                    className="text-xs text-neutral-500 hover:text-red-400"
                    onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <label className="flex flex-col gap-1 text-neutral-400">
                    Vidéo
                    <select
                      disabled={item.soundOnly}
                      value={item.videoRes}
                      onChange={(e) =>
                        updateItem(item.id, { videoRes: e.target.value as VideoRes })
                      }
                      className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-white disabled:opacity-40"
                    >
                      <option value="best">Meilleure</option>
                      <option value="2160">2160p</option>
                      <option value="1440">1440p</option>
                      <option value="1080">1080p</option>
                      <option value="720">720p</option>
                      <option value="480">480p</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-neutral-400">
                    Format
                    <select
                      disabled={item.soundOnly}
                      value={item.videoFmt}
                      onChange={(e) =>
                        updateItem(item.id, { videoFmt: e.target.value as VideoFmt })
                      }
                      className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-white disabled:opacity-40"
                    >
                      <option value="mp4">mp4</option>
                      <option value="webm">webm</option>
                      <option value="best">auto</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-2 pt-5 text-neutral-300">
                    <input
                      type="checkbox"
                      checked={item.withSound}
                      disabled={item.soundOnly}
                      onChange={(e) => updateItem(item.id, { withSound: e.target.checked })}
                    />
                    Son
                  </label>

                  <label className="flex items-center gap-2 pt-5 text-neutral-300">
                    <input
                      type="checkbox"
                      checked={item.soundOnly}
                      onChange={(e) => updateItem(item.id, { soundOnly: e.target.checked })}
                    />
                    Son seulement
                  </label>
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            disabled={selected.length === 0 || busy}
            onClick={() => void launchBatch()}
            className="rounded-md bg-white px-3 py-2 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? "Lancement…"
              : `Lancer le batch (${selected.length})`}
          </button>
        </div>
      )}

      {message && <p className="text-xs text-emerald-400">{message}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
