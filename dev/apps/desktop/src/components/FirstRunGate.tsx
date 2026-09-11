import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type ReactNode } from "react";
import WindowControls from "./WindowControls";
import ExtensionModal from "./ExtensionModal";

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
  const [showExtensionStep, setShowExtensionStep] = useState(false);
  const [extensionModalOpen, setExtensionModalOpen] = useState(false);

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
        setShowExtensionStep(true);
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
          className="rounded-md bg-[var(--limbo-gold)] px-4 py-2 font-medium text-[var(--limbo-bg)] transition hover:opacity-90 disabled:opacity-50 cursor-pointer"
        >
          {isPicking ? "Sélection..." : "Choisir le dossier"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </GateChrome>
    );
  }

  if (showExtensionStep) {
    return (
      <GateChrome>
        <h1 className="text-xl font-semibold text-[var(--limbo-gold)]">Dossier configuré !</h1>
        <p className="text-center text-xs text-[var(--limbo-muted)] max-w-[320px]">
          Pour profiter du téléchargement direct en 1 clic depuis votre navigateur, activez l'extension LiMBo (Chrome, Edge, Brave ou Firefox).
        </p>
        <div className="flex flex-col gap-2.5 w-full max-w-[280px]">
          <button
            type="button"
            onClick={() => setExtensionModalOpen(true)}
            className="rounded-md bg-[var(--limbo-gold)] px-4 py-2 text-xs font-bold text-[var(--limbo-bg)] transition hover:opacity-90 cursor-pointer flex items-center justify-center gap-1.5"
          >
            <span>🧩</span> Activer l'extension navigateur
          </button>
          <button
            type="button"
            onClick={() => setShowExtensionStep(false)}
            className="rounded-md border border-[var(--limbo-border)] hover:border-[var(--limbo-gold)] px-4 py-2 text-xs font-semibold text-[var(--limbo-ivory)] transition cursor-pointer"
          >
            Accéder directement à LiMBo →
          </button>
        </div>
        <ExtensionModal
          isOpen={extensionModalOpen}
          onClose={() => {
            setExtensionModalOpen(false);
            setShowExtensionStep(false);
          }}
        />
      </GateChrome>
    );
  }

  return <>{children}</>;
}

export default FirstRunGate;
