//! Short French messages for the UI (no raw yt-dlp dumps).

/// User-facing French explanation. Pass whether Node.js was found (YouTube JS challenges).
pub fn humanize_ytdlp_error(err: &str, node_available: bool) -> String {
    let lower = err.to_ascii_lowercase();

    if lower.contains("cancelled") || lower == "cancelled" {
        return "Téléchargement annulé.".into();
    }
    if lower.contains("no output directory") {
        return "Aucun dossier de téléchargement choisi. Ouvre les réglages (⚙) et choisis un dossier."
            .into();
    }
    if lower.contains("failed to create job directory")
        || lower.contains("failed to create output directory")
    {
        return "Impossible de créer le dossier de sortie. Vérifie le chemin dans les réglages."
            .into();
    }
    if lower.contains("unsupported url") {
        return "Ce lien n’est pas une vidéo. Ouvre la page de la vidéo (pas l’accueil du site) et réessaie."
            .into();
    }
    if lower.contains("unexpected response from webpage")
        || lower.contains("unable to extract webpage video data")
        || (lower.contains("[tiktok]")
            && (lower.contains("please report") || lower.contains("webpage")))
    {
        return "TikTok bloque temporairement le téléchargement. Réessaie dans un instant ; si ça continue, utilise l’extension LiMBo sur la page de la vidéo."
            .into();
    }
    if lower.contains("dpapi")
        || lower.contains("cookie database")
        || lower.contains("could not copy")
        || lower.contains("7271")
        || lower.contains("failed to find a matching cookie")
        || (lower.contains("could not find") && lower.contains("cookie"))
    {
        return "Impossible de lire les cookies du navigateur (souvent ouvert ou verrouillé). \
                Dans ⚙ → Cookies, choisis Auto ou Aucun, ou utilise l’extension LiMBo."
            .into();
    }
    if lower.contains("nsig extraction")
        || lower.contains("signature solving failed")
        || (lower.contains("failed to decrypt") && !lower.contains("dpapi"))
    {
        return if node_available {
            "YouTube bloque le téléchargement. Mets à jour yt-dlp (node scripts/fetch-binaries.mjs --force) puis redémarre LiMBo."
                .into()
        } else {
            "YouTube bloque le téléchargement. Installe Node.js (version 20 ou plus), redémarre LiMBo, puis réessaie."
                .into()
        };
    }
    if lower.contains("sign in")
        || lower.contains("login required")
        || lower.contains("private video")
        || lower.contains("this video is private")
        || lower.contains("members-only")
        || lower.contains("confirm your age")
        || lower.contains("age-restricted")
    {
        return "Vidéo privée, réservée aux membres ou avec limite d’âge. Connecte-toi via l’extension LiMBo (cookies), puis réessaie."
            .into();
    }
    if lower.contains("video unavailable")
        || lower.contains("has been removed")
        || lower.contains("is not available")
    {
        return "Cette vidéo n’est plus disponible (supprimée ou inaccessible).".into();
    }
    if lower.contains("http error 403") || lower.contains("status code 403") {
        return "Accès refusé par le site (403). Réessaie plus tard, ou via l’extension avec cookies."
            .into();
    }
    if lower.contains("http error 429") || lower.contains("too many requests") {
        return "Trop de requêtes. Attends un moment puis réessaie.".into();
    }
    if (lower.contains("geo") && (lower.contains("restrict") || lower.contains("block")))
        || lower.contains("not available in your country")
    {
        return "Vidéo indisponible dans ton pays.".into();
    }
    if lower.contains("no usable formats")
        || lower.contains("requested format is not available")
        || lower.contains("format is not available")
    {
        return "Aucun format téléchargeable trouvé pour ce lien.".into();
    }
    if lower.contains("not found") && (lower.contains("yt-dlp") || lower.contains("ffmpeg")) {
        return "Outil manquant (yt-dlp ou ffmpeg). Relance fetch-binaries puis redémarre LiMBo."
            .into();
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return "Délai dépassé. Vérifie ta connexion et réessaie.".into();
    }
    if lower.contains("ssl") || lower.contains("certificate") {
        return "Erreur de connexion sécurisée. Vérifie l’heure Windows et ta connexion.".into();
    }
    if lower.contains("no space") || lower.contains("os error 112") {
        return "Plus assez d’espace disque pour enregistrer le fichier.".into();
    }
    if lower.contains("url must be") || lower.contains("must be an http") {
        return "Lien invalide. Colle une adresse http ou https complète.".into();
    }
    if lower.contains("trim:") {
        return "Plage de découpe invalide (début ≥ 0 et fin après le début).".into();
    }
    if lower.contains("failed to spawn") || lower.contains("failed to wait") {
        return "Impossible de lancer yt-dlp. Vérifie l’installation et redémarre LiMBo.".into();
    }
    if lower.contains("process handle went missing") {
        return "Le téléchargement s’est interrompu de façon inattendue.".into();
    }
    if lower.contains("internal error") {
        return "Erreur interne. Réessaie dans un instant.".into();
    }

    // Already a short French sentence from our own code — keep it.
    let looks_english_tech = lower.contains("error:")
        || lower.contains("yt-dlp exited")
        || lower.contains("traceback")
        || lower.contains("errno");
    if !looks_english_tech && err.chars().count() <= 200 {
        return err.trim().to_string();
    }

    "Échec du téléchargement. Vérifie le lien (page vidéo complète) et réessaie.".into()
}

