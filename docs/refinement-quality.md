# Foldergram — Refinement & Quality

Status: active · Feature freeze

Production baseline: `32f720ac137c23d93bf73c31db40ac3b19a50499`

## Outcome

Make the existing private photography experience quick, calm, readable, reliable,
and intuitive for the whole family. Keep the four primary destinations (Home,
Albums, Search, Favorites), existing stories, Reels, comments, collections, print
lists, recaps, and slideshow. Do not add a new destination, account workflow,
database schema, dependency, or feature merely to satisfy this epic.

Each story should record the affected existing journey, before/after evidence,
accessibility and regression checks, and any device-specific validation still
needed. Use a synthetic test gallery, not private family photographs, for
shareable screenshots and performance fixtures. Production updates require the
existing exact-revision Linux build gate and the private deployment runbook.

## Stories

| Story | Scope and acceptance criteria | Status |
| --- | --- | --- |
| Q1. Mobile interaction and layout | Audit phone and desktop navigation; all existing controls remain reachable in portrait and landscape; no horizontal document overflow; safe-area-aware header/nav and overlays; keyboard focus remains coherent; gesture interactions preserve existing photo/reel behavior. Test installed Safari on a real iPhone separately. | In progress |
| Q2. Perceived performance | Measure the existing feed, albums, viewer, and Reels under controlled latency; compare request counts, time to useful photo, layout shifts, and media decode; eliminate avoidable work and preserve photo quality. Keep bounded loading and private-cache rules. | In progress |
| Q3. Visual consistency | Audit existing screens in light/dark mode; standardize typography, spacing, actions, dialogs and feedback using existing tokens; remove duplicate visual affordances without removing their functions. Review mobile and desktop screenshots. | Planned |
| Q4. Accessibility and ease of use | Check keyboard and screen-reader names, focus, larger text, contrast, reduced motion, touch targets, simple language and error states. Test with a family member unfamiliar with the app when available. | Planned |
| Q5. Invitation and return journey | Exercise existing one-time links, geometric QR verification, explicit redemption, expired/reused links, Home Screen installation, and session return. Verify no uninvited user can read protected content. Keep named identities and support independently revocable device sessions and self-service device linking. | In progress |
| Q6. Reliability and release hygiene | Check source outage recovery, retry behavior, session revocation, service worker cache/update, actual production release build, database backup and rollback. Preserve the existing private gateway and tunnel restrictions. | Planned |

## First audit (Q1)

The baseline browser audit is based on the production source SHA above with
synthetic fixture media and named-family API responses. It exercises Home,
Albums, an album, Favorites, Search, and the More popover at 390×844, 320×568,
and 1440×900. Eighteen screenshots were captured in the ignored local
`client/test-results/refinement-baseline/` directory. The initial dark-mode
fixture accidentally reapplied the light preference; the regression capture
must verify the actual document theme before taking screenshots.

Baseline More panel measurements (CSS pixels):

| Viewport | Panel bottom | Content vs. viewport height | Horizontal overflow |
| --- | ---: | --- | --- |
| 390×844 | 406.6 | 345 / 345 | None |
| 320×568 | 422.6 | 361 / 361 | None |
| 1440×900 | 422.6 | 353 / 353 | None |

The initial keyboard Tab reached Reels from More in all three viewports.
Source inspection showed the disclosure could stay visible when focus moved
outside it. Keep it non-modal: dismiss when focus leaves the trigger and
panel, restore focus on Escape, dismiss when the surrounding navigation
becomes inert. Use safe-area-aware header and navigation padding, contain
menu scroll, preserve compact landscape access, increase bottom-nav labels,
and ensure the existing notification actions have 44px minimum targets.

The Playwright regression passed after the changes. It verified the actual
light/dark document theme, Escape focus restoration, Shift+Tab dismissal
without stealing focus, no horizontal overflow on the audited views, and
reachable sign-out within a 667×375 landscape viewport. It captured 19 updated
screenshots under `client/test-results/refinement-after/`. The production
client build also passed. Q1 remains open for photo-viewer gesture, safe-area
hardware and installed PWA checks.

