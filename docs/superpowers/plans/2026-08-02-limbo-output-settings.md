# LiMBo Output Paths, Settings & Darkchylde UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empêcher l’écrasement des fichiers (dossier par vidéo + nom daté/mode), ajouter un tiroir Réglages (dossier, qualité par défaut, cookies, démarrage Windows), fenêtre fixe Darkchylde, et synchroniser la pré-sélection qualité avec l’extension.

**Architecture:** Calcul de chemins en Rust (`paths.rs`) après meta yt-dlp ; prefs étendues dans `config.json` ; `prefs.snapshot` sur le WS après `auth.ok` ; UI Desktop refondue (header fixe + scroll + tiroir) ; startup via HKCU Run + `--minimized`.

**Tech Stack:** Tauri v2 / Rust, React + Tailwind, `@limbo/shared` + Vitest, yt-dlp, Windows registry (HKCU Run).

**Spec:** `docs/superpowers/specs/2026-08-02-limbo-output-settings-design.md`

## Global Constraints

- Sources uniquement sous `dev/` ; livrables sous `prod/` via `pnpm build`
- OS : Windows 11
- Thème Darkchylde : cramoisi `#8a1830` / `#5a2030`, or `#e8c878`, fond `#0c0608` — pas de violet générique
- Fenêtre fixe ≈ 440×680, `resizable: false`
- Pas de tray / headless
- Identité git one-shot si besoin : `GIT_AUTHOR_NAME=t12lve` / `2hellv@gmail.com` (ne pas toucher `git config`)
- Commits fréquents par tâche

---

## File Structure

| Fichier | Rôle |
|---------|------|
| `dev/packages/shared/src/types.ts` | `DefaultQuality` |
| `dev/packages/shared/src/messages.ts` | `prefs.snapshot` |
| `dev/apps/desktop/src-tauri/src/paths.rs` | Sanitize, mode, `job_dir`, template fichier |
| `dev/apps/desktop/src-tauri/src/config.rs` | `default_quality`, `launch_at_startup` |
| `dev/apps/desktop/src-tauri/src/startup.rs` | HKCU Run + lecture arg `--minimized` |
| `dev/apps/desktop/src-tauri/src/ytdlp.rs` | Meta extractor ; template `-o` ; plus de `--force-overwrites` |
| `dev/apps/desktop/src-tauri/src/job_runner.rs` | Créer `job_dir`, passer template/mode |
| `dev/apps/desktop/src-tauri/src/ws_server.rs` | Envoyer `prefs.snapshot` après auth |
| `dev/apps/desktop/src-tauri/src/lib.rs` | Prefs + startup commands + minimize |
| `dev/apps/desktop/src-tauri/tauri.conf.json` | Taille fixe |
| `dev/apps/desktop/src/components/SettingsDrawer.tsx` | Tiroir réglages |
| `dev/apps/desktop/src/components/AppShell.tsx` | Header + scroll + thème |
| `dev/apps/desktop/src/App.tsx` | Compose shell |
| `dev/apps/desktop/src/index.css` / Tailwind | Tokens Darkchylde |
| `dev/apps/extension/src/prefs.ts` | État `defaultQuality` depuis WS |
| Icons sous `dev/apps/desktop/src-tauri/icons/` + extension | Stepping Disc |

---

### Task 1: Shared — `DefaultQuality` + `prefs.snapshot`

**Files:**
- Modify: `dev/packages/shared/src/types.ts`
- Modify: `dev/packages/shared/src/messages.ts`
- Modify: `dev/packages/shared/src/messages.test.ts`

**Interfaces:**
- Produces: `export type DefaultQuality = "best_image" | "best_sound"`
- Produces: `WsServerMessage` member `{ type: "prefs.snapshot"; defaultQuality: DefaultQuality }`

- [ ] **Step 1: Add type + message + failing guard test**

In `types.ts`:

```ts
export type DefaultQuality = "best_image" | "best_sound";
```

In `messages.ts`, extend `WsServerMessage` and `isWsServerMessage`:

```ts
| { type: "prefs.snapshot"; defaultQuality: DefaultQuality }

case "prefs.snapshot":
  return value.defaultQuality === "best_image" || value.defaultQuality === "best_sound";
```

Add test asserting valid/invalid `prefs.snapshot`.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @limbo/shared test`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add dev/packages/shared/src/types.ts dev/packages/shared/src/messages.ts dev/packages/shared/src/messages.test.ts
git commit -m "feat(shared): add prefs.snapshot and DefaultQuality"
```

