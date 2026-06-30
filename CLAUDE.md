# Collaboration notes — public app

This repo is the **public, user-facing static app** (React / Vite / TypeScript) for solving tsumego and reviewing them with a teacher. It reads problems and all user data from Firebase (auth-gated). The tooling — PDF scanning, ML, the KataGo analysis API, and the data pipeline — lives in the **private** repo `pwsiegel/go-training-tools`, which nests this repo at `app/` locally.

## Context
- Static SPA, deployed to GitHub Pages; it has no server of its own.
- Firebase (Storage + Firestore) is the source of truth for the problem library and all student/teacher data.
- KataGo "explore" analysis is gated by `VITE_KATAGO` and only reachable when the private backend runs locally (vite proxies `/api/katago`). Production ships without it.
- The dev server is pinned to port 5173 (`strictPort`) — :5174 breaks Firebase Storage CORS.
- The user-facing surface (solving, reviewing) may have many users; weigh polish/accessibility/robustness accordingly.

## Working preferences
- Treat my questions as requests for information, not implicit instructions to change code. I'll say explicitly when I want work done.
- Ask before anything irreversible (deleting data, force-pushing, etc.) unless I've already authorized it.
- No automated tests right now — don't write or suggest them unless I ask.
- Clean, readable code and a well-structured repo are worth extra effort; match the surrounding style.
- All documentation describes _state_, not _process_. Use inline comments sparingly and keep them short.