## Photo-viewer interaction pass (Q1)

Two focused regression tests failed on the previous source revision: the
modal prevented default Ctrl-wheel zoom and navigated on a touch swipe
when the visual viewport was already magnified. The viewer now leaves
modified wheel input and magnified viewport gestures to the browser,
cancels pending swipe state on multi-pointer input, image changes and
unmount, and avoids wheel navigation behind an open family details panel.
Carousels likewise ignore navigation gestures while magnified. Existing
ordinary swipe navigation, previous/next controls and carousel interactions
are preserved.

The 390×844 Chromium browser journey opened a photograph in a scrolled
24-photo synthetic album, verified an unconsumed Ctrl-wheel event, swiped
to the next post, simulated its source becoming unavailable, and closed
the viewer back to the original album. Both the exact scroll position
and focus on the original thumbnail were restored. An explicit close
control remains available during source outages and failed/loading states.
The screenshot is stored under the ignored `client/test-results/refinement-viewer/`
directory. This is a simulated browser journey, not a physical pinch test.

Native browser zoom is retained; no new custom zoom controls or gesture
engine were introduced. Adjacent-photo preload and network measurements
belong to Q2; verify real-device pinch/pan, safe areas and installation
before marking Q1 complete.

## Startup payload and idle network pass (Q2)

The baseline (`4d0fa0d`) and revised build were measured with the same
390×844 Chromium fixture, 100 ms artificial feed-response delay, disabled
service worker and fresh browser context. The audit logs resource timing
for JavaScript loaded by the first usable photo, and counts requests to
the source-status endpoint over a simulated 6.2-second hidden interval.

| Metric | Before | After |
| --- | ---: | ---: |
| Startup JavaScript decoded bytes | 1,371,981 | 1,153,344 |
| Startup JavaScript encoded bytes | 387,889 | 339,693 |
| Source-status requests while hidden | 3 | 0 |
| Time to loaded fixture photo (single run) | 2,105 ms | 1,471 ms |

Defer Settings, Trash, Places (directory and detail), and the shared
folder/post routes using Vue Router's native lazy imports. Keep the
frequently used family routes eager. Skip scheduled source polling while
hidden; focus and visibility events refresh the current protected state,
and manual Retry still works. Visible polling retains its existing
two-second interval and request deduplication.

The browser regression sets a decoded startup JS budget of 1,250,000 bytes
and checks zero hidden source-status requests and resumed polling. The
payload measurements are controlled local evidence, not a claim about
real cellular load times; the timing sample is not a statistical benchmark.

Private media and API no-store headers and service-worker exclusions are
unchanged. Speculatively prefetching private previews that cannot be cached
could simply duplicate transfers; defer that work until a measured
privacy-preserving approach is justified. Continue Q2 with viewer loading,
Reels and real device/cellular measurements. No photo-resolution change.

## Feed media scheduling pass (Q2)

The 390×844 Chromium fixture uses 18 two-photo portrait carousels with
distinct preview URLs and private no-store responses. After the first
photo is loaded and an 800 ms observation window, the baseline
(`55e140f`) requested all 18 initial carousel previews. After changing
the Home carousel loading policy, it requested five: 13 fewer immediate
preview requests (72% fewer in this fixture). The browser can vary its
native lazy-load distance by device and connection.

Feed carousels use native lazy image loading and visible video loading;
fullscreen viewer and shared-post carousels retain eager loading.
The regression verifies that the last offscreen preview was not
requested initially, then scrolls to that carousel and advances its
slide successfully. The previous startup-budget and viewer-outage tests
also passed. Preview URLs, photo resolution, existing video controls,
authorization and cache policies are unchanged. The test measures
request counts, not real photo bytes or cellular timings.

## Family device linking and durable sessions (Q5)

The revised flow keeps the existing named, passwordless identity and
adds More → Devices & sign-in on the external HTTPS gallery. A signed-in
viewer explicitly creates a single-use link or verified QR code, then
accepts it on the other device. No member identifier can be supplied by
the caller. The link expires within ten minutes and requires the issuing
session to remain active. Logout, revocation, generation changes,
expiration, reuse, and replacement invalidate it. Administrator
invitations remain separate and expire after seven days.

