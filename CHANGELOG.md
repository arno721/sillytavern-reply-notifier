# Changelog

## 1.1.0 — 2026-10-25

- Make Android and iPhone/iPad native OS notifications the primary setup; no ntfy receiver app is required.
- Prepare the scoped Service Worker during native enablement while preserving Safari's permission gesture.
- Use worker-only delivery on mobile, with actionable permission, activation and Home Screen errors.
- Add Android and iOS setup guides, including iPad and Android desktop-site detection for worker-only delivery.
- Keep optional ntfy controls in a collapsed advanced section without changing existing settings.
- Cover mobile native flows with unit tests and Android Chromium / iPhone WebKit browser profiles.
- Clarify that background generation and closed-page server Web Push are outside this client extension.

## 1.0.0 — 2026-10-25

- Initial SillyTavern extension with Traditional Chinese settings.
- Successful reply detection for streaming, normal replies, swipes, continuations and group batches.
- Native OS notifications through a scoped Service Worker, with a desktop fallback.
- Optional ntfy delivery for iOS/Android receivers and other subscribed devices.
- Privacy-first defaults, per-tab tokens, permission guidance and independent channel test buttons.
- Node tests and Chromium/WebKit integration tests; documented mobile and background execution constraints.
