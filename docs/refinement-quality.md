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
| Q2. Perceived performance | Measure the existing feed, albums, viewer, and Reels under controlled latency; compare request counts, time to useful photo, layout shifts, and media decode; eliminate avoidable work and preserve photo quality. Keep bounded loading and private-cache rules. | Planned |
| Q3. Visual consistency | Audit existing screens in light/dark mode; standardize typography, spacing, actions, dialogs and feedback using existing tokens; remove duplicate visual affordances without removing their functions. Review mobile and desktop screenshots. | Planned |
| Q4. Accessibility and ease of use | Check keyboard and screen-reader names, focus, larger text, contrast, reduced motion, touch targets, simple language and error states. Test with a family member unfamiliar with the app when available. | Planned |
| Q5. Invitation and return journey | Exercise existing one-time links, geometric QR verification, explicit redemption, expired/reused links, Home Screen installation, and session return. Verify no uninvited user can read protected content. No new account system. | Planned |
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

### Remaining boundaries

- Chromium viewport simulation is not physical Safari, installed PWA, or a
  hardware notch/gesture test. Keep those explicit checks open.
- The first audit covers six primary views/menus, not every admin screen,
  modal or failure state. Do not declare the entire epic complete.
- The previous release build passed Linux verification. Earlier Windows
  media-test failures are separate from the UI changes; do not suppress them
  or skip production verification.
