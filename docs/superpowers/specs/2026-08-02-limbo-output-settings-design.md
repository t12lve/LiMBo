# LiMBo — Dossiers de sortie, noms de fichiers & réglages

**Date:** 2026-08-02  
**Status:** Approved (brainstorming)  
**Parent:** `2026-08-02-limbo-design.md`  
**Scope:** Naming/path anti-écrasement, menu Réglages, démarrage Windows minimisé, UI Darkchylde (fenêtre fixe + tiroir), icône fort contraste

## 1. Problème

- Plusieurs téléchargements de la même vidéo (formats / trim différents) écrasent le fichier cible (`titre [id].ext` + `--force-overwrites`).
- Pas de sous-dossier par média ; prefs dispersées ; pas de démarrage Windows ; pas de défaut qualité partagé extension / batch.

## 2. Décisions validées

| Sujet | Choix |
|-------|--------|
| Structure dossiers | Approche 1 — sous-dossier par média + suffixe job |
| Forme dossier | `{Plateforme} {titre court} [{id}]/` (option C) |
| Nom fichier | `{titre}_{YYYYMMDD-HHMMSS}_{mode}.{ext}` |
| Défaut qualité | `Meilleure image` \| `Meilleur son` — batch Desktop **et** pré-sélection extension |
| Démarrage Windows | Fenêtre créée puis **minimisée** (pas tray, pas headless) |
| Thème UI | **Darkchylde** — cour de Limbo (Magik) : cramoisi + or, disque concentrique |
| Fenêtre | Taille **fixe** (~440×680), non redimensionnable ; corps **scrollable** |
| Réglages UX | Tiroir / panneau latéral overlay (⚙), pas barre prefs permanente |
| Icône | Disque concentrique or/cramoisi (Stepping Disc) + contraste fort |

## 3. Chemins de sortie

**Racine :** `config.output_dir` (inchangé, éditable dans Réglages).

**Sous-dossier (créé avant l’invocation yt-dlp) :**

```
{Plateforme} {titre≤60 caractères} [{id}]/
```

- `Plateforme` = extractor yt-dlp normalisé (`Instagram`, `Youtube`, `TikTok`, `Twitter`, …). Fallback : `Video`.
- Titre sanitizé Windows (`--windows-filenames` / helper Rust).
- `id` = id média yt-dlp (code unique).

**Fichier :**

```
{titre≤80}_{YYYYMMDD-HHMMSS}_{mode}.{ext}
```

| Mode | Condition |
|------|-----------|
| `combo` | Vidéo + audio |
| `son` | Audio seul |
| `video` | Vidéo sans audio |
| `…_trimmed` | Suffixe additionnel si `trim` présent (ex. `combo_trimmed`, `son_trimmed`) |

**Règles :**

- Timestamp = heure locale du début du job (précision seconde).
- Si collision exacte (même seconde + même mode) : suffixe court de l’id job (4 caractères).
- Retirer `--force-overwrites` du template de sortie.
- Jobs successifs même vidéo → même dossier, fichiers distincts.
- Cleanup annulation : limité au `job_dir` du job (plus le glob `[id]` à la racine seule).

## 4. UI Desktop — Darkchylde + fenêtre fixe

**Inspiration :** Limbo de Magik (Illyana) — cour démoniaque, Stepping Discs, Darkchylde. Pas de violet « AI default » : fond quasi-noir lie-de-vin, accents **cramoisi** `#8a1830` / `#5a2030`, or `#e8c878`, texte ivoire.

**Fenêtre (Tauri) :**
- Taille fixe ≈ **440×680** (`resizable: false`).
- Header fixe : marque LIMBO (disque) + bouton ⚙ + compteur file optionnel.
- Corps unique scrollable : collage de liens + file d’attente.
- Footer discret optionnel (« Cour de Limbo » / statut WS).

**Réglages :** tiroir latéral droit (overlay assombri). Ferme au clic hors panneau ou Échap. Remplace / absorbe `PrefsBar` :

| Champ | Config | Notes |
|-------|--------|--------|
| Dossier de téléchargement | `output_dir` | Dialogue dossier + affichage chemin |
| Type par défaut | `default_quality`: `best_image` \| `best_sound` | Défaut `best_image` |
| Cookies | `cookies_browser` | Batch Desktop seulement |
| Son à la fin | `sound_on_finish` | Inchangé |
| Après la file | `post_queue_action` | Inchangé |
| Lancer au démarrage Windows | `launch_at_startup` | Bool |

**Mapping qualité :**

- `best_image` → sélecteur formats curatés « meilleure qualité avec son » / équivalent batch `bv*+ba/b` (ou meilleure hauteur dispo).
- `best_sound` → format audio `ba/b` / « Juste son ».

Extension : après `auth.ok`, le Desktop envoie `prefs.snapshot` (qualité + éventuellement cookies label) ; le popup pré-sélectionne ; l’utilisateur peut toujours changer.

## 5. Démarrage Windows

- Toggle Réglages → commande Rust `set_launch_at_startup(enabled)`.
- Implémentation v1 : entrée **HKCU\Software\Microsoft\Windows\CurrentVersion\Run** (ou raccourci dossier Startup) pointant vers l’exe avec argument `--minimized`.
- Au boot : fenêtre normale créée puis `minimize()` ; barre des tâches visible.
- `limbo://open` / reconnect extension : restaure / focus la fenêtre si minimisée.

Hors scope : tray icon, mode service headless.

## 6. Icône

- Remplacer les assets Desktop + extension.
- Motif : **Stepping Disc** (anneaux concentriques) or sur disque cramoisi / fond sombre — lisible 16–32 px.
- Style flat, fort contraste ; pas de dégradé violet générique.

## 7. Changements techniques (aperçu)

| Zone | Changement |
|------|------------|
| `config.rs` | `default_quality`, `launch_at_startup` |
| `ytdlp.rs` / `job_runner.rs` | Calcul `job_dir` + template nommé ; mode depuis `format_id` + trim ; meta extractor pour plateforme |
| `lib.rs` | Prefs update, `set_launch_at_startup`, parse `--minimized` |
| UI Desktop | Thème Darkchylde ; fenêtre fixe ; tiroir Réglages ; UrlBatch lit `default_quality` |
| `tauri.conf` | `width`/`height` fixes, `resizable: false` |
| Extension | Pré-sélection format selon `prefs.snapshot` |
| Shared | Message `prefs.snapshot` (+ type `DefaultQuality`) |
| Assets | Nouvelles icônes |

## 8. Hors scope

- Tray / notifications système avancées
- Renommage rétroactif des fichiers déjà téléchargés
- Sync cloud du dossier
- Qualité « hauteur exacte » comme seul défaut (720p etc.) — dispo au cas par cas, pas comme pref globale

## 9. Critères d’acceptation

1. Deux DL de la même URL (combo puis son) → **deux fichiers** dans le **même** sous-dossier plateforme/titre/[id].
2. Trim → suffixe `trimmed` dans le nom.
3. Réglages : changer dossier, défaut qualité, cookies, startup — persistés après redémarrage.
4. Extension pré-sélectionne selon `default_quality`.
5. Au login Windows avec startup ON : LiMBo démarre **minimisé**.
6. Nouvelle icône visible dans la barre des tâches et l’extension.
7. Fenêtre non redimensionnable ; file longue → scroll interne, header/⚙ restent accessibles.
8. ⚙ ouvre le tiroir Réglages ; fermeture overlay / Échap.
