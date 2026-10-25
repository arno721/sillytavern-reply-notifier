# SillyTavern Reply Notifier

## Intent and scope

Create an installable, open-source SillyTavern UI extension that sends an OS notification when an assistant reply finishes. Publish it in `arno721/sillytavern-reply-notifier`. The requested receiver platforms are iOS, macOS, Windows, Linux and Android. Use Traditional Chinese for the settings and primary README.

## Design

Use a dependency-free browser extension, with a native notification channel and an optional ntfy channel. Native desktop notifications need permission and a secure context (HTTPS or loopback). Prefer a narrowly scoped extension-owned Service Worker on mobile; retain the desktop Notification constructor as a fallback. Do not take over SillyTavern's root worker or cache/intercept requests.

iOS native web notifications require a supported iOS version, HTTPS and a Home Screen web app. Provide ntfy as the documented iOS/Android remote receiver route. The user explicitly enables ntfy and supplies their server/topic. Native and ntfy can be used together. Never send anything to a third party by default. No server plugin is required.

This is a client-side completion detector. If the device suspends or closes the only generating SillyTavern page, it cannot detect completion or send a notification until that page executes again. A worker is not a background generation engine. For phone lock-screen delivery via ntfy, keep the generating page active on another device. Document APNs/upstream configuration for self-hosted ntfy and do not promise immediate iOS delivery from an unconfigured server.

## Completion behavior

Use `SillyTavern.getContext()` with `eventTypes` / `event_types` compatibility. Observe generation start, message received and generation ended. Wait for both an eligible assistant message and the end of generation, regardless of their order. Settle briefly to allow a subsequent stop event to cancel an earlier end event. Suppress quiet generations, dry runs, impersonation, greetings, user/system/empty messages, cancelled/failed streams and events from a chat that has changed. Clear candidates on stop or chat change. Coalesce a group generation into one notification on group-wrapper completion. A successful swipe/continue may notify again.

The observer must never await network delivery inside SillyTavern's event emitter. Transport errors must not interrupt chat generation. Each channel reports its result independently and requests have a timeout.

## Settings and privacy

Persist ordinary settings in SillyTavern's extension settings. Include master enable, native enable, only notify when the tab is hidden/unfocused, opt-in reply previews, ntfy enable/server/topic, permission and channel status, and explicit native/ntfy test buttons. Keep the optional ntfy token in per-tab session storage, not synchronized SillyTavern settings. Default previews off, native on, ntfy off, notify while focused on (so the basic feature is visible immediately).

Generate a cryptographically random ntfy topic on request. Explain that public topic names are access secrets and that previews send reply text to the selected server. Payloads use UTF-8 JSON to support Chinese. Trim URL fragments/query parameters from notification click URLs, and validate remote endpoints as HTTP(S) without embedded credentials or queries/fragments. Never log tokens, topic URLs or reply text on failures.

## Files and validation

`core.js` owns settings, preview formatting and completion state; `notifications.js` owns native/ntfy delivery; `service-worker.js` owns notification clicks; `ui.js`, `settings.html`, `style.css` own settings; `index.js` connects SillyTavern. Add manifest, MIT license, README, a changelog and GitHub Actions.

Use Node's test runner for completion order, cancellation races, stream failures, group batches, preview privacy, endpoint validation, HTTP errors/timeouts and independent channel delivery. Use Playwright with a local SillyTavern context fixture for UI persistence, actual Service Worker registration/showNotification, HTTP permission guidance, event wiring and notification click handling. Browser fixtures are integration tests, not claims of testing physical devices. Publish only after the suite and a fresh code review pass. Record physical-device verification as pending in documentation.

## Sources inspected

- https://docs.sillytavern.app/for-contributors/writing-extensions/
- https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js
- https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js
- https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/group-chats.js
- https://webkit.org/blog/13878/
- https://docs.ntfy.sh/publish/
- https://docs.ntfy.sh/config/#ios-instant-notifications

The upstream release package inspected on 2026-10-25 reports version 1.19.0.