New family sessions have a fixed 365-day maximum lifetime, distinct
random nonces, host-only Secure/HttpOnly cookies, and independent logout.
The existing persistent ended-session record prevents replay of a signed-
out family cookie for its remaining lifetime. Earlier sessions retain
their original expiry. The administrator can revoke a member and all
their devices. Favorites and comments follow the member identity;
collections remain browser-local.

Targeted family-access, external-ingress, and notification tests passed,
including identity reuse, link expiration/replacement/replay, logout
replay denial, and preserving another signed-in device. The 390×844
Chromium fixture verified explicit issuance, locally decoded QR rendering,
the welcome screen, explicit redemption, and return on reload. The
startup budget still passed (1,157,386 decoded JS bytes). These tests
use disposable databases and mocked browser credentials.

Remaining Q5 work: physical iPhone camera scans, Home Screen session
storage, and actual passkey synchronization/recovery with Apple Passwords
or other credential providers. Automatic session renewal is not included.

### Individual device management

Migration 000018 adds a session inventory containing only a cookie hash,
opaque public ID, member, authentication generation, coarse platform,
first observed time and expiration. New sessions are recorded at issuance;
existing signed sessions are recorded when they return to auth/status.
No IP address or raw user agent is retained. Family members manage their
own sessions under More → Devices & sign-in. The administrator can expand
Devices on an existing member in Family access. Disconnect revokes only
the selected session and its push subscriptions; pending links issued
by that session cannot be redeemed. Current-device logout remains the
existing Sign out action. Old devices that have not yet returned will
not appear in the inventory; member-wide revoke still covers them.

The targeted server suite (family, external ingress, push, devices,
migration bootstrap) passed 27 tests. Existing member-wide revocation
and generation rotation continue to invalidate all credentials.

### Passkey recovery

Migration 000019 adds public WebAuthn credentials, with counter, backup
state, creation and last-use metadata, bound to the named family member,
authentication generation and configured external HTTPS origin.
SimpleWebAuthn server 14.1.0 and browser 14.0.0 are pinned. Enrollment
requires a currently signed-in named viewer, explicit user action and
user verification. Authentication uses discoverable credentials, so
no public member list, email, or password is needed. A random, host-only
Secure/HttpOnly challenge cookie binds a five-minute, single-use server
challenge to the browser; registration also binds to the issuing session.
Both ceremonies verify the exact origin and RP ID. Challenge state is
bounded in memory and may be lost on restart; retry is safe.

The family Devices & sign-in dialog has passkey setup and removal. The
external welcome screen offers passkey sign-in when supported, alongside
invitations. Admin Family access → Devices includes passkey removal.
Removing a passkey disables future sign-in with that credential, including
synced copies, but does not delete it from the provider or revoke existing
browser sessions. Disconnect those separately. Member revocation or auth
generation rotation invalidates all associated credentials and sessions.
The server stores no biometric data or private key. Browser credentials
can be synchronized only when the user's provider supports it.

The targeted cryptographic test uses genuine P-256 assertions and none
attestation, exercises rejection of wrong origin, missing user
verification, invalid signatures, mismatched identity, missing/replayed
challenge and removed credentials. A separate Chromium virtual
authenticator browser test at a synthetic HTTPS origin exercises actual
browser enrollment and authentication with mocked server endpoints.
The startup budget, device linking and invite redemption regressions
also passed (four browser tests). Physical Safari and synchronized
credential-provider behavior still need testing. If no usable passkey
or session remains, the owner can reissue an invitation for the same
member. Rollback must suspend external access and rotate auth secrets
before an older build that does not enforce current revocation rules.

### Remaining boundaries

- Chromium viewport simulation is not physical Safari, installed PWA, or a
  hardware notch/gesture test. Keep those explicit checks open.
- The first audit covers six primary views/menus, not every admin screen,
  modal or failure state. Do not declare the entire epic complete.
- The previous release build passed Linux verification. Earlier Windows
  media-test failures are separate from the UI changes; do not suppress them
  or skip production verification.
