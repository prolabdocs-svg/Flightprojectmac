# Decision log — forensic production-planning audit, 2026-09-17

Scope: read-only forensic audit producing `.orchestrator/` planning artifacts only. No game/runtime
code, dependencies, or existing docs were altered. No fixes were attempted.

## D1 — Treat uncommitted working-tree changes as user-owned evidence, not proof

25 modified + 11 untracked paths exist in the working tree, including the entire Electron/Steam
desktop shell, the CI workflow, and the error boundary. Per the task's own instruction, this work
is not to be altered and is not to be used as proof of a working feature merely because it exists.

Resolution: `npm test` / `npm run build` / `npm audit` / lint all ran against the actual filesystem
(which includes uncommitted changes, since these tools read files, not git HEAD), so the PASS
results genuinely cover that code. But no git-history or diff-based reasoning was used to validate
it, and PROJECT_STATE.json explicitly flags it as user-owned with a note that its absence from git
history is itself a risk (RISK-01).

## D2 — Used the spec's own structure/TOC rather than transcribing all 16,686 lines

`PROJECT_FLIGHT_MASTER_VISUAL_IMPLEMENTATION_SPEC_v5.0.md` is a 16,686-line "master bible" whose
sections 35 onward are a 136-subsystem particularization template (O001, O002, ...), each with its
own Intent/State contract/Acceptance Gate/Owner subsections. Copying all 136 into these artifacts
would be exactly the kind of unrequested bulk transcription the task explicitly warned against
("use its TOC/index and relevant implementation/gate sections rather than blindly copying").

Resolution: read the full TOC (all `#`/`##` headers), then read sections 17 (Production/QA/DoD),
23 (Master Task Matrix), 24 (Master Asset Register), and 33 (Final Definition of Done) in full,
since those are the sections that actually define what "done" means. QUALITY_GATES.json cites
section 33's 20-item checklist and section 17.5's visual scorecard by reference, not by copying
every one of the 136 subsystem templates.

## D3 — Discovered and prioritized the orphaned-asset finding over restating VISUAL_DEBT.md

VISUAL_DEBT.md lists 5 known issues (VIS-001 through VIS-006, with VIS-001/006/007 already Done).
None of them describe the fact that 333 of 361 exported GLB files have zero runtime call sites —
verified by exhaustively grepping every `assetLibrary.load()` / `assetUrl()` call site in `src/`
and finding exactly two, covering only the `world` and a single hardcoded `airframe` id.

Resolution: this is new, concrete, evidence-based information not present in the existing docs, so
it was surfaced prominently (ASSET_PROVENANCE.json, RISK-02, task ASSET-01) rather than folded
silently into a "matches existing visual debt" summary. It is explicitly framed as a scope decision
for a human/product owner (ASSET-01's recommended_model is Opus for the *decision*, not autonomous
code changes), not as something to fix during this audit.

## D4 — Did not re-run `npm run desktop:package` or deploy to a live HTTPS host

Both would produce real evidence but both mutate state outside repo scope in ways not requested
(writes `release/`, requires picking/paying for a host) and are long-running. STEAM_RELEASE.md's
existing "smoke-tested locally" claim is repeated in PRODUCT_REQUIREMENTS.json /
RELEASE_READINESS.json as `"working": "claimed_by_docs_only"`, not silently upgraded to a verified
PASS. Tracked as DESKTOP-02 / PWA-01 for a human to actually run.

## D5 — Did not attempt Lighthouse/axe or any device testing

No served build was running and no target device/emulator was available in this environment.
Accessibility, PWA-over-HTTPS, and device-coverage ship criteria are marked UNKNOWN, not PASS or
FAIL, and are the largest remaining blockers to any release claim (see RELEASE_READINESS.json).

## D6 — Five-level designed/implemented/working/polished/release-ready distinction

Applied consistently across PRODUCT_REQUIREMENTS.json per pillar:
- **designed**: specified in a doc, may have zero code.
- **implemented**: code exists addressing it.
- **working**: this audit's own command evidence (test/build) or an existing passing test
  demonstrates function.
- **polished**: meets the spec's own visual/QA bar — requires human/device review not available
  here, so almost every pillar is marked `"unknown"` rather than guessed.
- **release_ready**: meets RELEASE_READINESS.md's full ship criteria including production-host and
  real-device verification — correctly `false` for every pillar in this audit, since none of that
  verification has happened yet.

## D7 — `recommended_model: "human/external"` used deliberately in TASK_GRAPH.json

Several tasks (Steamworks account creation, legal/pricing decisions, physical device QA, git
history triage of user-owned uncommitted work) are not coding tasks a Claude model should be
assigned to execute unattended. Rather than force every task onto a Claude model to satisfy the
"recommended model" field, tasks that are genuinely human/vendor/device-bound are labeled as such.
This is more honest than inventing an agent capability that doesn't exist.
