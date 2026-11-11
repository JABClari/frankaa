# Security

## Reporting a vulnerability

Please report security problems privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability** (https://github.com/JABClari/frankaa/security/advisories/new). Do not open a public issue.

Include what you found, the version, and how to reproduce it. You can expect a first reply within a week. Fixes are released as a patch version with a GitHub security advisory, and you are credited unless you ask not to be.

## Supported versions

Only the latest minor version receives fixes while frankaa is below 1.0.

## What frankaa does and does not do

- Zero runtime dependencies, and no install scripts.
- No `eval`, `new Function` or `innerHTML`. Text goes in with `textContent`, so captions and labels cannot inject markup. It runs under a strict Content Security Policy with Trusted Types.
- Photos load with `crossOrigin="anonymous"`. A cross-origin photo without CORS headers fails to load in WebGL rather than tainting the canvas, and the lightbox falls back to its CSS renderer and reports it through `onError`.
- Custom shaders (`effect: { fragment }` or `registerEffect`) run on the GPU in the page's own context. They have no network or DOM access, but a shader can still hang or crash a weak GPU driver. Only use shaders you trust, and never compile shader source taken from users or URLs.
- npm releases are published from GitHub Actions with npm trusted publishing (OIDC) and carry a provenance statement, so no long-lived npm token exists. Check it with `npm audit signatures`.

## Recommended repository settings (for maintainers)

- Branch protection on `main`: require a pull request, require the CI and CodeQL checks to pass, block force pushes and deletions, and include administrators.
- Require signed commits if all maintainers can sign.
- Turn on private vulnerability reporting, Dependabot alerts and security updates, secret scanning and push protection.
- Two-factor authentication for every maintainer on GitHub and npm (a security key or passkey where possible). On npm, set the package's publishing access to require 2FA and disallow tokens, and keep the trusted publisher limited to `release.yml`.
- Keep workflow permissions read-only by default (Settings, Actions, General) and pin third-party actions to a full commit SHA.