---

### Task 2: Config — `default_quality` + `launch_at_startup`

**Files:**
- Modify: `dev/apps/desktop/src-tauri/src/config.rs`
- Modify: `dev/apps/desktop/src-tauri/src/lib.rs` (`PrefsUpdate`, `update_prefs`, `get_app_config`)

**Interfaces:**
- Produces: `AppConfig.default_quality: String` (`"best_image"` | `"best_sound"`)
- Produces: `AppConfig.launch_at_startup: bool`
- Consumes: existing `save` / `load_or_init` (re-save already fills new fields)

- [ ] **Step 1: Extend `AppConfig`**

```rust
fn default_quality() -> String { "best_image".into() }

#[serde(default = "default_quality")]
pub default_quality: String,
#[serde(default)]
pub launch_at_startup: bool,
```

Update `load_or_init` initial struct + `PrefsUpdate` / `update_prefs` to accept `defaultQuality` / `launchAtStartup` (camelCase côté invoke, snake côté JSON comme les autres ou camel via serde rename — **suivre le pattern existant de `PrefsUpdate`** dans `lib.rs`).

- [ ] **Step 2: `cargo check` in `src-tauri`**

Run: `cd dev/apps/desktop/src-tauri && cargo check`  
Expected: OK

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(desktop): persist default_quality and launch_at_startup"
```

---

### Task 3: `paths.rs` — dossier / fichier / mode (TDD)

**Files:**
- Create: `dev/apps/desktop/src-tauri/src/paths.rs`
- Modify: `dev/apps/desktop/src-tauri/src/lib.rs` (`mod paths;`)
- Create tests in `paths.rs` via `#[cfg(test)]`

**Interfaces:**
- Produces:
  - `pub fn sanitize_component(input: &str, max_chars: usize) -> String`
  - `pub fn normalize_platform(extractor: &str) -> String`
  - `pub fn download_mode(format_id: &str, trimmed: bool) -> String` → `combo` | `son` | `sans-son` (+ `_trimmed`)
  - `pub fn job_subdir(platform: &str, title: &str, id: &str) -> String`
  - `pub fn output_filename_stem(title: &str, timestamp: &str, mode: &str, job_id_short: Option<&str>) -> String`
  - `pub fn build_output_template(job_dir: &str, stem: &str) -> String` → `{job_dir}/{stem}.%(ext)s`

- [ ] **Step 1: Write failing unit tests**

```rust
#[test]
fn mode_audio_only() {
    assert_eq!(download_mode("ba/b", false), "son");
}
#[test]
fn mode_trimmed_combo() {
    assert_eq!(download_mode("bv*+ba/b", true), "combo_trimmed");
}
#[test]
fn subdir_shape() {
    assert_eq!(
        job_subdir("Instagram", "Focus - FR FLASH something long", "Da5KpoeBE7W"),
        // titre tronqué ≤60, sanitizé
        // starts with "Instagram " and ends with " [Da5KpoeBE7W]"
        format that matches spec
    );
}
```

- [ ] **Step 2: Implement until `cargo test paths::` passes**

Heuristics mode :
- `format_id` contains `ba` and not `bv` / video → `son` (ex. `ba/b`, `bestaudio`)
- `format_id` is video-only (`bv*` without `+ba`) → `sans-son`
- sinon → `combo`
- si `trimmed` → append `_trimmed`

