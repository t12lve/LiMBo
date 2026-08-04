# LiMBo

Téléchargeur vidéo local pour **Windows 11** : une app Desktop (cerveau), une extension Chromium (client léger), et un panneau Adobe Premiere Pro (import timeline).

Tout passe par un WebSocket local `ws://127.0.0.1:4567`. Les téléchargements sont exécutés par **yt-dlp** (+ **FFmpeg**) côté Desktop — jamais dans le navigateur ni dans Premiere.

```
Extension Chrome / Edge  ─┐
                          ├──►  ws://127.0.0.1:4567  ──►  LiMBo Desktop (Tauri v2)
LiMBO-premiere (CEP)     ─┘              │
                                         ├─ file de jobs (1 actif, FIFO)
                                         ├─ yt-dlp.exe + ffmpeg.exe
                                         └─ fichiers sous le dossier choisi
```

| Composant | Rôle |
|-----------|------|
| **Desktop** (`@limbo/desktop`) | Serveur WS, file de jobs, yt-dlp, prefs, tray, batch d’URLs |
| **Extension** (`@limbo/extension`) | Formats + trim + téléchargement depuis une page vidéo ; export cookies Netscape |
| **LiMBO-premiere** (`@limbo/premiere`) | Suivi des jobs + import dans le projet / timeline Premiere |
| **Shared** (`@limbo/shared`) | Types, messages WS, constantes (`WS_PORT = 4567`) |

---

## Prérequis

