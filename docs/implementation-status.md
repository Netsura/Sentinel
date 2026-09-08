# Implementation Status

## Current phase

Sentinel is in **Phase 9: SaaS features**, with the core path from Phase 1 through Phase 8 implemented in a working foundation. The product is not yet production-complete.

## Completed or working

- Phase 1: Nx monorepo, Next.js web, NestJS API, Prisma, PostgreSQL, Redis, Docker Compose
- Authentication: Argon2 passwords, JWT access tokens, rotating refresh sessions, logout, password reset, email verification state
- Workspace authorization: membership checks, OWNER/ANALYST/VIEWER roles, member administration, audit records
- Assets: domain, subdomain, and public IP validation; DNS TXT verification
- Scanning: BullMQ queue, separate scanner app, SAFE/NORMAL/AGGRESSIVE gates, cancellation, persisted stages
- Safe checks: DNS resolution, HTTPS availability, security headers, server disclosure
- Findings: severity, confidence, evidence, search/filtering, status changes, audit logging
- Risk: deterministic score calculation from scanner findings
- Real-time: authenticated WebSocket scan subscriptions and Redis progress events
- Reports: persisted JSON and CSV reports from completed scans
- Scheduling: daily/weekly/monthly repeat jobs with pause/resume/delete
- Notifications: persisted in-app notifications and scan-completion notifications
- Frontend: configurable API client, sign-in route, findings filters/status actions, reports/schedules screens, refresh-token retry, and dashboard/login Playwright coverage
- TLS: certificate handshake and expiry findings in the safe scanner path
- Scan history: workspace-scoped diff endpoint for new, resolved, changed, and persistent findings
- Scanner isolation: non-root image, dropped capabilities, read-only filesystem, tmpfs, CPU/memory limits
- Operations: `/api/health`, `/api/ready`, global rate limiting, migrations
- OpenAPI documentation and GitHub Actions CI validation
- Production Dockerfiles for web, API, scanner, plus Nginx and production Compose
- Dependency audit remediation with `npm audit` reporting zero vulnerabilities

## Remaining work

- Real email delivery adapter for verification and password reset
- TLS protocol/version analysis
- Controlled crawler, endpoint discovery, JavaScript/API discovery
- DNS/TLS/HTTP historical result storage beyond finding-level scan diffs
- Critical finding, score-drop, and finding-resolved notifications
- Notification email, Slack, Discord, and webhook adapters
- S3-compatible report storage and signed download URLs
- Integration tests with PostgreSQL, Redis, and BullMQ
- Full authenticated Playwright workflow against PostgreSQL, Redis, BullMQ, and scanner completion
- Production network egress policy for the scanner
- Structured logging, metrics, cloud deployment, and production scanner isolation
- AI explanations grounded in deterministic finding evidence
