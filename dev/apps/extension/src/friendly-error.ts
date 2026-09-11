/** Map technical bridge / network errors to short French copy for the popup. */
export function friendlyBridgeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes("websocket") ||
    lower.includes("timed out") ||
    lower.includes("connection closed") ||
    lower.includes("desktop offline") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("err_connection")
  ) {
    return "LiMBo Desktop n’est pas lancé ou ne répond pas. Ouvre l’app LiMBo (icône près de l’horloge), puis réessaie.";
  }

  if (lower.includes("auth failed") || lower.includes("unauthorized")) {
    return "Connexion refusée par LiMBo Desktop. Redémarre l’app Desktop et l’extension, puis réessaie.";
  }

  // Desktop already sends French yt-dlp messages — keep if it looks user-facing.
  if (!lower.includes("connectandauth") && !lower.includes("error:") && raw.length <= 220) {
    return raw;
  }

  return "Impossible de joindre LiMBo Desktop. Vérifie que l’application est ouverte, puis réessaie.";
}
