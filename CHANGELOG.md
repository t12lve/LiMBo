# Changelog

Toutes les dates sont en UTC+2 (Europe/Paris). Le projet suit [SemVer](https://semver.org/lang/fr/).

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

[0.2.0]: https://github.com/t12lve/LiMBo/releases/tag/v0.2.0
[0.1.0]: https://github.com/t12lve/LiMBo/releases/tag/v0.1.0
