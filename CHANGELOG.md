# Changelog

Toutes les dates sont en UTC+2 (Europe/Paris). Le projet suit [SemVer](https://semver.org/lang/fr/).

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

[0.3.1]: https://github.com/t12lve/LiMBo/releases/tag/v0.3.1
[0.3.0]: https://github.com/t12lve/LiMBo/releases/tag/v0.3.0
[0.2.0]: https://github.com/t12lve/LiMBo/releases/tag/v0.2.0
[0.1.0]: https://github.com/t12lve/LiMBo/releases/tag/v0.1.0
