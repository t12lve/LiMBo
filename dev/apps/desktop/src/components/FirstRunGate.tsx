import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type ReactNode } from "react";
import WindowControls from "./WindowControls";

interface AppConfig {
  token: string;
  output_dir: string | null;
}

interface FirstRunGateProps {
  children: ReactNode;
}

function GateChrome({ children }: { children: ReactNode }) {
  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--limbo-bg)] text-[var(--limbo-ivory)]">
      <div
        className="flex shrink-0 items-center justify-between border-b border-[var(--limbo-border)] bg-[var(--limbo-panel)] py-1.5 pl-3 pr-1"
        data-tauri-drag-region
      >
        <span
          className="text-sm font-bold tracking-[0.14em] text-[var(--limbo-gold)]"
          data-tauri-drag-region
        >
          LIMBO
        </span>
        <WindowControls />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">{children}</div>
    </main>
  );
}

function FirstRunGate({ children }: FirstRunGateProps) {
  const [outputDir, setOutputDir] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  const loadConfig = async () => {
    setError(null);
    try {
      const config = await invoke<AppConfig>("get_app_config");
      setOutputDir(config.output_dir);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const handleChooseFolder = async () => {
    setError(null);
    setIsPicking(true);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await invoke("set_output_dir", { path: selected });
        setOutputDir(selected);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIsPicking(false);
    }
  };

  if (error && outputDir === undefined) {
    return (
      <GateChrome>
        <p className="text-sm text-red-400">{error}</p>
        <button
          type="button"
          onClick={() => void loadConfig()}
          className="rounded-md bg-[var(--limbo-gold)] px-4 py-2 font-medium text-[var(--limbo-bg)] transition hover:opacity-90"
        >
          Réessayer
        </button>
      </GateChrome>
    );
  }

  if (outputDir === undefined) {
    return (
      <GateChrome>
        <p className="text-[var(--limbo-muted)]">Chargement...</p>
      </GateChrome>
    );
  }

  if (outputDir === null) {
    return (
      <GateChrome>
        <h1 className="text-2xl font-semibold text-[var(--limbo-gold)]">Bienvenue sur LiMBo</h1>
        <p className="text-center text-[var(--limbo-muted)]">
          Choisissez le dossier où seront enregistrées vos vidéos.
        </p>
        <button
          type="button"
          onClick={() => void handleChooseFolder()}
          disabled={isPicking}
          className="rounded-md bg-[var(--limbo-gold)] px-4 py-2 font-medium text-[var(--limbo-bg)] transition hover:opacity-90 disabled:opacity-50"
        >
          {isPicking ? "Sélection..." : "Choisir le dossier"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </GateChrome>
    );
  }

  return <>{children}</>;
}

export default FirstRunGate;
