# AGENTS.md

## Mission

Build Axiom's authoritative Node.js TypeScript API and worker platform as a secure, organization-scoped modular monolith.

The sole product, architecture-decision, implementation-status, and roadmap authority is `../shipmind/SRS.md`. This file contains platform working rules only.

## Rules

- Keep TypeScript strict and validate external input and model output at runtime.
- Keep domain logic independent of NestJS controllers, provider SDKs, queues, databases, and infrastructure implementations.
- Version the HTTP API under `/api/v1` and maintain reviewed OpenAPI compatibility.
- Deny organization access by default and require organization scope at application and repository boundaries.
- Store only hashes of opaque session tokens. Browser sessions use host-only `HttpOnly`, `Secure`, `SameSite=Strict` cookies through the web/BFF; never use browser storage for session credentials.
- Every protected NestJS route must declare a permission; only explicit `@Public()` endpoints bypass the global access guard.
- Security-sensitive actions must append immutable audit events without raw tokens, credentials, or customer content.
- Use durable jobs for AI, connector, and verification work; never depend on a browser request remaining open.
- Require approval, idempotency, audit, and transactional outbox records for external side effects.
- Never fabricate provider outcomes, evidence, costs, or verification results.
- Never deploy to Vercel. Do not create AWS or other billable resources without explicit user authorization.
- Keep the platform a modular monolith until the measured extraction triggers in the master SRS justify a network service and the SRS decision register is updated.

## Verification

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` for every foundation change.
