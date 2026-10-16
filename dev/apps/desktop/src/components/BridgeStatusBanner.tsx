import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/// Mirrors the payload of `ws_server::WS_STATUS_EVENT` on the Rust side.
type WsStatus = { available: boolean; error?: string | null };

/**
 * Shows a banner when the local WebSocket bridge (127.0.0.1:4567) could not be started —
 * typically because another process already holds the port. Without this, the app looks fine
 * but the browser extension can never connect, with no explanation.
 *
 * The event is emitted once at startup (success or definitive failure); a healthy bridge keeps
 * this component rendering nothing.
 */
export default function BridgeStatusBanner() {
  const [status, setStatus] = useState<WsStatus | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<WsStatus>("ws-status", (event) => {
      setStatus(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  if (!status || status.available) {
    return null;
  }

  return (
    <div
      role="alert"
      className="relative z-10 shrink-0 border-b border-[#8a1830] bg-[#3a0d18] px-3 py-1.5 text-[11px] leading-snug text-[#f0c9d2]"
    >
      ⚠ Serveur local indisponible (port 4567) : l’extension ne pourra pas se connecter.
      {status.error ? ` — ${status.error}` : ""}
    </div>
  );
}