Platform map : `instagram`→`Instagram`, `youtube`→`Youtube`, `tiktok`→`TikTok`, `twitter`/`x`→`Twitter`, else title-case / `Video`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(desktop): path helpers for per-video folders and dated names"
```

---

### Task 4: yt-dlp meta + template de sortie

**Files:**
- Modify: `dev/apps/desktop/src-tauri/src/ytdlp.rs`
- Modify: `dev/apps/desktop/src-tauri/src/job_runner.rs`

**Interfaces:**
- Change: `fetch_title_and_id` → `fetch_meta(...) -> Result<VideoMeta, String>` where `VideoMeta { title, id, extractor }`
- Change: `DownloadRequest` adds `output_template: &str` (chemin complet template) **ou** `job_dir` + `filename_stem` ; **retirer** `--force-overwrites`
- Cleanup annulation : supprimer fichiers sous `job_dir` liés au job (`.part`, `.ytdl`), plus le glob racine seul

- [ ] **Step 1: Extend meta print**

```rust
command.args([
  "--skip-download",
  "--print", "%(title)s",
  "--print", "%(id)s",
  "--print", "%(extractor)s",
  url,
]);
```

- [ ] **Step 2: In `run_job`, after meta**

```rust
let platform = paths::normalize_platform(&meta.extractor);
let mode = paths::download_mode(&format_id, trim.is_some());
let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
let sub = paths::job_subdir(&platform, &meta.title, &meta.id);
let job_dir = PathBuf::from(output_root).join(&sub);
fs::create_dir_all(&job_dir)?;
let stem = paths::output_filename_stem(&meta.title, &stamp, &mode, None);
// if Path::exists(job_dir.join(format!("{stem}.*"))) collision → pass Some(&id[..4])
let template = paths::build_output_template(job_dir.to_str().unwrap(), &stem);
```

Ajouter dépendance `chrono` avec feature `clock` dans `Cargo.toml` si absente.

- [ ] **Step 3: `cargo test` + smoke mental checklist**

Expected: tests paths OK ; compile job_runner.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): per-video output dirs and dated mode filenames"
```

---

### Task 5: Windows startup + `--minimized`

**Files:**
- Create: `dev/apps/desktop/src-tauri/src/startup.rs`
- Modify: `dev/apps/desktop/src-tauri/src/lib.rs`
- Modify: `dev/apps/desktop/src-tauri/Cargo.toml` (crate `winreg` si besoin)

**Interfaces:**
- Produces: `pub fn set_launch_at_startup(enabled: bool) -> Result<(), String>`
- Produces: `pub fn args_request_minimized() -> bool` (scan `std::env::args` for `--minimized`)
- Value HKCU Run name: `LiMBo` ; data: `"C:\\…\\limbo-desktop.exe" --minimized`

- [ ] **Step 1: Implement registry helper**

```rust
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "LiMBo";
```

Use current exe via `std::env::current_exe()`.

- [ ] **Step 2: Wire `update_prefs`** — when `launch_at_startup` changes, call `set_launch_at_startup`. Also Tauri command `set_launch_at_startup` if UI toggles independently.

- [ ] **Step 3: On setup**, if `args_request_minimized()`, get main window and `window.minimize()`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): launch at Windows startup minimized"
```

---

### Task 6: WS `prefs.snapshot` après auth

**Files:**
- Modify: `dev/apps/desktop/src-tauri/src/ws_server.rs`

**Interfaces:**
- Consumes: `runner` / config for `default_quality`
- After `auth.ok`, before or after `jobs.snapshot`:

```json
{ "type": "prefs.snapshot", "defaultQuality": "best_image" }
```

- [ ] **Step 1: Send snapshot**
- [ ] **Step 2: Commit**

```bash
git commit -m "feat(desktop): send prefs.snapshot after auth.ok"
```

---

### Task 7: Fenêtre fixe + shell Darkchylde + tiroir

**Files:**
- Modify: `dev/apps/desktop/src-tauri/tauri.conf.json` → `width: 440`, `height: 680`, `resizable: false`
- Create: `dev/apps/desktop/src/components/AppShell.tsx`
- Create: `dev/apps/desktop/src/components/SettingsDrawer.tsx` (absorbe `PrefsBar.tsx` + dossier + qualité + startup)
- Modify: `dev/apps/desktop/src/App.tsx`
- Modify: `dev/apps/desktop/src/index.css` (CSS variables)
- Delete or stop using: `PrefsBar.tsx` (migrer puis supprimer)

**Interfaces:**
- `SettingsDrawer` props: `open: boolean; onClose: () => void`
- Invoke existants + nouveaux champs prefs ; `set_output_dir` / dialog dossier (réutiliser FirstRunGate pattern `open` dialog)

- [ ] **Step 1: tauri.conf taille fixe**
- [ ] **Step 2: Tokens CSS**

```css
:root {
  --limbo-bg: #0c0608;
  --limbo-crimson: #8a1830;
  --limbo-border: #5a2030;
  --limbo-gold: #e8c878;
  --limbo-ivory: #f2e8e4;
}
```

- [ ] **Step 3: AppShell** — header LIMBO + disque SVG + ⚙ + badge file ; `main` `flex-1 overflow-y-auto` ; footer optionnel ; overlay drawer

- [ ] **Step 4: SettingsDrawer fields** — output_dir, default_quality, cookies, sound, post_queue, launch_at_startup + hint cookies extension

- [ ] **Step 5: Manual UI check in `pnpm tauri dev`** — pas de resize ; scroll file longue ; Échap ferme tiroir

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(desktop): Darkchylde shell, fixed window, settings drawer"
```

