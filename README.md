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

The **Review** page (browse + replay saved games) is always available and ships to Pages, with **KataGo analysis that runs entirely in the browser** — TensorFlow.js / WebGPU, no backend. A settings menu picks the net (b18 / b6) and playouts; net weights are served from Firebase Storage. Click any point on the board to branch **variations** — the same in-browser AI evaluates them like any other position — and they persist per user in a private `reviews/` object (separate from the game, so a student and a teacher keep independent variations) that reloads automatically. Because the in-browser engine drives the GPU, only one tab or window may run AI at a time — a Web Lock coordinates across them (Review and Play share it), and a second one waits with a note explaining why. Its games come from two sources:

- **Fox** — imported from [Fox Weiqi](https://www.foxwq.com/) by a local-only sync (the Fox API sends no CORS headers, so it can't run in the deployed app). Synced games persist to Firestore and are reviewable here on GitHub Pages.
- **Play** — games played on the **Play** page: a full game against a human-like KataGo at a chosen rank. The opponent is the human-SL net (`b18c384nbt-humanv0`) run **in the browser** (WebGPU) — no backend — so Play ships to Pages too.

Only the **"explore"** analysis hints still need the private backend (`/api/katago`) and are gated by `VITE_KATAGO` — enable them with `VITE_KATAGO=1 npm run dev` alongside `make api` (which also serves the Fox sync). When that backend is running, Review and Play additionally offer it as an optional native-KataGo engine. The dev server proxies `/api/katago` and `/api/fox` to the backend.

## Deploy

Pushing to `main` runs `.github/workflows/deploy-pages.yml`, which builds and publishes to GitHub Pages. Firebase web config (public values) is injected from repository **Variables** (`VITE_FIREBASE_*`, and `VITE_BASE=/go-training/`).
