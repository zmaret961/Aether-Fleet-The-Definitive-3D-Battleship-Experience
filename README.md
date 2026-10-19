# Aether Fleet — The Definitive 3D Battleship Experience

A cinematic, glassmorphic 3D take on Battleship. Command a procedurally-built fleet over a living GLSL ocean, across four AI difficulties — from a cadet firing blind to an admiral hunting by probability density.

## Run

```bash
npm install
npm run dev        # dev server
npm run build      # production build (also generates the PWA service worker)
npm run preview    # serve the production build
npm test           # engine + AI legality/balance tests (vitest)
npm run typecheck  # tsc -b (strict)
npm run lint       # eslint
```

Deploy anywhere static (Vercel/Netlify/Pages): `npm run build` → `dist/`. The game is a fully offline-capable PWA — no backend.

## Architecture

| Layer | Files | Notes |
|---|---|---|
| Game engine | `src/game/` | Pure TypeScript. `board.ts` (placement/firing), `ai.ts` (4 tiers), `engine.ts` (match state). No React/Three imports — fully unit-testable. |
| State | `src/state/store.ts` | Zustand store. Match/boards mutate in place; a `matchVersion` counter triggers React rerenders. `src/state/fx.ts` is a pub/sub bus so one-shot 3D effects never pollute render state. |
| 3D | `src/three/` | R3F v9 scene: custom GLSL ocean (vertex waves + caustic/fresnel/fog fragment), instanced hit/miss markers, procedural ship meshes, reticle, ripple/particle effects layer driven by the fx bus. |
| UI | `src/ui/` | "Liquid Glass" HUD — Tailwind v4 `.glass` utilities, framer-motion transitions. |
| Audio | `src/audio/engine.ts` | Procedural Web Audio — brown-noise ocean ambience, sonar ping, synthesized fire/hit/sink/stingers. No audio assets. |

### AI tiers

- **Cadet** — random targeting, 45% chance to chase a discovered hit.
- **Officer** — hunt/target with parity (checkerboard) hunting; extends hit runs along an axis.
- **Commander** — full probability-density heat map over all legal remaining-ship placements.
- **Admiral** — sharper density (`hitPower 2`, length-weighted), endpoint boost on multi-hit runs, parity-weighted hunting. Threatening, never cheaty: it only ever sees the same marks you do.

The test suite (`src/game/game.test.ts`) proves every tier never repeats a shot, always finishes a match, and that higher tiers sink fleets faster on average.

### Performance

- `AdaptiveDpr` (`<PerformanceMonitor>`) scales render resolution 0.7–2× device pixel ratio to hold frame rate.
- Hit/miss markers are two `InstancedMesh` draws; the whole battle stays well under the draw-call budget.
- Bloom is gated behind the perf-mode setting; ocean segments drop 96→48.
- All geometry/materials live inside R3F's automatic disposal.

### PWA & a11y

`vite-plugin-pwa` precaches the full shell (offline play works). Settings include volume/mute, reduced motion, high contrast, and a performance mode — persisted to `localStorage`, along with per-difficulty win/loss records.

## Controls

- Deploy: click a ship, click the grid to place, **R** (or Rotate) to turn, Auto-Deploy for a legal layout.
- Battle: click a cell to aim (sonar pulse), **Enter** / FIRE to launch. Toggle Enemy Waters / Your Fleet to watch incoming fire.
