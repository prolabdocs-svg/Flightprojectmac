# UI Screen Inventory — Phase 0 audit (2026-09-23)

Source of truth: the running build (vite, `?qa`) + `src/ui/**`, `src/App.tsx`, `src/state/gameStore.ts`.
Routing is a single `screen` enum in `useGameStore` (no router). Copy is Spanish. Profile/persistence lives in
`useProfileStore` (`src/state/profileStore.ts`, `src/save/save.ts`); contract loop in `src/mission/**`.

Shared prototype chrome before the redesign: `ScreenHeader` (back + title + ResourceBar pills), a 5-tab
`MenuNavigation` (Mapa · Taller · I+D · Pintura · Ajustes), rounded `.panel` / `.tile` / `.card` grids in
`Screens.css`, a 2D SVG `HangarAircraft` stand-in for the aircraft.

| Screen | File | Current purpose | Current problems | Keep | Remove | Redesign | Dependencies | Target experience |
|---|---|---|---|---|---|---|---|---|
| Boot | `BootScreen.tsx` | Load profile, route to onboarding/hangar | Brand typo "PROYECT"; generic progress bar | load() → goTo logic, legacy onboarding flag | typo | Title card with placard wordmark + runway-light loader | `profileStore.load`, `localStorage 'project-flight/onboarded'` | 1 s branded boot that reads as the game's title screen |
| Onboarding | `OnboardingScreen.tsx` | Mode-2 stick tutorial, practice pads | Consistent enough; styled via shared tokens | Whole flow, practice pads | — | Restyle only via tokens | `updateSettings`, VirtualStick | Controls explained with diagrams |
| Hangar | `HangarScreen.tsx` | Hub: FLY CTA, ops status, per-component condition, home-base upgrades | 2D SVG aircraft; 4 equal-weight panels compete; 13 maintenance tiles are a wall of "100%"; nav is a web tab bar | All callbacks & testids (`fly`, `ops-panel`, `hangar-*`, `maintenance-panel`, `component-*`, `start-repair`, `collect-repair`, `repair-in-progress`, `airworthiness`), fly() resume logic | Stat walls, generic panels | Real 3D aircraft stage dominant; left placard menu (Mapa/Taller/Aeronaves/Bitácora); compact status strip; maintenance as a collapsible tag sheet | ops state, repair timers, homeBase, reputation ranks | "What do I want to do with my aircraft?" in 2 s |
| Map | `MapScreen.tsx`, `WorldMapCanvas.tsx`, `MapDestinationPanel.tsx`, `OpsDestinationPanel.tsx` | Geography-first map: pan/zoom, range rings, destinations, contracts per airfield, route plan | Strongest existing screen. Chrome (header/tabs/panel) generic; range reads as flat circles | Canvas renderer, projection, range classification, all `.wmap-*` hooks used by tests | — | Restyle chrome to chart/placard language; bottom nav swap | `mapPlan`, `mapProjection`, operations offers | "Where can I fly next?" |
| Briefing / Pre-flight | `BriefingScreen.tsx`, `ContractPlanner.tsx` | Contract planner (fuel, route, readiness) + legacy mission briefing | Dense rounded panels | All planner logic | — | Placard styling, START hierarchy | `findContract`, `prepareFlight` | "Do I dare attempt this flight?" |
| Builder → Workshop | `BuilderScreen.tsx` | Frame + part swapping, engineering telemetry | RPG card wall; no aircraft visible; raw physics numbers (N, m², CoM) | install/buy logic, tech gating | CoM/drag-area jargon as primary | 3D stage with component-focus camera; category rail; upgrade cards with BEFORE→AFTER deltas and balance-after-purchase | `installPart`, `resolveAircraft`, `buyPart` | "How can I make this aircraft better?" |
| Paint → Liveries | `PaintScreen.tsx` | Buy/equip colour presets | 2D SVG preview; no sense of reward | buy/select logic | 2D preview | Workshop tab with 3D preview & livery category tags | `PAINT_PRESETS`, `buyPaint` | Unlocks feel like rewards |
| Tech tree (I+D) | `TechTreeScreen.tsx` | RP-gated nodes unlocking parts/frames | Generic card lists | unlock logic | — | Blueprint-style branch columns; reached from Aircraft collection | `TECH_NODES`, `unlockTech` | Research as the path to the next machine |
| Aircraft collection | — (missing) | — | Frames only exist as cards inside Builder | — | — | NEW: large silhouettes/3D preview per frame, owned/locked, explicit requirements | `FRAMES`, `TECH_NODES`, `ownedFrameIds` | "What machine do I want to earn next?" |
| Career / Logbook | — (missing) | — | Ops log + condition counters exist but are never shown | — | — | NEW: pilot logbook from `operations.log`, career totals, discoveries | `operations.log`, `visitedAirfieldIds`, `completedMissions` | "How far have I come?" |
| Flight HUD | `FlightHud.tsx/.css`, `VirtualStick`, `FlightDebugOverlay` | Airspeed/alt/fuel/warnings, sticks | Already safe-area aware, tested (`FlightHud.css.test.ts`); another session is editing `FlightHud.tsx` | Everything | — | Token alignment only (no structural edits while the file is in flight elsewhere) | flight telemetry | Readable, uncluttered |
| Pause | `PauseOverlay.tsx/.css` | Resume/restart/abandon/hangar | Blur modal; OK functionally | Contract-aware abandon logic | backdrop blur (perf) | Clipboard-placard card, simpler hierarchy | `abandonMission`, telemetry | Simple, 1 decision |
| Results / Crash | `ResultsScreen.tsx`, `ContractResults.tsx` | Settlement ledger (contract) + legacy flight results | Generic "CONTRATO FALLIDO" gradient hero; crash lacks what-happened / repair-next framing | read-only settlement, testids (`results-title`, `ledger`, `net`, `wallet`, `fuel-left`, `condition`, `flight-damage`, `needs-recovery`, `recover`, `back-to-map`, `discovery`) | giant generic headline tone | Stamped report: outcome stamp, cause, damaged components as maintenance tags, repair estimate, animated wallet count-up | `lastSettlement`, `recoverAircraft` | Success: "was it worth it?"; failure: "what went wrong / what next" |
| Settings | `SettingsScreen.tsx` | Controls/audio/accessibility/data | Four equal cards | All settings bindings | — | Category rail (Juego/Controles/Audio/Accesibilidad/Datos) + proper widgets | `updateSettings`, `resetProfile` | Find any setting in 2 s |

## Known cross-cutting issues
- Two icon/brand spellings ("PROYECT"). Fixed to PROJECT.
- `backdrop-filter` on nav + pause (costly on mobile GPUs). Removed.
- Colors hard-coded in several component CSS files (ContractPlanner.css, MapScreen.css); tokens added so they converge.
- No sound-event layer beyond `audioService.playTone`; UI now routes through named events (`uiSound`).