---

### Task 8: UrlBatch — défaut `best_image` / `best_sound`

**Files:**
- Modify: `dev/apps/desktop/src/components/UrlBatch.tsx`

**Interfaces:**
- On mount, `invoke<AppConfig>("get_app_config")` ; si `best_sound` → `audioOnly: true` (ou équivalent state actuel) sur nouveaux items

- [ ] **Step 1: Lire config et appliquer défaut aux `PendingItem` créés**
- [ ] **Step 2: Commit**

```bash
git commit -m "feat(desktop): apply default_quality to batch paste items"
```

---

### Task 9: Extension — consommer `prefs.snapshot`

**Files:**
- Create: `dev/apps/extension/src/prefs.ts` (module état + listener)
- Modify: `dev/apps/extension/src/ws-client.ts` ou `background.ts` — dispatch `prefs.snapshot`
- Modify: `dev/apps/extension/src/popup/App.tsx` (ou équivalent sélection format)

**Interfaces:**
- `getDefaultQuality(): DefaultQuality` (défaut `best_image` tant que pas de snapshot)
- Popup : après `formats.result`, pré-sélectionner format « avec son meilleure » vs « Juste son » selon qualité

- [ ] **Step 1: Store snapshot in memory (+ optional `chrome.storage.local`)**
- [ ] **Step 2: Preselect in popup**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(extension): preselect format from prefs.snapshot"
```

---

### Task 10: Icônes Stepping Disc

**Files:**
- Replace: `dev/apps/desktop/src-tauri/icons/*` (générer PNG/ICO via script Node canvas ou export SVG → PNG)
- Extension : icône action dans `manifest` / `public/icons` si présent

**Interfaces:**
- Motif : anneaux concentriques or `#e8c878` sur disque cramoisi `#8a1830`, fond sombre — lisible 16–32px

- [ ] **Step 1: Générer assets** (SVG source + raster 32/128/ico)
- [ ] **Step 2: Pointer extension + tauri bundle icons**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat: Stepping Disc icons for desktop and extension"
```

---

### Task 11: Rebuild prod + smoke QA

**Files:** none (build only)

- [ ] **Step 1: Commit leftover cookie-extension work if still unstaged** (from prior session) OR leave out of this plan’s scope — only ship files for this feature

- [ ] **Step 2: `pnpm test` puis `pnpm build` depuis `dev/`**

Expected: tests OK ; `prod/desktop` + `prod/extension` mis à jour

- [ ] **Step 3: QA manuel (critères spec §9)**

1. Deux DL même URL combo+son → 2 fichiers même dossier  
2. Trim → `_trimmed`  
3. Prefs persistent  
4. Extension pré-sélectionne  
5. Startup minimisé (cocher, relog / run exe `--minimized`)  
6. Icône  
7. Fenêtre fixe + scroll  
8. Tiroir ⚙  

- [ ] **Step 4: Commit build artifacts only if repo tracks `prod/`** (suivre habit du repo)

```bash
git commit -m "chore: rebuild prod for output paths and Darkchylde UI"
```

---

## Spec coverage check

| Spec § | Task |
|--------|------|
| Dossier `{Plateforme} {titre} [{id}]/` | 3, 4 |
| Fichier daté + mode | 3, 4 |
| Pas force-overwrites | 4 |
| Réglages champs | 2, 5, 7 |
| default_quality desktop+ext | 1, 6, 8, 9 |
| Startup minimisé | 5 |
| Darkchylde + fixe + tiroir | 7 |
| Icône Stepping Disc | 10 |
| Cookies hint / batch | 7 (UI) ; cookies browser déjà en place |
| Acceptation | 11 |

## Placeholder / consistency self-review

- Pas de TBD ; signatures `VideoMeta` / `download_mode` alignées Tasks 3–4
- `prefs.snapshot` camelCase `defaultQuality` aligné shared + WS JSON
- `PrefsUpdate` doit matcher le style camelCase existant de `lib.rs` (`soundOnFinish`, etc.)
