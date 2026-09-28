# OdontoView Admin Analytics — Design

## Goal

Create a first-party administrative analytics panel inside OdontoView so an ADMIN can understand who is using the platform, how many people are active, where access comes from, which devices and pages are being used, and recent activity without depending on an external analytics product.

## Scope V1

The V1 must provide:

- Users online now, defined as sessions with activity in the previous 5 minutes.
- Unique users/sessions for today, previous 7 days, and previous 30 days.
- Total page views and a daily access trend.
- Approximate access location: country, state/region, and city when available.
- Logged-in identity when available: user id, name, email, and role (`DENTIST`, `UNIT_USER`, `ADMIN`).
- Anonymous/public shared-link traffic identified as anonymous rather than falsely assigned to a user.
- Current/recent route: `/viewer2`, `/dentista`, `/radiologia`, `/acesso-exame`, and other application paths.
- Device class: desktop, tablet, mobile; plus browser and operating system where derivable from the user agent.
- Traffic source: direct, referrer domain, and UTM source/medium/campaign when present.
- Last activity timestamp and approximate session duration.
- Rankings for most-viewed routes and highest-volume geographic regions.
- Admin-only route `/admin` with a clean dashboard consistent with the OdontoView visual system.

## Existing Project Fit

OdontoView already has a PostgreSQL database through Prisma and an existing `UserRole.ADMIN` enum value. Authentication uses JWTs containing `sub`, `role`, and `email`. The implementation must extend those existing primitives instead of introducing a parallel authentication or database stack.

The current frontend routes users based on role but does not yet include an ADMIN destination. This design adds an explicit ADMIN route and preserves existing dentist, radiology, patient-sharing, viewer, and implant-library flows.

## Architecture

### Data model

Add two Prisma models:

1. `AnalyticsSession`
   - One row per browser session.
   - Stores anonymous session id, optional authenticated user id, first seen, last seen, first/current route, referrer, UTM fields, device/browser/OS, approximate country/region/city, anonymized network fingerprint, and accumulated active duration.
   - Indexed for `lastSeenAt`, `startedAt`, `userId`, route, and geographic aggregation.

2. `AnalyticsEvent`
   - Append-only lightweight events tied to a session.
   - V1 event kinds: `PAGE_VIEW`, `HEARTBEAT`, `LOGIN`, `LOGOUT`.
   - Stores route, occurred time, and a small metadata JSON object where needed.
   - Indexed for time, session, type, and route.

No DICOM, patient clinical data, or study content is copied into analytics records.

### Collection flow

The web app owns a small analytics client that:

- Creates/persists a random browser session id in `sessionStorage`.
- Sends a page-view event when the SPA route changes.
- Sends a heartbeat no more frequently than once per 60 seconds while the tab is visible.
- Sends UTM/referrer and user-agent-derived context on initial session creation.
- Does not block navigation or Viewer rendering when analytics fails.

The API exposes a public ingestion endpoint accepting only a strict, rate-limited analytics payload. If a valid JWT is present, the API associates the session to the authenticated user. A missing or invalid token does not become an authentication error for anonymous analytics; it remains anonymous.

### Location and privacy

Railway supplies the client remote address through `X-Real-IP`. The API may use it transiently to derive approximate geography when a lookup mechanism is configured. The raw IP must not be stored permanently.

Persist only:

- approximate `country`, `region`, `city`, when available;
- a one-way HMAC fingerprint derived from the IP plus a server-side secret, for rough uniqueness/abuse control only.

If no geo lookup is configured, analytics still records the session with location fields as `null`. GPS/browser geolocation is explicitly out of scope for V1.

### Admin API

Add ADMIN-only endpoints:

- `GET /api/admin/analytics/overview?range=7d|30d`
  - onlineNow
  - uniqueToday
  - unique7d
  - unique30d
  - pageViews
  - dailySeries
  - topRoutes
  - topRegions
  - deviceBreakdown
  - sourceBreakdown

- `GET /api/admin/analytics/recent?limit=50`
  - recent sessions with identity, role, route, location, device, source, firstSeen, lastSeen, approximate duration, and online state.

Both endpoints require a valid JWT with `role === "ADMIN"`.

### Frontend Admin

Add `/admin` and route ADMIN users to it after login.

The first dashboard view contains:

- Four KPI cards: Online agora, Usuários hoje, Usuários 7 dias, Visualizações.
- Daily access trend chart.
- Top routes table.
- Geographic ranking.
- Device/source summary.
- Recent activity table showing user/anonymous, role, route, city/state/country, device, source, and last activity.
- Range toggle for 7 and 30 days where relevant.
- Auto-refresh of overview/recent data every 30 seconds while the page is visible.

No admin CRUD for users, billing, subscriptions, or permissions is included in this V1.

## Security and privacy constraints

- `/admin` is client-visible only as a convenience; the real authorization boundary is the API and every admin analytics endpoint checks `ADMIN` server-side.
- Analytics ingestion must reject oversized/unknown payload fields and normalize route/referrer/UTM strings.
- Raw IP addresses are never persisted.
- No precise GPS coordinates are collected.
- No patient names, study identifiers, DICOM metadata, or clinical content are sent through the analytics client.
- Analytics failures must never break authentication, uploads, Viewer, planning, sharing, or other clinical workflows.

## Operational behavior

- `onlineNow` means `lastSeenAt >= now - 5 minutes`.
- Heartbeat target interval is 60 seconds while the document is visible.
- Admin dashboard refresh interval is 30 seconds while visible.
- Session storage, not local storage, determines a browser session, so a fresh browser session creates a new analytics session.
- Anonymous sessions may later become associated with a logged-in user after a valid authenticated event from the same session id.

## Testing

Required automated coverage:

- Prisma/schema generation succeeds with the analytics relations/indexes.
- Public analytics ingestion accepts valid anonymous page views.
- Authenticated ingestion associates a session with the correct user.
- Invalid analytics payloads are rejected without exposing internals.
- ADMIN can read overview and recent activity.
- DENTIST and UNIT_USER receive 403 from admin endpoints.
- Online count uses the 5-minute window.
- Raw IP is not present in persisted analytics records or API responses.
- Frontend route logic sends ADMIN to `/admin` while preserving existing role routing.
- Admin page renders API-backed KPI and recent activity states without breaking the existing web build.

## Out of scope for V1

- Billing/subscription metrics.
- Funnels and revenue attribution.
- Session replay or screen recording.
- Keystroke/mouse tracking.
- Precise GPS location.
- Patient-level clinical analytics.
- External BI warehouse.
- GA4 as a required dependency.

## Success criteria

An authenticated ADMIN can open `/admin` and answer, from OdontoView itself: how many people are online, how many accessed today/7d/30d, which routes they use, approximate geographic origin, device/source mix, and who has been recently active when the visitor is authenticated — without storing raw IP or clinical data and without degrading Viewer behavior.