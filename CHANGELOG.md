# Changelog

Toutes les dates sont en UTC+2 (Europe/Paris). Le projet suit [SemVer](https://semver.org/lang/fr/).

## [0.3.4] — 2026-10-16

### Sécurité
- **Serveur WebSocket durci** : plafond de connexions simultanées, taille maximale des frames/messages, timeout de handshake, et bind avec retry + backoff. Si le port 4567 reste indisponible, l'app émet un événement `ws-status` et affiche un bandeau d'avertissement au lieu d'échouer silencieusement.
- **Fermeture propre** : quitter LiMBo (tray « Quitter ») tue désormais l'arbre de process yt-dlp/ffmpeg en cours, au lieu de le laisser orphelin en gardant le fichier partiel verrouillé.
- **Plus d'injection d'argument** : le guide d'installation s'ouvre via `tauri-plugin-opener` et non plus `cmd /c start`.
- **Modèle de menace documenté** : `hello.ok` renvoie le token à tout client local — ce n'est donc *pas* une frontière d'accès ; la vraie barrière est le contrôle d'`Origin` (les pages web sont rejetées) plus le bind loopback.

### Corrigé
- **Sélection stricte de la piste audio originale (anti-doublage / anti-traduction)** : les formats curatés et téléchargés sélectionnent désormais toujours la piste audio originale (`format_note` original, `xtags` original, `language_preference > 0`) et excluent les flux de doublage/traduction automatique (`dub`, `doublage`, `translated`, `description audio`).
- **Aucune console Windows au lancement** : sous-système GUI inconditionnel (`#![windows_subsystem = "windows"]` en debug et release) et détachement explicite via `FreeConsole()`, pour qu'aucune fenêtre de terminal (`ws_server`, …) n'apparaisse ou ne reste ouverte.
- **Retry YouTube automatique** : si un téléchargement échoue (déchiffrement / signature), un second essai est tenté avec `--extractor-args youtube:player_client=android,tv`, après nettoyage des fichiers partiels — ignoré si la tâche est annulée ou si le client `android` était déjà utilisé.
- **Démarrage automatique resynchronisé** : au lancement, la valeur `Run` du registre est (re)créée si l'option est active et absente, et supprimée sinon.
- **Erreurs de cookies verrouillés** : détection élargie (messages FR « impossible de lire les cookies », « cookie(s) verrouillé(s) ») → bascule automatique vers un essai sans cookies.
- **Client WS bloqué sur un état obsolète** : sur `Lagged` (client lent — service worker MV3 suspendu), le serveur renvoie un `jobs.snapshot` au lieu de perdre silencieusement `job.done`.
- **Message d'erreur de timeout** du `ws-client` : l'événement `close` court-circuitait le rejet et masquait « timed out ».
- `resolve_node_path()` mis en cache (`OnceLock`) — il était recalculé deux fois par invocation yt-dlp.
- `pnpm --filter @limbo/shared build` (typecheck), cassé par l'inclusion des fichiers de test.

### Ajouté
- **Contrat TS généré depuis Rust** (`ts-rs`) : `JobPhase`, `JobSnapshot`, `TrimRange` et `VideoFormat` ne sont plus dupliqués à la main ; un contrôle CI échoue si les bindings commités sont périmés. Régénération : `pnpm --filter @limbo/desktop gen:types`.
- **Tests extension** : vitest + 25 tests (`queue`, `export-cookies`, `ws-client`). Le fichier `popup-handlers.test.ts` existant n'était **jamais exécuté** (aucun script `test`).
- **CI GitHub Actions** (`windows-latest`) : typecheck, `pnpm test`, `clippy -D warnings`, `cargo test`, et contrôle de dérive des bindings.

### Notes techniques
- `clippy -D warnings` est désormais une barrière CI : les lints pré-existants sont explicitement reconnus au niveau du crate (`lib.rs`), donc tout *nouveau* lint échoue.
- `cargo fmt --check` n'est **pas** encore imposé (l'arbre existant n'est pas `rustfmt`-clean) — à activer après un reformat dédié.

### Modifié
- Version alignée **0.3.4** (Desktop, extension Chromium/Firefox, Premiere CEP, shared).

## [0.3.3] — 2026-10-11

### Ajouté
- **Lancement automatique Windows réduit dans la barre des tâches** : lors du lancement automatique au démarrage de Windows (`--minimized`), la fenêtre démarre directement réduite dans la barre des tâches (`SW_SHOWMINNOACTIVE` natif Win32, sans affichage intempestif sur le bureau ni vol de focus, fenêtre initialisée en arrière-plan `visible: false`).
- **Configuration automatique du démarrage dans l'installeur** : l'installeur Windows configure désormais par défaut la clé de registre `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` avec `--minimized`, et le désinstalleur assure son nettoyage complet.
- Version alignée **0.3.3** (Desktop, extension Chromium/Firefox, Premiere CEP, shared).

## [0.3.2] — 2026-10-11

### Ajouté
- **Conversion automatique en MP3 pour les téléchargements audio** : les téléchargements audio seuls (« Juste le son » et mode son seul du batch) sont désormais automatiquement convertis en `.mp3` haute qualité (`-x --audio-format mp3 --audio-quality 0` via yt-dlp / ffmpeg, avec conversion ffmpeg de secours).
- Affichage explicite du format `.mp3` dans l'extension et l'application Desktop.
- Version alignée **0.3.2** (Desktop, extension Chromium/Firefox, Premiere CEP, shared).

## [0.3.1] — 2026-09-22

### Corrigé
- **Suppression des craquements audio au lancement** : désactivation de l'accélération matérielle GPU (`--disable-gpu`, `--disable-gpu-compositing`) dans WebView2 pour éliminer les pics de latence DPC (`nvlddmkm.sys`) sur les cartes NVIDIA (RTX 5090).
- **Isolation audio complète de WebView2** : désactivation des flux audio Chromium (`--disable-audio-output`, `--mute-audio`) et du sandbox audio pour éviter les conflits d'horloge / réinitialisations WASAPI sur les interfaces audio USB à faible latence (TC-Helicon GoXLR, DACs externes).
- **Notification sonore native** : remplacement de l'AudioContext Web Audio par un appel système natif `MessageBeep(0x40)`, sans allocation de flux WASAPI persistant.
- Version alignée **0.3.1** (Desktop, extension Chromium/Firefox, Premiere CEP, shared).

## [0.3.0] — 2026-09-12

### Ajouté
- **Détection automatique d'Adobe Premiere Pro** : l'installeur NSIS sonde le registre (`HKCU`/`HKLM`) et `%APPDATA%` pour Premiere Pro et Premiere Pro (Beta).
- **Intégration CEP automatique** : si Premiere est détecté, l'installeur propose de déployer le panneau CEP dans `%APPDATA%\Adobe\CEP\extensions\LiMBO-premiere` et active automatiquement `PlayerDebugMode` (CSXS.9 à CSXS.16).
- **Extension Firefox officielle** : compilation MV3 dédiée et packaging automatique en `.xpi` (`LiMBo-firefox.xpi`).
- **Guide d'onboarding visuel interactif** : page HTML d'instructions intégrée (`install-instructions.html`) proposée à la fin de l'installation pour activer l'extension dans Chrome/Edge ou Firefox.
- **Installeur Windows tout-en-un (`LiMBo-Installer.exe`)** : embarque l'application desktop, `yt-dlp`, `ffmpeg`, le panneau CEP Premiere, et les extensions de navigateur.
- **Messages d'erreur utilisateur enrichis** : explication claire et conseils d'action en cas de blocage YouTube (Node.js requis, défi bot, etc.) ou d'accès fichier.
- **Modal d'aide navigateur dans le Desktop** : bouton dédié dans l'interface pour guider l'utilisateur sur l'installation de l'extension.

### Modifié
- Version alignée **0.3.0** (Desktop, extension Chromium/Firefox, Premiere CEP, shared).

## [0.2.0] — 2026-08-04

### Ajouté
- Pack Chrome officiel (`.crx` + `.zip`) via `pack-chrome-extension.mjs` / `pnpm --filter @limbo/extension pack:chrome`
- Page GitHub Pages Darkchylde : https://t12lve.github.io/LiMBo/
- Retry automatique yt-dlp : cookies navigateur verrouillés (`Could not copy`) → nouvel essai sans cookies
- Fallback YouTube `player_client=android,tv` en cas d’échec de déchiffrement (`Failed to decrypt`)
- Détection Node.js élargie (PATH GUI, nvm, fnm, `where.exe`) pour les défis JS YouTube
- Trim : `--force-keyframes-at-cuts` + timestamps au millième (évite le début muet)
- Messages d’erreur Desktop plus lisibles (plus de troncature agressive dans la liste)

### Modifié
- Cookies batch Desktop par défaut : **Aucun** (évite le verrou Chrome/Edge ouvert)
- Extension MV3 : `description`, `minimum_chrome_version` 116, permissions `ws://127.0.0.1:4567`
- Version alignée **0.2.0** (Desktop, extension, Premiere, shared)

### Corrigé
- Collage d’URL dans le Desktop qui échouait (cookies / decrypt YouTube)
- Extraits trimés sans son sur les premières secondes

## [0.1.0] — 2026-08-04

### Ajouté
- App Desktop Tauri (Darkchylde) : batch d’URLs, file FIFO, réglages, tray, démarrage Windows
- Extension Chromium MV3 : formats, trim, cookies Netscape, badge / file offline
- Panneau CEP **LiMBO-premiere** : suivi des jobs, import timeline, création de séquence si absente
- Contrat WebSocket local `ws://127.0.0.1:4567` (`@limbo/shared`)
- Chemins de sortie `{Plateforme} {titre} [{id}]/{titre}_{date}_{mode}.ext`
- README produit complet
- Première release GitHub (installeurs, portable, extension, Premiere)

[0.3.4]: https://github.com/t12lve/LiMBo/releases/tag/v0.3.4
[0.3.3]: https://github.com/t12lve/LiMBo/releases/tag/v0.3.3
[0.3.2]: https://github.com/t12lve/LiMBo/releases/tag/v0.3.2
[0.3.1]: https://github.com/t12lve/LiMBo/releases/tag/v0.3.1
[0.3.0]: https://github.com/t12lve/LiMBo/releases/tag/v0.3.0
[0.2.0]: https://github.com/t12lve/LiMBo/releases/tag/v0.2.0
[0.1.0]: https://github.com/t12lve/LiMBo/releases/tag/v0.1.0
