# LiMBo

Code dans `dev/` ; livrables dans `prod/` via `pnpm build` (depuis `dev/`).

Build : `cd dev && pnpm build`

Binaires sidecar (yt-dlp, ffmpeg) : non commités (trop volumineux) — `node dev/scripts/fetch-binaries.mjs`
les télécharge dans `prod/bin/` (seul `prod/bin/.gitkeep` est versionné).

Extension Chrome : `chrome://extensions` → mode développeur → charger `prod/extension`
