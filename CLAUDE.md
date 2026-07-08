# Collaboration notes — public app

This repo is the **public, user-facing static app** (React / Vite / TypeScript) for solving tsumego and reviewing them with a teacher. It reads problems and all user data from Firebase (auth-gated). The tooling — PDF scanning, ML, the KataGo analysis API, and the data pipeline — lives in the **private** repo `pwsiegel/go-training-tools`, which nests this repo at `app/` locally.

## Context
- Static SPA, deployed to GitHub Pages; it has no server of its own.
- Firebase (Storage + Firestore) is the source of truth for the problem library and all student/teacher data.
- **Review** (KataGo analysis), **Play** (vs a human-like KataGo), and **Explore-mode tsumego hints** all run **in the browser** (TensorFlow.js / WebGPU, net weights from Firebase Storage) and ship to Pages — no backend needed. When the native backend runs locally (`make api`; vite proxies `/api/katago`), all three additionally offer it as an optional **Native (Metal)** engine via a model picker. Only one browser AI session runs at a time across tabs/windows (a Web Lock; see `katago/engineLease.ts`). The WebGPU batch size auto-tunes per device — each forward pass is sized to a latency budget from a per-net forward-pass timing measured once at model load (`katago/engine/katago/autoBatch.ts`), so heavy nets stay smooth on weak GPUs; a manual override lives in the Review gear menu.
- The dev server is pinned to port 5173 (`strictPort`) — :5174 breaks Firebase Storage CORS.
- The user-facing surface (solving, reviewing) may have many users; weigh polish/accessibility/robustness accordingly.

## Working preferences
- Treat my questions as requests for information, not implicit instructions to change code. I'll say explicitly when I want work done.
- Ask before anything irreversible (deleting data, force-pushing, etc.) unless I've already authorized it.
- No automated tests right now — don't write or suggest them unless I ask.
- Clean, readable code and a well-structured repo are worth extra effort; match the surrounding style.
- All documentation describes _state_, not _process_. Use inline comments sparingly and keep them short.