/// Cookie DB lock / DPAPI / copy failures — safe to retry without `--cookies-from-browser`.
pub fn is_recoverable_cookie_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("dpapi")
        || lower.contains("could not copy")
        || lower.contains("cookie database")
        || lower.contains("7271")
        || lower.contains("failed to find a matching cookie")
        || lower.contains("could not find chrome cookies")
        || lower.contains("could not find firefox cookies")
        || lower.contains("could not find edge cookies")
        || lower.contains("could not find vivaldi cookies")
        || lower.contains("could not find brave cookies")
}

/// YouTube player JS / nsig failures — may succeed with an alternate player client.
pub fn is_youtube_decrypt_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    if lower.contains("dpapi") {
        return false;
    }
    lower.contains("nsig extraction")
        || lower.contains("signature solving failed")
        || (lower.contains("failed to decrypt") && !lower.contains("cookie"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiktok_unexpected_response_is_clear() {
        let err = "yt-dlp exited with exit code: 1: ERROR: [TikTok] 7673272316582710560: Unexpected response from webpage request; please report this issue";
        let msg = humanize_ytdlp_error(err, true);
        assert!(msg.contains("TikTok"));
        assert!(!msg.contains("yt-dlp exited"));
        assert!(!msg.contains("please report"));
    }

    #[test]
    fn unsupported_url_is_clear() {
        let msg = humanize_ytdlp_error("ERROR: Unsupported URL: https://www.tiktok.com/", true);
        assert!(msg.contains("pas une vidéo"));
        assert!(!msg.contains("Unsupported"));
    }

    #[test]
    fn dpapi_is_cookie_not_youtube() {
        let err = "ERROR: Failed to decrypt with DPAPI. See https://github.com/yt-dlp/yt-dlp/issues/10927";
        assert!(is_recoverable_cookie_error(err));
        assert!(!is_youtube_decrypt_error(err));
        let msg = humanize_ytdlp_error(err, true);
        assert!(msg.contains("cookies"));
        assert!(!msg.contains("YouTube bloque"));
        assert!(!msg.contains("DPAPI"));
    }

    #[test]
    fn nsig_mentions_node_when_missing() {
        let err = "ERROR: nsig extraction failed: Some error";
        assert!(is_youtube_decrypt_error(err));
        let msg = humanize_ytdlp_error(err, false);
        assert!(msg.contains("Node.js"));
    }
}
