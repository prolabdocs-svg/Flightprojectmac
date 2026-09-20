# Release readiness — PROJECT FLIGHT

This is the release gate for a public PWA launch. It deliberately separates work that can be
verified in this repository from commercial decisions that need an owner outside it.

## Ship criteria

| Area | Exit condition | Evidence |
| --- | --- | --- |
| Core loop | A new player can complete tutorial → hangar → briefing → flight → results → retry/map without a blocked screen. | Manual smoke test on touch and keyboard. |
| Reliability | Production build succeeds; all automated tests pass; an unexpected render error offers recovery rather than a blank screen. | `npm test`, `npm run build`, recovery boundary. |
| Supply chain | No known high/critical vulnerability in the shipped or desktop build dependency tree. | `npm audit --audit-level=high`. |
| Saves | Progress survives reload and an older save migrates safely. | `src/save/save.test.ts`. |
| PWA | Installable manifest, service worker, shell cache, and a branded offline fallback all work over HTTPS. | Mobile device test after deployment. |
| Accessibility | Keyboard path, visible focus, readable text-size setting, reduced motion and color-blind alternatives work; target WCAG 2.2 AA. | Manual audit plus automated accessibility scan. |
| Device coverage | Verify iOS Safari and Android Chrome in landscape at low/mid/high tier devices. | Release test matrix below. |
| Content | Every advertised mission, upgrade, reward and region is completable with the starter build or its disclosed unlock path. | Content-validation and campaign playthrough. |

## Mandatory pre-publication work

- Select the commercial model and price; publish truthful storefront copy and refund/support contact.
- Add privacy policy, terms, age rating and jurisdiction-specific consumer disclosures for the actual release territories.
- Test the production HTTPS host, not just localhost: install, update, offline restart, save migration and cache upgrade.
- Run a lightweight crash/error monitoring solution only after selecting a vendor and publishing the related privacy disclosure.
- Perform a real-device QA pass: iPhone Safari, Android Chrome, desktop Chrome/Edge, touch controls, keyboard, gamepad, offline and low-memory sessions.
- Run Lighthouse and an accessibility scan on the deployed build, then manually inspect the flight HUD and virtual sticks with keyboard and screen reader support.

## Release command gate

```bash
npm test
npm run build
npm audit --audit-level=high
git diff --check
```

Do not claim WCAG conformance, performance scores or public-sale readiness until the production-host and real-device checks above have been recorded.