- Windows 11 (scripts d’install, startup, tray, power, CEP : Windows only)
- [Node.js](https://nodejs.org/) **≥ 20** (requis aussi par yt-dlp pour YouTube : `--js-runtimes`)
- [pnpm](https://pnpm.io/) **9.15** (voir `packageManager` dans `dev/package.json`)
- Rust + toolchain Tauri (pour builder le Desktop)
- Chrome / Edge / Brave (extension MV3)
- Adobe Premiere Pro **14+** (panneau CEP, optionnel)

---

## Structure du dépôt

```
extension video downloader/
├── dev/                          # sources (monorepo pnpm)
│   ├── apps/
│   │   ├── desktop/              # @limbo/desktop — Tauri v2 + React
│   │   ├── extension/            # @limbo/extension — Chromium MV3
│   │   └── premiere/             # @limbo/premiere — CEP « LiMBO-premiere »
│   ├── packages/shared/          # @limbo/shared — contrat WS / types
│   └── scripts/                  # build-*, fetch-binaries, install-premiere
├── prod/                         # livrables (régénérés, souvent gitignorés)
│   ├── bin/                      # yt-dlp.exe, ffmpeg.exe
│   ├── extension/                # charger dans chrome://extensions
│   ├── desktop/                  # limbo-desktop.exe (+ sidecars + bundle/)
│   └── premiere/                 # copie CEP + INSTALL.txt
└── docs/superpowers/             # specs / plans
```

Code dans **`dev/`** · livrables dans **`prod/`**.

Config runtime Desktop : `%APPDATA%\LiMBo\config.json` (token, dossier, prefs).

---

## Build

Depuis **`dev/`** :

```bash
cd dev
pnpm install
pnpm build
```

`pnpm build` (`scripts/build-all.mjs`) enchaîne :

1. `fetch-binaries.mjs` — télécharge yt-dlp / ffmpeg dans `prod/bin/` s’ils manquent
2. `build-extension.mjs` → `prod/extension/`
3. `build-desktop.mjs` → `prod/desktop/` (exe + sidecars + installers `bundle/`)
4. `build-premiere.mjs` → `prod/premiere/`

### Builds ciblés

| Cible | Commande |
|-------|----------|
| Extension | `pnpm --filter @limbo/extension build:prod` ou `node scripts/build-extension.mjs` |
| Desktop | `pnpm --filter @limbo/desktop build:prod` ou `node scripts/build-desktop.mjs` |
| Premiere | `pnpm --filter @limbo/premiere build` ou `node scripts/build-premiere.mjs` |
| Sidecars seuls | `node scripts/fetch-binaries.mjs` (`--force` pour forcer) |
| Tests | `pnpm test` |

### Dev

| Cible | Commande |
|-------|----------|
| Desktop | `pnpm --filter @limbo/desktop tauri` / `dev` (Vite `localhost:1420`) |
| Extension | `pnpm --filter @limbo/extension dev` |

Les artefacts Cargo Desktop sont redirigés hors Dropbox vers  
`%LOCALAPPDATA%\limbo-desktop-cargo-target` (évite les verrous EPERM).

---

## Installation & lancement

### 1. Desktop

- Portable : `prod/desktop/limbo-desktop.exe` (yt-dlp / ffmpeg à côté)
- Ou installateur : `prod/desktop/bundle/` (`.msi` / `.exe` NSIS)

Au **premier lancement**, choisir le dossier de téléchargement (écran d’accueil).  
Sans dossier configuré, aucun téléchargement ne démarre.

Par défaut, LiMBo s’inscrit au **démarrage Windows** (HKCU `Run\LiMBo`) avec `--minimized` (tray).

### 2. Extension Chrome / Edge

1. `chrome://extensions` (ou `edge://extensions`)
2. Mode développeur
3. « Charger l’extension non empaquetée » → dossier **`prod/extension`**

### 3. LiMBO-premiere (Premiere Pro)

1. Desktop doit tourner (`ws://127.0.0.1:4567`)
2. Depuis `dev/` :

```bash
pnpm --filter @limbo/premiere install:cep
```

   Copie vers `%APPDATA%\Adobe\CEP\extensions\LiMBO-premiere`  
   et active `PlayerDebugMode=1` pour CSXS.9–12 (extensions non signées).

3. Redémarrer Premiere Pro
4. **Fenêtre → Extensions → LiMBO-premiere**

---

## Architecture technique

### WebSocket (`127.0.0.1:4567`)

Bind **loopback uniquement** (jamais `0.0.0.0`).

**Handshake**

1. Client → `{ "type": "hello" }`
2. Serveur → `{ "type": "hello.ok", "token": "<uuid>" }`
3. Client → `{ "type": "auth", "token": "…" }`
4. OK → `auth.ok` puis `prefs.snapshot` + `jobs.snapshot`  
   Échec → `auth.fail` + fermeture

**Client → serveur**

| Type | Champs |
|------|--------|
| `formats.list` | `url`, `cookies?` (jar Netscape) |
| `download.create` | `url`, `formatId`, `trim?` `{startSec,endSec}`, `cookies?`, `hasAudio?`, `hasVideo?` |
| `job.cancel` | `id` |

**Serveur → client**

| Type | Contenu |
|------|---------|
| `formats.result` | `formats[]`, `title`, `duration`, `thumbnail` |
| `formats.error` | `error` |
| `job.created` / `job.done` / `job.error` | `job` (`JobSnapshot`) |
| `job.progress` | `id`, `percent`, `speed`, `eta`, `phase` (payload plat) |
| `jobs.snapshot` | `jobs[]` |
| `prefs.snapshot` | `defaultQuality`: `"best_image"` \| `"best_sound"` |

**Phases d’un job** : `queued` → `fetching_meta` → `downloading` → (`merging` \| `trimming`) → `done` \| `error`

**`JobSnapshot`** : `id`, `url`, `title`, `phase`, `percent`, `speed`, `eta`, `error?`, `outputPath?`, `mode?`

**Origin autorisés** (sinon HTTP 403 avant le handshake) :

- Origin absent (clients non-navigateur)
- `chrome-extension://…`
- `http://127.0.0.1…` / `http://localhost…`
- `null` / `file://…` (panneaux CEP Premiere)

Rejeté : origines `https://…` (y compris loopback), `moz-extension://…`, etc.

### JobRunner

- **Un seul job actif** ; les suivants en file FIFO
- Cancel : kill de l’arbre de processus (`taskkill /T /F`) + nettoyage `.part` / `.ytdl` / `.part-Frag`
- Cookies : fichier Netscape temporaire (extension) **prioritaire**, sinon `--cookies-from-browser` (batch Desktop)
- Trim : `--download-sections *HH:MM:SS-HH:MM:SS`
- Formats curatés côté Desktop : ids préfixés `limbo:{combo|son|video}:{id_yt_dlp}` pour un mode fichier fiable

### Chemins de sortie

Sous le dossier configuré (`output_dir`) :

| Élément | Forme |
|---------|--------|
| Sous-dossier | `{Plateforme} {titre≤60} [{id}]` |
| Fichier | `{titre≤80}_{YYYYMMDD-HHMMSS}_{mode}.{ext}` |
| Collision | suffixe `_{4 premiers chars du job id}` |

**Plateformes** normalisées : Instagram, Youtube, TikTok, Twitter, Vimeo, Reddit (sinon capitalisé / `Video`).

**Modes** : `combo` (vidéo+son) · `son` · `video` · `combo_trimmed` / `son_trimmed` / `video_trimmed`

Template yt-dlp : `{job_dir}/{stem}.%(ext)s`

---

## App Desktop (`@limbo/desktop`)

Fenêtre fixe **440×680**, non redimensionnable, sans décorations OS (UI custom « Darkchylde »).

### Premier lancement

Si `output_dir` est vide → écran « Bienvenue » / choix du dossier obligatoire.

### Interface

- Header : logo Stepping Disc + **LIMBO**, compteur `file · N`, ⚙ Réglages, contrôles fenêtre
- Corps : collage d’URLs (batch) + liste des jobs
- Footer : `COUR DE LIMBO`

### Contrôles fenêtre & tray

| Action | Comportement |
|--------|----------------|
| Réduire | barre des tâches |
| ✕ / fermer | masque vers la **zone de notification** (tray), ne quitte pas |
| Tray · Afficher LiMBo | restaure / focus |
| Tray · Quitter | quitte vraiment (`quit_app`) |
| Clic tray | focus fenêtre |

Tooltip tray : `LiMBo`.

### Réglages (tiroir ⚙)

| Réglage | Clé config | Valeurs |
|---------|------------|---------|
| Dossier de téléchargement | `output_dir` | chemin absolu |
| Type / qualité par défaut | `default_quality` | `best_image` \| `best_sound` |
| Cookies (batch Desktop) | `cookies_browser` | `chrome` \| `edge` \| `brave` \| `firefox` \| `none` |
| Son à la fin de la file | `sound_on_finish` | bool (défaut `true`) — bip ~880 Hz |
| Après la file | `post_queue_action` | `none` \| `sleep` \| `shutdown` \| `force_shutdown` |
| Lancer au démarrage Windows | `launch_at_startup` | bool (défaut `true`) |

Aussi stocké : `token` (UUID d’auth WS, non éditable dans l’UI).

**Post-file** :

- `sleep` → mise en veille (`SetSuspendState`)
- `shutdown` → `shutdown /s /t 60`
- `force_shutdown` → `shutdown /s /f /t 0`

### Batch d’URLs

- Coller une ou plusieurs URLs `http(s)` (séparées espaces / retours)
- Cases à cocher par ligne
- Par item : résolution `best` / `2160` / `1440` / `1080` / `720` / `480`, conteneur `mp4` / `webm` / `best`, options **Son** / **Son seulement**
- Selecteurs yt-dlp dérivés (`ba/b`, `bv*`, `bv*[height≤N]+ba/b`, …)
- Si `default_quality === best_sound`, « son seulement » est pré-coché

### Liste des jobs

- Titre (ou URL), barre de progression, phase en français, %, vitesse, ETA
- **Annuler** tant que le job est actif (`queued` … `trimming`)
- Events Tauri miroir : `job-updated`, `queue-idle`

### Protocole `limbo://`

Schéma enregistré `limbo` → `limbo://open` : focus / single-instance (pas de payload métier).  
L’extension **n’ouvre plus** ces onglets (évite une page blanche au cold-start) ; le démarrage Windows + tray couvre le cas « Desktop éteint ».

### Commandes Tauri utiles

`get_app_config` · `ensure_token` · `set_output_dir` · `get_jobs_snapshot` · `cancel_job` · `enqueue_urls` · `update_prefs` · `quit_app`

---

## Extension Chromium (`@limbo/extension`)

Manifest V3 · nom **LiMBo** · permissions : `storage`, `tabs`, `alarms`, `cookies`  
Host : `http://*/*`, `https://*/*`, `*://127.0.0.1:4567/*`

### Popup

1. Détecte l’onglet actif : toute page **http / https** (pas `chrome://`, etc.)
2. YouTube (watch / Shorts / youtu.be) normalisé en `https://www.youtube.com/watch?v=…`
3. Récupère les formats (`formats.list`, timeout ~45 s) : miniature, titre, durée
4. Liste groupée :
   - **Avec son** (vidéo + audio)
   - **Juste le son**
   - **Sans le son** (vidéo seule)
5. Pré-sélection selon la pref Desktop synchronisée (`prefs.snapshot`) :
   - `best_image` → premier combo A+V
   - `best_sound` → audio seul, sinon combo
6. Trim optionnel : **« Découper un extrait (optionnel) »**, début / fin en `mm:ss` ou `hh:mm:ss`
7. **Télécharger** → `download.create` avec `formatId`, trim, `hasAudio` / `hasVideo`

Logo Stepping Disc dans l’en-tête du popup (28×28).

### Cookies (navigateur ouvert)

L’extension exporte un jar **Netscape** via `chrome.cookies` et l’envoie dans `formats.list` / `download.create`.  
Ça contourne le verrouillage de la base cookies Chrome/Edge quand le navigateur est ouvert (problème classique de `--cookies-from-browser`).

### File offline & badge

- Si le Desktop est injoignable : le téléchargement est mis en **brouillon** (`chrome.storage.session`), badge = taille de la file ; flush automatique au prochain `auth.ok`
- Reconnexion périodique (alarme ~0,5 min)
- Badge : pourcentage pendant `job.progress` ; vidé sur `done` / `error`

### Storage

| Clé | Rôle |
|-----|------|
| `limboToken` | token WS (local) |
| `limboDefaultQuality` | qualité par défaut (local) |
| `limboDraftQueue` | file offline (session) |

---

## LiMBO-premiere (Adobe Premiere Pro)

Panneau CEP **LiMBO-premiere** · bundle `com.limbo.premiere` · host Premiere `PPRO` 14–99 · CSXS 11  
Taille panel ~320×520 (min 260×280) · CEF `--enable-nodejs` / `--mixed-context`

**Le panneau ne lance pas de téléchargements** : il observe la file Desktop et importe les fichiers terminés.

### Interface

- Logo + titre **LiMBO-premiere**
- État de connexion Desktop (point vert / rouge)
- Checkbox **« Auto-import à la fin du téléchargement »** (`localStorage.limbo_premiere_auto_import`)
- Liste des jobs avec :
  - barre de progression
  - phase, mode, %, vitesse, ETA
  - bouton **Importer** / **Réimporter** quand `phase === done` et `outputPath` présent
- Reconnexion automatique toutes **2,5 s**

### Import timeline (`jsx/host.jsx` → `limboImport(path, mode)`)

1. Nécessite un **projet ouvert**
2. Crée / utilise le bin projet **`LiMBo`**
3. `importFiles` du média téléchargé
4. **Pas de séquence active** → crée une séquence à partir du clip (`createNewSequenceFromClips`, nom = stem du fichier) — l’import réussit quand même
5. **Séquence active** → insert à la playhead sur une **nouvelle piste** :
   - `son` → piste audio
   - `video` / `combo` → piste vidéo (audio lié pour les fichiers combo)
6. Modes `*_trimmed` acceptés (suffixe retiré pour le mapping de pistes)

---

## Fonctionnalités — récapitulatif

### Téléchargement

- [x] Sites gérés par yt-dlp (YouTube, Instagram, TikTok, …) via URL http(s)
- [x] Choix de format (combo / son / vidéo seule) depuis l’extension
- [x] Batch multi-URL depuis le Desktop (résolution + conteneur + son)
- [x] Trim temporel (extension → yt-dlp `--download-sections`)
- [x] File séquentielle, annulation, progression (% / vitesse / ETA)
- [x] Cookies extension (Netscape) + cookies navigateur (batch Desktop)
- [x] Dossiers / noms anti-écrasement datés + mode
- [x] Pref qualité partagée Desktop ↔ extension (`prefs.snapshot`)

### Desktop

- [x] Fenêtre fixe Darkchylde, tiroir Réglages
- [x] Tray (hide on close), réduire vers la barre des tâches
- [x] Démarrage Windows minimisé
- [x] Son de fin de file
- [x] Actions post-file : veille / arrêt / arrêt forcé
- [x] Protocole `limbo://open` (focus)

### Extension

- [x] Popup formats + trim + téléchargement
- [x] Export cookies sans fermer le navigateur
- [x] File brouillon si Desktop offline + badge
- [x] Pas d’ouverture `limbo://` (cold-start via Desktop / tray)

### Premiere

- [x] Suivi live des jobs (progress inclus)
- [x] Import manuel ou auto
- [x] Bin `LiMBo`, nouvelles pistes, création de séquence si absente

---

## Limitations & pièges connus

1. **Windows only** pour l’install CEP, le startup, le tray power, etc.
2. **Un seul téléchargement à la fois** (file FIFO).
3. **`--cookies-from-browser` (batch Desktop)** échoue souvent si le navigateur est ouvert — préférer l’extension (cookies Netscape) pour les sites authentifiés.
4. Le message d’erreur yt-dlp peut mentionner « Chrome » même si Edge est sélectionné.
5. **YouTube** exige Node ≥ 20 sur la machine (runtime JS yt-dlp).
6. **CEP non signé** : `PlayerDebugMode` requis (posé par `install:cep`).
7. L’extension **ne relance plus** le Desktop via `limbo://` : garder le démarrage Windows / tray activé.
8. Pas de sniff réseau m3u8/DASH dans le code actuel — uniquement yt-dlp sur URL page.
9. Builds dans un dossier Dropbox : retries EPERM possibles ; Cargo Desktop est hors Dropbox.

---

## Développement — smoke WS

Scripts utilitaires dans `dev/scripts/` :

- `ws-smoke.mjs` — handshake hello/auth
- `ws-smoke-download.mjs` — enchaînement download de test

---

## Licence / statut

Projet privé / en développement (`private: true` dans les packages). Version Desktop `0.1.0` · manifest extension `0.1.2` · panneau Premiere `0.1.0`.
