# Steam release path

`PROJECT FLIGHT` now has an Electron desktop wrapper. It packages the built game as a
standalone application while preserving the browser/PWA build for web players.

The packaged macOS universal build has been smoke-tested locally with a clean, isolated player
profile: it loads through the stable `project-flight://game/` origin and exposes the first-run
onboarding, including keyboard, controller and pause controls. A prior restart check also
confirmed the saved onboarding state persists. The desktop shell intentionally does not register
the web service worker because all bundled assets are local and immutable.

## Local desktop verification

```bash
npm install
npm run desktop:run
npm run desktop:package
npm run desktop:package:win
npm run desktop:package:linux
```

The release scripts deliberately target macOS universal and Windows/Linux x64 by default;
these cover the expected Steam desktop audience. `desktop:package:mac:arm64` remains available
for a faster Apple Silicon-only local check.

Packaged output is intentionally written to `release/`, never `dist/`: `dist/` is the Vite
runtime payload that Electron includes in the application, while `release/` is disposable
SteamPipe-ready build output.

The desktop shell is intentionally sandboxed: Node.js is unavailable to the game renderer,
new windows and webviews are denied, browser permissions are denied, navigation is pinned to the
local game origin, and only explicit HTTPS links open in the system browser. The game payload
also ships with a restrictive content-security policy. Fullscreen is available through `F11` or
`Alt+Enter`.

## Steamworks handoff checklist

These items need a Steamworks partner account and cannot be truthfully completed from the
repository alone:

- Create the Steam app and obtain its App ID; never commit the App ID, partner credentials,
  depot credentials, signing keys, or SDK redistributables to this repository.
- Produce signed/notarized macOS and signed Windows artifacts from the package workflow.
- Define depots/branches (default, beta, staging), upload a tested build through SteamPipe,
  and configure Steam Cloud only after a save-conflict policy is implemented.
- Complete the store page: capsule art, screenshots from final gameplay, trailer, supported
  languages, price, age ratings, privacy/support/refund information, system requirements and
  controller disclosure.
- Confirm commercial rights for every shipped asset before submission. The model kit declares
  its geometry as original in `public/assets/models/README.md`; the release owner still needs to
  record the approved project licence and provenance/sign-off for textures, logo, audio and all
  marketing media.
- Validate the Steam Overlay, Steam Input, launch from a clean machine, offline launch, save
  persistence, update migration, crash recovery and all supported OS/device combinations.

## Release bar

Do not mark the game as released merely because it packages. The public build must pass the
repository gate in `RELEASE_READINESS.md`, real-device QA, Steam's build review, and the legal /
commercial checks above.
