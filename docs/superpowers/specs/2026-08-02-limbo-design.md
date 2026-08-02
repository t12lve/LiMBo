# LiMBo — Design Spec (v1)

**Date:** 2026-08-02  
**Status:** Approved (brainstorming)  
**Usage:** Personnel uniquement (extension Chromium en mode développeur, hors Chrome Web Store)

## 1. Vision

LiMBo est une solution de détection et téléchargement de vidéos web composée de :

1. **LiMBo Desktop** — gestionnaire de téléchargements, file d’attente, moteur yt-dlp + FFmpeg (Tauri v2).
2. **LiMBo Extension** — extension Chromium Manifest V3 qui capture le contexte page (YouTube v1) et envoie les jobs au Desktop via WebSocket local.

Inspirations : VidBee (GUI), Video DownloadHelper (détection réseau — reportée en v1.1).

## 2. Décisions validées

| Sujet | Choix |
|-------|--------|
| OS v1 | Windows 11 uniquement |
| Framework Desktop | Tauri v2 + React + Tailwind |
| Extension | Manifest V3 + Vite + React (popup) |
| MVP contenu | YouTube vidéo unique (watch / Shorts) |
| Sniff m3u8/mpd/mp4 | Hors scope v1 → v1.1 |
| Communication | WebSocket local (`127.0.0.1:4567`) |
| Config utilisateur | Zéro écran Réglages ; premier lancement = choix dossier sortie puis mémorisé |
| Desktop fermé | Protocole `limbo://` + file d’attente extension jusqu’à reconnect |
| Qualité / format | Choix à chaque téléchargement dans le popup |
| Trim | Timecodes début/fin dans le popup (UX claire), avant génération |
| Moteur | yt-dlp + FFmpeg en sidecars locaux |
| Architecture | Approche Desktop-centric (extension client léger) |

## 3. Structure monorepo (`/dev` → `/prod`)

```
extension-video-downloader/
├── dev/
│   ├── apps/
│   │   ├── desktop/          # Tauri v2 + React + Tailwind
│   │   └── extension/        # MV3 + Vite + React
│   ├── packages/
│   │   └── shared/           # types WS, messages, constantes
│   ├── scripts/
│   │   ├── build-all.mjs
│   │   ├── build-extension.mjs
│   │   └── build-desktop.mjs
│   ├── package.json          # pnpm workspaces
│   ├── pnpm-workspace.yaml
│   └── turbo.json            # optionnel
├── prod/                     # livrables compilés uniquement
│   ├── extension/            # à charger dans chrome://extensions
│   ├── desktop/              # .exe / installer + ressources
│   └── bin/                  # yt-dlp.exe, ffmpeg.exe
└── docs/superpowers/specs/
```

### Règles build

- Toute modification se fait sous `/dev` uniquement.
- `/prod` est généré par les scripts ; pas d’édition manuelle.
- `pnpm --filter @limbo/extension build` → `prod/extension/`
- `pnpm --filter @limbo/desktop build` → `prod/desktop/` (+ sidecars)
- `pnpm build` depuis `dev/` enchaîne les deux.

## 4. Architecture runtime

```
[Navigateur Chromium]
  LiMBo Extension (SW + popup)
        │  WebSocket 127.0.0.1:4567
        │  (si down → limbo:// + queue locale)
        ▼
[LiMBo Desktop — Tauri]
  UI React  ←→  Backend Rust
                  ├─ WsServer
                  ├─ JobRunner (1 job actif)
                  ├─ YtDlpSidecar
                  └─ FfmpegSidecar
                        ▼
              %dossier_sortie%/… .mp4
```

### Unités (responsabilités)

| Unité | Rôle | Dépend de |
|-------|------|-----------|
| `packages/shared` | Contrats messages WS, types Job, constantes port/protocole | Rien |
| Extension popup | UX qualité + trim + envoi job | shared, WS client |
| Extension SW | Connexion WS, queue offline, badge, `limbo://` | shared |
| Desktop UI | File d’attente, progression, premier choix dossier | shared, IPC Tauri |
| `WsServer` (Rust) | Auth locale, broadcast events, commandes | JobRunner |
| `JobRunner` | États job, spawn yt-dlp/FFmpeg, parse progress | sidecars |
| Protocol handler | Enregistrement `limbo://` Windows, cold start | OS |

## 5. Communication Extension ↔ Desktop

### Transport

- WebSocket uniquement sur `127.0.0.1:4567` (pas d’écoute réseau externe).
- Messages JSON typés définis dans `packages/shared`.

### Auth zéro-config

