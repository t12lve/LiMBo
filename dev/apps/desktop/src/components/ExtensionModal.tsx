import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ExtensionPaths {
  chromium_dir: string;
  firefox_dir: string;
  firefox_xpi: string;
  premiere_dir: string;
  guide_path: string;
}

interface ExtensionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ExtensionModal({ isOpen, onClose }: ExtensionModalProps) {
  const [activeTab, setActiveTab] = useState<"chromium" | "firefox" | "premiere">("chromium");
  const [paths, setPaths] = useState<ExtensionPaths | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      invoke<ExtensionPaths>("get_extension_paths")
        .then(setPaths)
        .catch((e) => setError(String(e)));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleOpenFolder = async (browser: string) => {
    try {
      await invoke("open_extension_dir", { browser });
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpenGuide = async () => {
    try {
      await invoke("open_extension_guide");
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative flex max-h-[92vh] w-full max-w-[420px] flex-col rounded-xl border border-[var(--limbo-border)] bg-[var(--limbo-panel)] shadow-2xl text-[var(--limbo-ivory)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--limbo-border)] px-4 py-3 bg-black/30">
          <div className="flex items-center gap-2">
            <span className="text-base">🧩</span>
            <h2 className="text-sm font-bold tracking-wide text-[var(--limbo-gold)]">
              Extensions LiMBo
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--limbo-muted)] hover:text-[var(--limbo-gold)] transition text-xs font-semibold px-2 py-1 rounded cursor-pointer"
          >
            Fermer ✕
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-[var(--limbo-border)] bg-black/20 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("chromium")}
            className={`flex-1 py-2 font-semibold text-center transition border-b-2 cursor-pointer ${
              activeTab === "chromium"
                ? "border-[var(--limbo-gold)] text-[var(--limbo-gold)] bg-black/30"
                : "border-transparent text-[var(--limbo-muted)] hover:text-[var(--limbo-ivory)]"
            }`}
          >
            🌐 Chrome / Edge
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("firefox")}
            className={`flex-1 py-2 font-semibold text-center transition border-b-2 cursor-pointer ${
              activeTab === "firefox"
                ? "border-[#ff7139] text-[#ff8c5a] bg-black/30"
                : "border-transparent text-[var(--limbo-muted)] hover:text-[var(--limbo-ivory)]"
            }`}
          >
            🦊 Firefox
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("premiere")}
            className={`flex-1 py-2 font-semibold text-center transition border-b-2 cursor-pointer ${
              activeTab === "premiere"
                ? "border-[#9999ff] text-[#b3b3ff] bg-black/30"
                : "border-transparent text-[var(--limbo-muted)] hover:text-[var(--limbo-ivory)]"
            }`}
          >
            🎬 Premiere Pro
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 text-xs space-y-3">
          {error && (
            <div className="rounded bg-red-900/40 border border-red-700/60 p-2 text-red-300 text-[11px]">
              {error}
            </div>
          )}

          {activeTab === "chromium" && (
            <div className="space-y-3">
              <p className="text-[var(--limbo-muted)]">
                Téléchargez en 1 clic sur Chrome, Edge, Brave, Opera ou Vivaldi.
              </p>

              {/* Path box */}
              <div className="rounded border border-[var(--limbo-border)] bg-black/40 p-2.5 space-y-2">
                <div className="text-[10px] uppercase font-bold text-[var(--limbo-muted)] tracking-wider">
                  Dossier de l'extension
                </div>
                <div className="font-mono text-[11px] text-[var(--limbo-gold)] break-all select-all">
                  {paths?.chromium_dir || "Dossier extension en cours de détection..."}
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleOpenFolder("chromium")}
                    className="flex-1 rounded bg-[var(--limbo-border)] hover:bg-[var(--limbo-gold)] hover:text-black transition py-1 px-2 font-semibold text-[11px] cursor-pointer"
                  >
                    📁 Ouvrir le dossier
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      paths?.chromium_dir && copyToClipboard(paths.chromium_dir, "cr")
                    }
                    className="flex-1 rounded border border-[var(--limbo-border)] hover:border-[var(--limbo-gold)] transition py-1 px-2 font-semibold text-[11px] cursor-pointer"
                  >
                    {copied === "cr" ? "✓ Copié !" : "📋 Copier chemin"}
                  </button>
                </div>
              </div>

              {/* Instructions steps */}
              <div className="space-y-2">
                <div className="font-semibold text-[var(--limbo-ivory)]">Instructions rapides :</div>
                <ol className="list-decimal list-inside space-y-1.5 text-[var(--limbo-muted)] text-[11px]">
                  <li>
                    Ouvrez <code className="text-[var(--limbo-gold)] font-mono">chrome://extensions</code>
                  </li>
                  <li>
                    Activez le <strong className="text-[var(--limbo-ivory)]">Mode développeur</strong> en haut à droite
                  </li>
                  <li>
                    Cliquez sur <strong className="text-[var(--limbo-ivory)]">Charger l'extension non empaquetée</strong> et sélectionnez le dossier ouvert
                  </li>
                </ol>
              </div>
            </div>
          )}

          {activeTab === "firefox" && (
            <div className="space-y-3">
              <p className="text-[var(--limbo-muted)]">
                Téléchargez en 1 clic directement dans Mozilla Firefox.
              </p>

              {/* Path box */}
              <div className="rounded border border-[var(--limbo-border)] bg-black/40 p-2.5 space-y-2">
                <div className="text-[10px] uppercase font-bold text-[var(--limbo-muted)] tracking-wider">
                  Dossier add-on Firefox (.xpi)
                </div>
                <div className="font-mono text-[11px] text-[#ff8c5a] break-all select-all">
                  {paths?.firefox_dir || "Dossier extension en cours de détection..."}
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleOpenFolder("firefox")}
                    className="flex-1 rounded bg-[var(--limbo-border)] hover:bg-[#ff7139] hover:text-white transition py-1 px-2 font-semibold text-[11px] cursor-pointer"
                  >
                    📁 Ouvrir le dossier
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      paths?.firefox_dir && copyToClipboard(paths.firefox_dir, "ff")
                    }
                    className="flex-1 rounded border border-[var(--limbo-border)] hover:border-[#ff7139] transition py-1 px-2 font-semibold text-[11px] cursor-pointer"
                  >
                    {copied === "ff" ? "✓ Copié !" : "📋 Copier chemin"}
                  </button>
                </div>
              </div>

              {/* Instructions steps */}
              <div className="space-y-2">
                <div className="font-semibold text-[var(--limbo-ivory)]">Instructions rapides :</div>
                <ol className="list-decimal list-inside space-y-1.5 text-[var(--limbo-muted)] text-[11px]">
                  <li>
                    Ouvrez <code className="text-[#ff8c5a] font-mono">about:debugging#/runtime/this-firefox</code>
                  </li>
                  <li>
                    Cliquez sur <strong className="text-[var(--limbo-ivory)]">Charger un module temporaire...</strong>
                  </li>
                  <li>
                    Sélectionnez <code className="text-[var(--limbo-ivory)] font-mono">manifest.json</code> ou <code className="text-[#ff8c5a] font-mono">LiMBo-firefox.xpi</code>
                  </li>
                </ol>
              </div>
            </div>
          )}

          {activeTab === "premiere" && (
            <div className="space-y-3">
              <div className="rounded bg-emerald-950/40 border border-emerald-600/40 p-2.5 text-emerald-300 text-[11px] flex items-center gap-2">
                <span className="text-base">✓</span>
                <span>Configurée et activée automatiquement par l'installateur !</span>
              </div>

              <p className="text-[var(--limbo-muted)]">
                Panneau Adobe CEP connecté en direct au Desktop pour importer les vidéos directement dans votre projet ou sur la timeline.
              </p>

              {/* Path box */}
              <div className="rounded border border-[var(--limbo-border)] bg-black/40 p-2.5 space-y-2">
                <div className="text-[10px] uppercase font-bold text-[var(--limbo-muted)] tracking-wider">
                  Emplacement Adobe CEP
                </div>
                <div className="font-mono text-[11px] text-[#b3b3ff] break-all select-all">
                  {paths?.premiere_dir || "%APPDATA%\\Adobe\\CEP\\extensions\\LiMBO-premiere"}
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleOpenFolder("premiere")}
                    className="flex-1 rounded bg-[var(--limbo-border)] hover:bg-[#7b7bff] hover:text-white transition py-1 px-2 font-semibold text-[11px] cursor-pointer"
                  >
                    📁 Ouvrir le dossier CEP
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      paths?.premiere_dir && copyToClipboard(paths.premiere_dir, "pr")
                    }
                    className="flex-1 rounded border border-[var(--limbo-border)] hover:border-[#9999ff] transition py-1 px-2 font-semibold text-[11px] cursor-pointer"
                  >
                    {copied === "pr" ? "✓ Copié !" : "📋 Copier chemin"}
                  </button>
                </div>
              </div>

              {/* Instructions steps */}
              <div className="space-y-2">
                <div className="font-semibold text-[var(--limbo-ivory)]">Comment l'ouvrir dans Premiere :</div>
                <ol className="list-decimal list-inside space-y-1.5 text-[var(--limbo-muted)] text-[11px]">
                  <li>
                    Lancez ou redémarrez <strong className="text-[var(--limbo-ivory)]">Adobe Premiere Pro</strong>
                  </li>
                  <li>
                    Ouvrez un projet vidéo (nouveau ou existant)
                  </li>
                  <li>
                    Dans le menu supérieur, cliquez sur <strong className="text-[var(--limbo-gold)]">Fenêtre → Extensions → LiMBO-premiere</strong>
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-[var(--limbo-border)] p-3 bg-black/40 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleOpenGuide}
            className="w-full rounded bg-[var(--limbo-gold)] hover:bg-[var(--limbo-gold-hover)] text-black font-bold py-2 px-3 text-xs transition cursor-pointer"
          >
            📖 Ouvrir le guide visuel pas-à-pas
          </button>
        </div>
      </div>
    </div>
  );
}

