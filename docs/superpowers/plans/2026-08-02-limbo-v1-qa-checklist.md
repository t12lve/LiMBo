# LiMBo v1 — Checklist QA manuelle (gate final)

**Date :** 2026-08-02  
**Branche :** `feat/limbo-v1`  
**Machine cible :** Windows 11  
**Build :** `prod/` (généré via `cd dev && pnpm build`)

Légende : `[x]` vérifié · `[ ]` en attente · notes sous chaque cas.

---

## 1. Premier lancement Desktop → choix dossier

- [ ] **Premier lancement** affiche le dialogue de sélection de dossier de sortie.

**Comment vérifier :**
1. Supprimer `%APPDATA%\com.limbo.desktop\` (ou équivalent Tauri) pour simuler un first-run.
2. Lancer `prod\desktop\limbo-desktop.exe`.
3. Confirmer qu’un dialogue « choisir un dossier » s’ouvre avant toute UI principale.
4. Choisir un dossier test (ex. `C:\Users\<vous>\Downloads\limbo-test`).

**Statut auto :** non exécutable sans interaction GUI — en attente utilisateur.

---

## 2. Relance → pas de dialogue

- [ ] **Relance** n’affiche plus le dialogue de dossier.

**Comment vérifier :**
1. Fermer l’app, relancer `prod\desktop\limbo-desktop.exe`.
2. Le dialogue ne doit pas réapparaître ; le dossier mémorisé est réutilisé.

**Statut auto :** non exécutable sans interaction GUI — en attente utilisateur.

---

## 3. Extension chargée depuis `prod/extension`

- [ ] **Extension MV3** chargée depuis `prod/extension/` dans Chrome.

**Comment vérifier :**
1. Ouvrir `chrome://extensions`, activer « Mode développeur ».
2. « Charger l’extension non empaquetée » → sélectionner `prod/extension/`.
3. Confirmer : nom « LiMBo », version `0.1.0`, service worker actif, pas d’erreurs.

**Statut auto (artefacts) :** ✅ vérifié 2026-08-02 — `prod/extension/manifest.json`, `service-worker-loader.js`, assets JS/CSS présents. Chargement Chrome reste manuel.

---

## 4. Sur YouTube watch → formats + trim + download

- [ ] **Page watch** YouTube : popup affiche formats, champs trim, bouton Download fonctionne.

**Comment vérifier :**
1. Desktop ouvert et connecté (WS `127.0.0.1:4567`).
2. Ouvrir une vidéo longue (ex. `https://www.youtube.com/watch?v=dQw4w9WgXcQ`).
3. Cliquer l’icône LiMBo → liste de formats yt-dlp, champs début/fin trim, Download.
4. Confirmer qu’un job apparaît dans la file Desktop.

**Statut auto :** non exécutable (Chrome + YouTube + Desktop) — en attente utilisateur.

---

## 5. Short YouTube → OK

- [ ] **YouTube Short** téléchargeable sans régression.

**Comment vérifier :**
1. Ouvrir un Short (ex. `https://www.youtube.com/shorts/…`).
2. Popup LiMBo → formats + Download → job OK dans Desktop.

**Statut auto :** non exécutable — en attente utilisateur.

---

## 6. Progress Desktop + badge extension

- [ ] **Progression** visible dans l’UI Desktop **et** sur le badge de l’extension.

**Comment vérifier :**
1. Lancer un download depuis l’extension.
2. Desktop : barre/phase job (preparing → downloading → …).
3. Extension : badge icône toolbar affiche `NN%`, puis se vide à 100 %.

**Statut auto :** non exécutable — en attente utilisateur.

---

## 7. Cancel mid-download

- [ ] **Annulation** en cours de téléchargement stoppe le job proprement.

**Comment vérifier :**
1. Lancer un download long (haute qualité).
2. Cliquer Cancel dans Desktop (ou extension si exposé).
3. Job passe à cancelled ; pas de fichier partiel corrompu ; file prête pour le job suivant.

**Statut auto :** non exécutable — en attente utilisateur.

---

## 8. Desktop fermé → clic Download → `limbo://` démarre app → flush queue

- [ ] **Cold start** : Desktop fermé, Download extension → `limbo://open` lance l’app → queue vidée.

**Comment vérifier :**
1. Fermer complètement LiMBo Desktop.
2. Depuis YouTube, sélectionner format + Download dans la popup.
3. Chrome doit ouvrir `limbo://open` (onglet ou protocole enregistré).
4. Desktop démarre, se connecte WS, job en file exécuté automatiquement (flush queue).

**Statut auto :** couvert partiellement par tests unitaires `ws-client.test.ts` (fallback `limbo://open` + cooldown). Scénario E2E Chrome reste manuel.

---

## 9. Fichier final dans le dossier choisi

- [ ] **Fichier final** présent dans le dossier de sortie choisi au first-run.

**Comment vérifier :**
1. Après un download complet (cas 4 ou 5).
2. Ouvrir le dossier mémorisé → fichier `.mp4` (ou extension attendue) avec le bon contenu/trim.

**Statut auto :** non exécutable — en attente utilisateur.

---

## 10. `pnpm --filter @limbo/shared test` vert

- [x] **Tests unitaires shared** passent.

**Résultat auto (2026-08-02) :**
```
Test Files  5 passed (5)
     Tests  25 passed (25)
```
Commande : `cd dev && pnpm --filter @limbo/shared test`

---

## Vérifications automatiques complémentaires (artefacts `prod/`)

| Artefact | Présent |
|----------|---------|
| `prod/extension/manifest.json` | ✅ |
| `prod/extension/service-worker-loader.js` | ✅ |
| `prod/extension/assets/*.js` | ✅ |
| `prod/desktop/limbo-desktop.exe` | ✅ |
| `prod/desktop/bundle/msi/LiMBo_0.1.0_x64_en-US.msi` | ✅ |
| `prod/bin/yt-dlp.exe` | ✅ |
| `prod/bin/ffmpeg.exe` | ✅ |

---

## Synthèse gate

| # | Cas | Auto | Manuel |
|---|-----|------|--------|
| 1 | Premier lancement dossier | — | ⏳ |
| 2 | Relance sans dialogue | — | ⏳ |
| 3 | Extension `prod/extension` | artefacts ✅ | ⏳ Chrome |
| 4 | YouTube watch | — | ⏳ |
| 5 | YouTube Short | — | ⏳ |
| 6 | Progress + badge | — | ⏳ |
| 7 | Cancel | — | ⏳ |
| 8 | `limbo://` + flush | tests partiels ✅ | ⏳ E2E |
| 9 | Fichier final | — | ⏳ |
| 10 | Tests shared | ✅ | — |

**Gate final :** bloqué sur validation manuelle Chrome/YouTube/Desktop (cas 1–9). Cas 10 et artefacts prod validés automatiquement.
