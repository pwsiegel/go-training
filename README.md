# go-training

The public, user-facing static web app for solving tsumego (Go life-and-death problems) and reviewing them with a teacher. React + Vite + TypeScript, deployed to GitHub Pages.

Problems and all user data live in Firebase (auth-gated Storage + Firestore); this repo holds only the app code. The tooling that produces that data — PDF scanning, ML stone/board detection, the KataGo analysis API, and the ingest/export pipeline — lives in a separate private repo, **`pwsiegel/go-training-tools`** (which nests this repo at `app/` locally).

## Develop

```sh
npm install
cp .env.example .env    # fill in VITE_FIREBASE_* (Firebase console / the private repo)
npm run dev             # http://localhost:5173
npm run build
npm run lint
```

The **Review** page (browse + replay saved games) is always available. Its games come from two sources:

- **Fox** — imported from [Fox Weiqi](https://www.foxwq.com/) by a local-only sync (the Fox API sends no CORS headers, so it can't run in the deployed app). Synced games persist to Firestore and are reviewable here on GitHub Pages.
- **Local KataGo** — games played on the **Play** page (a full game against a human-like KataGo at a chosen rank). These, along with the "explore" analysis hints, are gated by `VITE_KATAGO` and only work with the private backend running locally.

Enable the gated features with `make app-katago` from the private repo (or `VITE_KATAGO=1 npm run dev`), alongside `make api-fox` (KataGo + Fox sync) or `make api-katago`. The dev server proxies `/api/katago` and `/api/fox` to the backend; production builds ship without the gated features.

## Deploy

Pushing to `main` runs `.github/workflows/deploy-pages.yml`, which builds and publishes to GitHub Pages. Firebase web config (public values) is injected from repository **Variables** (`VITE_FIREBASE_*`, and `VITE_BASE=/go-training/`).
