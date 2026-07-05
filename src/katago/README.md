# Vendored in-browser KataGo engine

`engine/`, `utils/`, and `types.ts` are vendored from
[Sir-Teo/web-katrain](https://github.com/Sir-Teo/web-katrain) (MIT — see `LICENSE`),
a browser-native KataGo pipeline built on TensorFlow.js (WebGPU, with WASM/CPU
fallback). It parses KataGo `.bin.gz` weights, extracts v7 input features, runs
forward passes, and does PUCT/MCTS search — entirely client-side, no backend.

`webEngine.ts` is ours: a thin wrapper that bridges the app's game types
(`Stone` / `GameMove`) to the engine and returns a trimmed analysis.

## Notes
- The worker is pre-bundled by `../../scripts/build-worker.mjs` into
  `public/katago-worker.js` (rebuilt on every `dev`/`build`), so it runs
  identically under `vite dev` and the production build.
- The model net (`public/models/*.bin.gz`) and the generated worker/wasm assets
  are gitignored; the net still needs hosting for the deployed build.

## Updating from upstream
Re-copy `src/engine/katago`, `src/types.ts`, and the used `src/utils/*` files,
preserving this directory layout so the relative imports (`../../types`,
`../../utils/*`) keep resolving.
