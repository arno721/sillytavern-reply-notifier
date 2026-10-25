# Native mobile notifications

## User request

Android and iOS must both use native OS notifications. The user should not need ntfy or a separate receiver app to use notifications on the device where SillyTavern runs.

## Existing-flow change

Keep the current successful-completion tracker and desktop behavior. Make mobile delivery explicitly use a scoped Service Worker and `showNotification`; never fall back to the unsupported `new Notification` constructor on Android/iOS. Add an explicit native enable operation that requests permission synchronously within the button gesture, then prepares the worker. Report denied/default permission, missing APIs, worker failures and iOS Home Screen requirements with actionable native setup instructions.

Make native notifications the primary UI, with Android and iPhone/iPad instructions and a clear native test button. iOS requires HTTPS, a compatible OS (16.4+) and a Home Screen web app. Retain ntfy only inside a collapsed advanced section for backwards compatibility; it is optional and disabled by default. Keep previews off by default and keep credentials out of synchronized settings.

## Execution and background scope

Local completion detection still requires the generating page to execute. A service worker does not keep SillyTavern generation running while its page is suspended or closed. The separate user question about background/lock-screen reception is pending; do not describe local notifications as a server Web Push implementation. No backend component or server restart is necessary for this existing-flow change. If background reception is explicitly requested, extend the architecture separately and state the actual generation/completion limitations.

## Verification

Use TDD for Android worker delivery, iOS standalone delivery, iPad detection, permission gesture ordering, worker-only failure paths, permission cancellation, and no external delivery unless explicitly enabled. Exercise the actual browser Service Worker in desktop and Android-shaped Chromium contexts, and settings/help in iPhone-shaped WebKit. Device-shaped browser automation is not physical device testing. Update README/version/changelog, obtain one fresh code review, run CI, publish v1.1.0, and update the installed extension when available through the existing user-authorized install workflow.
