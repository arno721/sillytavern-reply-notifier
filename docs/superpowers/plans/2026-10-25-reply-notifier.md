# Reply Notifier Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the plan inline. The user authorized building and publishing the extension; proceed through implementation and verification in this session.

**Goal:** Publish a tested SillyTavern reply completion notification extension for desktop and mobile receivers.

**Architecture:** A completion state machine feeds independent native and opt-in ntfy transports. A narrowly scoped worker enables persistent native notifications without changing the host application.

**Tech Stack:** Browser ES modules, Service Worker, Node test runner, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-25-reply-notifier-design.md`

## Global Constraints

- No production runtime dependencies or server plugin requirement.
- Native notifications need permission and a secure context; iOS native needs a Home Screen web app.
- No external notification delivery by default; previews default off; tokens are per-tab only.
- Generating pages must be able to execute to detect completion; state platform limitations honestly.
- Do not await network delivery inside SillyTavern event handlers.

## Review Focus

- An ended event preceding the received event, including a stop in between: never announce a cancelled reply.
- A stream error emits an assistant message: never report it as a successful completion.
- A chat change, group batch or regeneration: notify the intended reply once and clear stale state.
- Custom ntfy base paths, Unicode and HTTP failures: preserve valid paths/text without leaking secrets.
- Worker installation failure, pre-existing host worker or missing browser APIs: keep settings and the alternate notification channel usable.

### Task 1: Completion state and privacy

**Files:** `core.js`, `tests/core.test.js`, `package.json`.

**Interfaces:** `normalizeSettings(value)`, `createPayload(message, settings, url)`, and `CompletionTracker({ getContext, getSettings, onComplete, schedule, cancel })` with `start`, `receive`, `end`, `stop`, `reset`, `groupStart`, `groupEnd`.

- [x] Write tests for event ordering, stops, stream errors, quiet/dry-run/impersonation, groups, chat changes, swipes, defaults and preview privacy.
- [x] Run `node --test tests/core.test.js`; expected failing assertions for absent behavior.
- [x] Implement the state machine and formatting; run the same command and expect all tests passing.
- [x] Commit the independently tested core.

### Task 2: Native and ntfy delivery

**Files:** `notifications.js`, `service-worker.js`, `tests/notifications.test.js`, `tests/service-worker.test.js`.

**Interfaces:** `NativeNotifier` provides `status()`, `requestPermission()` and `send(payload)`; `sendNtfy(settings, token, payload, options)` and `deliverNotification({ settings, token, payload, native, fetchImpl })` return explicit channel results. Worker click handling only opens same-origin HTTP(S) URLs.

- [x] Write failing tests for permission failures, worker fallback, ntfy base paths/Unicode, endpoint validation, HTTP errors, timeouts, token headers and independent delivery.
- [x] Run `node --test tests/notifications.test.js tests/service-worker.test.js`; inspect expected failures.
- [x] Implement transports and click handling; run `npm test` and expect all tests passing.
- [x] Commit the independently tested delivery channels.

### Task 3: Installable UI and browser integration

**Files:** `manifest.json`, `index.js`, `ui.js`, `settings.html`, `style.css`, `tests/browser/*`, `playwright.config.js`.

**Interfaces:** The entry point reads `SillyTavern.getContext()`, installs synchronous event handlers, mounts settings into `#extensions_settings`, saves preferences through `saveSettingsDebounced`, and disposes listeners on disable.

- [x] Write browser tests for the settings drawer, persistence, actual worker activation/notification, generation event wiring, channel tests, secure-context guidance and chat cancellation.
- [x] Run `npm run test:browser` and observe missing extension/UI failures.
- [x] Implement the adapter and responsive settings; run unit and browser suites and inspect the browser output.
- [x] Commit the installable extension.

### Task 4: Documentation, review and publication

**Files:** `README.md`, `CHANGELOG.md`, `LICENSE`, `.github/workflows/test.yml`, `.gitignore`.

- [x] Document installation by GitHub URL, all five platforms, ntfy setup, privacy, HTTPS/iOS constraints and generating-page suspension limits. Clearly label physical-device checks as pending.
- [x] Run unit and browser tests, syntax checks, package validation and whitespace checks; inspect all output.
- [x] Obtain a fresh code review using the requesting-code-review skill and address important findings with regression tests.
- [x] Publish the repository under `arno721/sillytavern-reply-notifier`, verify its default branch and installable manifest, and create a tagged release.

## Execution record

Task status and verification evidence are recorded here as each task completes.

- Task 1: RED missing `core.js`, then GREEN `node --test tests/core.test.js`: 25/25 passing. Privacy defaults and both streaming event orders are covered.
- Task 2: RED missing transport/worker modules, then GREEN `npm test`: 56/56 passing. ntfy tests use a real local HTTP server only; no third-party notifications were sent.
- Task 3: Browser RED missing settings UI, then GREEN `npm run test:browser`: 15 passed, 1 intentionally skipped (WebKit native OS permissions). Browser testing exposed an illegal `clearTimeout` receiver; the browser cancellation regression was RED before changing the default callback binding and GREEN afterward. Chromium's legacy headless shell reports denied notification permission despite granted CDP permissions; switching the test runner to the full Chromium channel verified actual worker notifications without mocking the notification API.
- Task 4 (pre-review): `npm test` 56/56, `npm run check` passes, `git diff --check` passes. Documentation distinguishes automation from actual-device verification. GitHub Actions release tags were queried from the official action repositories.
- Final review: Independent reviewer identified two Important findings and no Critical or deferred Minor findings. Both were reproduced with failing assertions before fixes.
- Final: fixed repeated native notifications replacing the first — distinct native tags, unit assertion and actual Chromium notification-count regression RED→GREEN.
- Final: fixed stale failed-stream state suppressing a later successful non-streamed reply — capture the prior processor identity and ignore it for the new session; both stale failure and current failure cases covered RED→GREEN.
- Final verification: `npm test` 58/58; `npm run test:browser` 15 passed / 1 intentionally skipped; `npm run check` and `git diff --check` passed. No unresolved review findings. Screenshot inspected at `docs/images/settings.png`.
- Publication: public repository https://github.com/arno721/sillytavern-reply-notifier with default branch `main`, MIT license and accessible root manifest. GitHub Actions run https://github.com/arno721/sillytavern-reply-notifier/actions/runs/40191158973 succeeded for Windows/macOS/Linux unit tests and Chromium/WebKit browser integration, at code commit `1c92d1a50e0670a7165199f3aca6d11df0438f24`.
- Release: https://github.com/arno721/sillytavern-reply-notifier/releases/tag/v1.0.0 published (not a draft/prerelease), including the no-build installation ZIP. Actual iOS/Android device checks and full-host SillyTavern end-to-end validation remain explicitly outside this delivery's verified test scope, as documented in README.