1. Au premier lancement Desktop : génération d’un token, stocké dans la config Tauri.
2. Desktop n’accepte que les connexions `127.0.0.1` / `localhost`.
3. **Bootstrap** : si l’extension n’a pas encore de token, elle envoie `hello` sans auth ; Desktop (localhost only) répond `hello.ok` avec le token. L’extension le persiste dans `chrome.storage.local`.
4. **Ensuite** : chaque connexion envoie `auth` + token avant toute commande. Token invalide → fermeture WS.
5. Pas d’écran Réglages.

### Desktop fermé (clef en main)

1. Extension détecte WS down.
2. Intention / draft job stocké dans `chrome.storage.session` (URL, format, trim) — **jamais** de secrets dans l’URL protocol.
3. Ouverture `limbo://open` uniquement pour cold-start Desktop (pas de payload métier dans le deep link).
4. Au reconnect : `auth` → `jobs.snapshot` → flush de la file locale via `download.create`.

### Exemples de messages (contrat)

- `hello` / `hello.ok` `{ token }`
- `formats.list` `{ url }` → `formats.result` `{ formats[], title, duration, thumbnail }`
- `download.create` `{ url, formatId, trim?: { startSec, endSec } }` → `job.created`
- `job.progress` `{ id, percent, speed, eta, phase }`
- `job.done` / `job.error`
- `jobs.snapshot` (resync)
- `job.cancel` `{ id }`

## 6. Détection & téléchargement YouTube (v1)

### Extension

- Hosts : `youtube.com`, `youtu.be`, Shorts.
- Extrait l’URL canonique / video id depuis l’onglet actif.
- **Ne parse jamais** les signatures ou streams YouTube.

### Popup UX (claire)

1. Miniature + titre (via metadata Desktop / oEmbed en fallback).
2. Liste qualité/format (résultat `formats.list` via yt-dlp).
3. Trim optionnel : champs début / fin (`mm:ss`), validation (fin > début, bornes durée).
4. Bouton Télécharger → `download.create`.

### Desktop / yt-dlp

- Source de vérité : yt-dlp (`-J` / `-F` pour formats, téléchargement pour le job).
- Trim : `--download-sections "*HH:MM:SS-HH:MM:SS"` quand applicable.
- Fusion audio+vidéo : FFmpeg automatique si le format l’exige.
- Sortie : dossier choisi au premier lancement Desktop, mémorisé ensuite.

### Hors scope v1

- Playlists, chaînes, lots multi-onglets.
- Sniff `webRequest` / m3u8 / mpd / mp4 générique (v1.1, même API `download.create` avec `source: "sniff"`).

## 7. Transcodage, file d’attente & progression

### JobRunner

- Un job actif à la fois (v1).
- Phases : `queued` → `fetching_meta` → `downloading` → `merging`/`trimming` → `done` | `error`.
- Sidecars : `prod/bin/yt-dlp.exe`, `prod/bin/ffmpeg.exe`.
- Annulation : kill du process enfant + nettoyage des fichiers partiels.

### Progression

- Parse stdout yt-dlp → `job.progress`.
- Desktop UI : liste jobs, %, vitesse, ETA, phase.
- Badge extension : pourcentage du job actif (ou compteur file) via `chrome.action.setBadgeText`.

### Erreurs

- Échec yt-dlp/FFmpeg → `job.error` + message lisible Desktop + retour popup.
- Coupure WS mid-job → Desktop continue ; extension resync via `jobs.snapshot` au reconnect.

## 8. Premier lancement Desktop

1. Si aucun dossier sortie mémorisé → dialogue natif « Où enregistrer les vidéos ? ».
2. Création du dossier si besoin, persistance config.
3. Démarrage `WsServer` + enregistrement handler `limbo://` (install / premier run).
4. Aucune autre configuration demandée.

## 9. Stratégie de tests (v1)

- **Unitaires** (`packages/shared` + parseurs) : sérialisation messages WS, validation trim, parse lignes de progression yt-dlp.
- **Manuels** : vidéo YouTube longue, Short, trim début/fin, Desktop fermé puis relance via `limbo://`, choix dossier premier lancement, annulation mid-download.

## 10. Roadmap courte

| Version | Contenu |
|---------|---------|
| **v1** | Monorepo, Tauri Desktop, Extension YouTube, WS, trim, qualité popup, file + badge, `limbo://` |
| **v1.1** | Sniff réseau m3u8/mpd/mp4/webm (style Video DownloadHelper) |
| **v1.2** | Playlists / file multi-sélection ; jobs parallèles optionnels |

## 11. Non-objectifs (explicites)

- Publication Chrome Web Store.
- Support macOS/Linux en v1.
- Écran Réglages avancés.
- Parsing YouTube custom dans l’extension.
- Native Messaging Host (écarté au profit du WebSocket local).
