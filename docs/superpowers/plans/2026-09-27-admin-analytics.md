# Admin Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a privacy-conscious, first-party OdontoView admin analytics dashboard that shows live/recent usage, traffic source, device mix, routes and approximate geography to ADMIN users only.

**Architecture:** Extend the existing PostgreSQL/Prisma stack with analytics session/event records; add a focused analytics router mounted by the API server; add a non-blocking SPA analytics client and a separate admin dashboard rendered by `AppEntry.jsx`. Keep analytics isolated from clinical data and preserve every current dentist/radiology/viewer flow.

**Tech Stack:** Express 4, Prisma 6/PostgreSQL, JWT, React, React Router, existing OdontoView CSS/build pipeline.

**Spec:** `docs/superpowers/specs/2026-09-27-admin-analytics-design.md`

## Global Constraints

- `onlineNow` means activity within the previous 5 minutes.
- Heartbeats run at most once per 60 seconds while the document is visible.
- Admin data refresh runs every 30 seconds while visible.
- Raw IP addresses are never persisted or returned.
- No GPS, patient names, study IDs, DICOM metadata or clinical content enter analytics.
- Missing/invalid auth on ingestion remains anonymous; ADMIN read endpoints require valid `role === "ADMIN"`.
- Existing `/dentista`, `/radiologia`, `/viewer2`, shared access, uploads and implant-library behavior must remain intact.

## Review Focus

- Invalid or oversized ingestion payloads must fail safely without affecting the SPA.
- Anonymous sessions that later authenticate must associate to the user without duplicating the browser session.
- Non-ADMIN JWTs must always receive 403 from admin analytics reads.
- Geo lookup absence/failure must produce null geography, not ingestion failure.
- Analytics network/API failures must never interrupt Viewer rendering or navigation.

---

### Task 1: Analytics persistence schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Test: Prisma generation in CI

**Interfaces:**
- Produces: `AnalyticsSession`, `AnalyticsEvent`, `AnalyticsEventType`, plus optional `User.analyticsSessions` relation.

- [ ] Add session/event models and indexes defined by the spec.
- [ ] Keep raw IP out of the schema entirely; store only `networkFingerprint` and nullable coarse geography.
- [ ] Run Prisma generate/schema validation and verify existing models still generate.
- [ ] Commit as `feat(admin): add analytics persistence schema`.

### Task 2: Analytics ingestion and admin API

**Files:**
- Create: `apps/api/src/analytics.js`
- Modify: `apps/api/src/server.js`
- Create: `apps/api/tests/analytics.test.js`

**Interfaces:**
- Produces: `createAnalyticsRouter({ prismaClient, jwtSecret, geoLookup?, now? })`.
- HTTP: `POST /api/analytics/events`, `GET /api/admin/analytics/overview`, `GET /api/admin/analytics/recent`.

- [ ] Write failing router tests for anonymous ingestion, authenticated association, invalid payload rejection, ADMIN reads, 403 for DENTIST/UNIT_USER, five-minute online window and no raw-IP exposure.
- [ ] Implement strict payload normalization, optional JWT association, HMAC network fingerprint, user-agent/device parsing and optional coarse geo lookup.
- [ ] Implement overview aggregations and recent-session projection without returning raw network identifiers.
- [ ] Mount the router before listening in `server.js` so production serves analytics without restructuring the existing large `app.js`.
- [ ] Run API tests and commit as `feat(admin): add analytics API`.

### Task 3: Non-blocking web analytics client

**Files:**
- Create: `apps/web/src/analyticsClient.js`
- Create: `apps/web/src/AnalyticsTracker.jsx`
- Modify: `apps/web/src/AppEntry.jsx`
- Create: `apps/web/src/analyticsClient.test.js` if the current web test runner supports focused unit tests; otherwise cover via build + smoke.

**Interfaces:**
- Produces: `trackAnalyticsEvent(type, route)` and `<AnalyticsTracker />`.
- Uses existing token key `odontoview_token` and a `sessionStorage` session id.

- [ ] Generate/persist a browser-session id in `sessionStorage`.
- [ ] Send `PAGE_VIEW` on route changes and `HEARTBEAT` every 60 seconds only while visible.
- [ ] Include route/referrer/UTM/user-agent context but no patient/study/clinical values.
- [ ] Swallow analytics failures so navigation/viewer operation is unaffected.
- [ ] Mount tracker from `AppEntry.jsx` for normal application routes, excluding dedicated test smoke routes where needed.
- [ ] Build web and commit as `feat(admin): collect first-party usage analytics`.

### Task 4: ADMIN route and dashboard UI

**Files:**
- Create: `apps/web/src/AdminDashboard.jsx`
- Create: `apps/web/src/admin-dashboard.css`
- Modify: `apps/web/src/AppEntry.jsx`

**Interfaces:**
- Produces: `/admin` rendering protected admin analytics UI.
- Consumes: `/api/admin/analytics/overview?range=7d|30d` and `/api/admin/analytics/recent?limit=50`.

- [ ] Route stored role `ADMIN` away from `/dentista` to `/admin` after the existing login flow lands there.
- [ ] Add KPI cards for online now, users today, users 7/30 days and page views.
- [ ] Add daily trend, top routes, top regions, device/source summaries and recent-activity table.
- [ ] Add 7/30-day toggle and 30-second visible-tab refresh.
- [ ] Redirect/deny client-side access when the stored role is not ADMIN while keeping server authorization authoritative.
- [ ] Verify responsive layout and web build, then commit as `feat(admin): add analytics dashboard`.

### Task 5: CI, deployment and production verification

**Files:**
- Modify CI only if current workflow does not already run API tests, Prisma generation and web build.

**Interfaces:**
- Produces: one tested branch HEAD ready for exact-commit Railway deployment.

- [ ] Run/verify API tests, Prisma generation and web build in GitHub Actions.
- [ ] Verify no regression in existing Viewer/implant smoke gates.
- [ ] Deploy a fresh Railway build from the exact successful branch HEAD (not snapshot redeploy).
- [ ] Confirm Railway deployment metadata reports that exact commit and SUCCESS.
- [ ] Verify `/admin` loads in production and admin APIs reject non-admin access.
