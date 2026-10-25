# Android and iOS native notification implementation

1. Add failing unit tests for phone worker delivery, permission gesture ordering, iOS standalone checks, iPad detection and mobile errors without constructor fallback.
2. Implement native enablement and worker-only mobile delivery while preserving desktop fallback and existing completion tracking.
3. Add failing browser coverage, make native setup primary, add Android/iOS instructions and fold optional ntfy controls into advanced settings.
4. Run unit, syntax and four-profile browser checks; inspect the rendered settings, update documentation and release version.
5. Obtain a fresh code review, address material issues, publish to GitHub, verify CI and update the installed extension through its existing manager.

The generating page must continue executing. This change does not add a server-side generator or Web Push backend. Browser device profiles validate integration and layout but do not establish physical Android/iOS compatibility.
