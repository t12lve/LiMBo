import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type ReactNode } from "react";

interface AppConfig {
  token: string;
  output_dir: string | null;
}

interface FirstRunGateProps {
  children: ReactNode;
}

function FirstRunGate({ children }: FirstRunGateProps) {
  const [outputDir, setOutputDir] = useState<string | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  useEffect(() => {
    invoke<AppConfig>("get_app_config")
      .then((config) => setOutputDir(config.output_dir))
      .catch((e) => setError(String(e)));
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

  if (outputDir === undefined) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-neutral-950">
        <p className="text-neutral-400">Chargement...</p>
      </main>
    );
  }

  if (outputDir === null) {
    return (
      <main className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-neutral-950">
        <h1 className="text-2xl font-semibold text-white">
          Bienvenue sur LiMBo
        </h1>
        <p className="text-neutral-400">
          Choisissez le dossier où seront enregistrées vos vidéos.
        </p>
        <button
          type="button"
          onClick={handleChooseFolder}
          disabled={isPicking}
          className="rounded-md bg-white px-4 py-2 font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-50"
        >
          {isPicking ? "Sélection..." : "Choisir le dossier"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </main>
    );
  }

  return <>{children}</>;
}

export default FirstRunGate;
