# Implementation Status

## Current phase

Sentinel is a working SaaS foundation: authenticated workspaces, live scanning, billing hooks, and a production Compose stack. It is not yet a complete hosted product. The remaining gaps are history, notification channels, object storage, scanner egress, cloud hardening, and AI explanations.

## Completed or working

- Phase 1: Nx monorepo, Next.js web, NestJS API, Prisma, PostgreSQL, Redis, Docker Compose
- Authentication: Argon2 passwords, JWT access tokens, rotating refresh sessions, logout, CSRF double-submit, forgot/reset/verify pages, and SMTP delivery when `SMTP_URL` is set
- Workspace authorization: membership checks, OWNER/ANALYST/VIEWER roles, member administration
- Audited mutations: `withAudit()` writes the change and the audit row in one transaction
- Assets: domain, subdomain, and public IP validation; DNS TXT verification
- Scanning: BullMQ queue, isolated scanner app, SAFE/NORMAL/AGGRESSIVE profiles, cancellation, persisted stages, live WebSocket progress
- Scanner checks: DNS, TLS (certificate, protocol, cipher, legacy versions), HTTP headers, controlled crawler, endpoint/JS/API discovery, subdomain enumeration
- Worker idempotency: scheduled jobs reuse in-flight scans; completed/failed scans skip; findings replace rather than append
- Findings: severity, confidence, evidence, search/filtering, status changes, audit logging
- Risk: deterministic score calculation from scanner findings
- Real-time: authenticated WebSocket scan subscriptions and Redis progress events
- Reports: persisted JSON and CSV reports from completed scans
- Scheduling: daily/weekly/monthly repeat jobs with pause/resume/delete
- Notifications: in-app scan-completed, critical-finding, and score-drop events
- Billing: Stripe checkout, customer portal, signed webhooks, event-id idempotency, and workspace reconcile
- Frontend: live Overview/Assets/Scans/Findings/Reports/Schedules behind an auth gate
- Scan history: workspace-scoped finding diffs (new, resolved, changed, persistent)
- Scanner isolation: non-root image, dropped capabilities, read-only filesystem, tmpfs, CPU/memory limits
- Operations: `/api/health`, `/api/ready`, `/api/metrics`, global rate limiting, migrations
- OpenAPI documentation and GitHub Actions CI (build, unit/integration tests, Playwright Chromium, `npm audit`)
- Production Dockerfiles for web, API, scanner, plus Nginx and production Compose
- Dependency audit overrides for patched `multer` and `smol-toml`

## Remaining work

- `FINDING_RESOLVED` notifications (enum exists; nothing emits it yet)
- DNS/TLS/HTTP historical result storage beyond finding-level scan diffs
- Notification email, Slack, Discord, and webhook adapters
- S3-compatible report storage and signed download URLs
- Integration tests that exercise Redis, BullMQ, and a completed scanner job
- Playwright coverage for a verified asset through scan completion
- Production network egress policy for the scanner
- Structured logging, cloud deployment hardening, and HTTPS cookie/session handling
- AI explanations grounded in deterministic finding evidence
