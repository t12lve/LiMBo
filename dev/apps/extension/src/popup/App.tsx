import { useEffect, useMemo, useState } from "react";
import type { TrimRange, VideoFormat } from "@limbo/shared";
import { formatTimecode, parseTimecode, validateTrim } from "@limbo/shared";
import { getActiveVideoTab } from "../youtube-tab";
import type { DownloadResult, FormatsResult, PopupRequest } from "../popup-messages";
import TrimFields from "./TrimFields";
import FormatList from "./FormatList";
import { getDefaultQuality, loadDefaultQualityFromStorage } from "../prefs";

type TabState =
  | { status: "loading" }
  | { status: "unsupported" }
  | { status: "ready"; url: string };

type FormatsState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "loaded";
      title: string;
      duration: number;
      thumbnail: string;
      formats: VideoFormat[];
    }
  | { status: "error"; error: string };

type DownloadState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "done"; queued: boolean }
  | { status: "error"; error: string };

function sendPopupMessage<T>(message: PopupRequest): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function defaultFormatId(formats: VideoFormat[]): string | null {
  const preferSound = getDefaultQuality() === "best_sound";
  if (preferSound) {
    return (
      formats.find((f) => f.hasAudio && !f.hasVideo)?.formatId ??
      formats.find((f) => f.hasVideo && f.hasAudio)?.formatId ??
      formats[0]?.formatId ??
      null
    );
  }
  return (
    formats.find((f) => f.hasVideo && f.hasAudio)?.formatId ??
    formats.find((f) => f.hasAudio && !f.hasVideo)?.formatId ??
    formats[0]?.formatId ??
    null
  );
}

export default function App() {
  const [tab, setTab] = useState<TabState>({ status: "loading" });
  const [formatsState, setFormatsState] = useState<FormatsState>({ status: "idle" });
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [startText, setStartText] = useState("00:00");
  const [endText, setEndText] = useState("");
  const [downloadState, setDownloadState] = useState<DownloadState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    void loadDefaultQualityFromStorage().then(() => {
      if (cancelled) return;
    });
    void getActiveVideoTab().then((result) => {
      if (cancelled) return;
      setTab(result.ok ? { status: "ready", url: result.url } : { status: "unsupported" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab.status !== "ready") return;
    let cancelled = false;
    setFormatsState({ status: "loading" });

    sendPopupMessage<FormatsResult>({ type: "popup.formats", url: tab.url })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setFormatsState({
            status: "loaded",
            title: result.title,
            duration: result.duration,
            thumbnail: result.thumbnail,
            formats: result.formats,
          });
          setSelectedFormatId(defaultFormatId(result.formats));
          setEndText(formatTimecode(result.duration));
        } else {
          setFormatsState({ status: "error", error: result.error });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFormatsState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [tab]);

  const duration = formatsState.status === "loaded" ? formatsState.duration : 0;

  const trim = useMemo((): { range: TrimRange | null; error: string | null } => {
    if (!trimEnabled) {
      return { range: null, error: null };
    }

    const startSec = parseTimecode(startText);
    const endSec = parseTimecode(endText);

    if (startSec === null || endSec === null) {
      return { range: null, error: "Format attendu : mm:ss (ex. 00:05)." };
    }

    const validation = validateTrim(startSec, endSec, duration);
    if (!validation.ok) {
      return { range: null, error: validation.error };
    }

    return { range: { startSec, endSec }, error: null };
  }, [trimEnabled, startText, endText, duration]);

  const canDownload =
    formatsState.status === "loaded" &&
    selectedFormatId !== null &&
    (!trimEnabled || trim.range !== null) &&
    downloadState.status !== "sending";

  async function handleDownload() {
    if (tab.status !== "ready" || selectedFormatId === null) return;
    if (formatsState.status !== "loaded") return;

    const selected = formatsState.formats.find((f) => f.formatId === selectedFormatId);

    setDownloadState({ status: "sending" });
    try {
      const result = await sendPopupMessage<DownloadResult>({
        type: "popup.download",
        payload: {
          url: tab.url,
          formatId: selectedFormatId,
          trim: trim.range ?? undefined,
          hasAudio: selected?.hasAudio,
          hasVideo: selected?.hasVideo,
        },
      });
      setDownloadState(
        result.ok
          ? { status: "done", queued: result.queued }
          : { status: "error", error: result.error },
      );
    } catch (err) {
      setDownloadState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="flex w-80 flex-col gap-3 p-4">
      <header className="flex items-center gap-2.5">
        <img
          src={chrome.runtime.getURL("icons/icon-32.png")}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 rounded"
        />
        <h1 className="text-lg font-semibold tracking-wide">LiMBo</h1>
      </header>

      {tab.status === "loading" && <p className="text-sm text-gray-500">Chargement…</p>}

      {tab.status === "unsupported" && (
        <p className="text-sm text-gray-600">
          Ouvrez une page vidéo (http/https) pour lancer un téléchargement.
        </p>
      )}

      {tab.status === "ready" && (
        <>
          {formatsState.status === "loading" && (
            <p className="text-sm text-gray-500">Récupération des formats…</p>
          )}

          {formatsState.status === "error" && (
            <p className="text-sm text-red-600">{formatsState.error}</p>
          )}

          {formatsState.status === "loaded" && (
            <>
              <div className="flex items-center gap-3">
                {formatsState.thumbnail ? (
                  <img
                    src={formatsState.thumbnail}
                    alt=""
                    className="h-14 w-24 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-14 w-24 shrink-0 rounded bg-gray-200" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={formatsState.title}>
                    {formatsState.title}
                  </p>
                  {formatsState.duration > 0 && (
                    <p className="text-xs text-gray-400">
                      {formatTimecode(formatsState.duration)}
                    </p>
                  )}
                </div>
              </div>

              <FormatList
                formats={formatsState.formats}
                selectedFormatId={selectedFormatId}
                onSelect={setSelectedFormatId}
              />

              <TrimFields
                enabled={trimEnabled}
                onToggle={setTrimEnabled}
                startText={startText}
                endText={endText}
                onStartChange={setStartText}
                onEndChange={setEndText}
                durationSec={formatsState.duration}
                error={trim.error}
              />

              <button
                type="button"
                disabled={!canDownload}
                onClick={() => void handleDownload()}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {downloadState.status === "sending" ? "Envoi…" : "Télécharger"}
              </button>

              {downloadState.status === "done" && (
                <p className="text-xs text-green-600">
                  {downloadState.queued
                    ? "LiMBo Desktop est hors ligne : ajouté à la file, démarrera à la reconnexion."
                    : "Téléchargement lancé — suis la progression dans l’app LiMBo."}
                </p>
              )}

              {downloadState.status === "error" && (
                <p className="text-xs text-red-600">{downloadState.error}</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
