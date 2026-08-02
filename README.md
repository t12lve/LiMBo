# LiMBo

Code dans `dev/` ; livrables dans `prod/` via `pnpm build` (depuis `dev/`).

Build : `cd dev && pnpm build`

Ce script (`dev/scripts/build-all.mjs`) enchaîne :
1. `fetch-binaries.mjs` — télécharge yt-dlp/ffmpeg dans `prod/bin/` s'ils manquent.
2. `build-extension.mjs` — build Vite de l'extension, copié dans `prod/extension/`.
3. `build-desktop.mjs` — `tauri build` (release) de l'app Desktop, copié dans `prod/desktop/`.

Chaque étape peut aussi être lancée seule : `node dev/scripts/build-extension.mjs` ou
`node dev/scripts/build-desktop.mjs` (équivalent : `pnpm --filter @limbo/extension build:prod`
et `pnpm --filter @limbo/desktop build:prod`).

`prod/extension/` et `prod/desktop/` sont regénérés à chaque build et ne sont pas commités
(gitignorés) ; seul `prod/bin/.gitkeep` est versionné dans `prod/`.

Binaires sidecar (yt-dlp, ffmpeg) : non commités (trop volumineux) — `node dev/scripts/fetch-binaries.mjs`
les télécharge dans `prod/bin/` (seul `prod/bin/.gitkeep` est versionné).

Extension Chrome : `chrome://extensions` → mode développeur → charger `prod/extension`

Desktop : `prod/desktop/limbo-desktop.exe` (portable, yt-dlp/ffmpeg copiés à côté) ou
l'installeur dans `prod/desktop/bundle/` (`msi`/`nsis`).
