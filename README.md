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

KataGo-powered "explore" analysis is gated by `VITE_KATAGO` and only works when the private backend is running locally (the dev server proxies `/api/katago` to it). Production builds ship without it.

## Deploy

Pushing to `main` runs `.github/workflows/deploy-pages.yml`, which builds and publishes to GitHub Pages. Firebase web config (public values) is injected from repository **Variables** (`VITE_FIREBASE_*`, and `VITE_BASE=/go-training/`).
