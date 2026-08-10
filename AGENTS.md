# AGENTS.md

## Mission

Build Axiom's authoritative Node.js TypeScript API and worker platform as a secure, organization-scoped modular monolith.

The sole product, architecture-decision, implementation-status, and roadmap authority is `../shipmind/SRS.md`. This file contains platform working rules only.

## Rules

- Apply KISS and YAGNI: build the smallest complete capability required by the current SRS and do not introduce a service, provider, flag, abstraction, or extension point without a current caller or an SRS-backed extraction trigger.
- Apply DRY by the Rule of Three: extract the narrowest shared policy or mechanism after three equivalent implementations; keep coincidentally similar domain behavior separate.
- Apply single responsibility and dependency inversion: domain and application policy define interfaces, while NestJS, PostgreSQL, model providers, queues, and other adapters depend inward and translate at the boundary.
- Keep one source of truth for API contracts: authoritative Zod schemas generate the reviewed OpenAPI artifact; controllers, tests, and downstream clients must not maintain handwritten copies of request or response fields.
- Prefer cohesive bounded-context modules to generic helpers or arbitrary file-size rules. Split a module when it has independent reasons to change or crosses an ownership boundary.
- Fail closed at every trust boundary and cover denial, malformed input, stale concurrency, replay, organization isolation, and provider failure with regression tests.
- Put mechanically checkable architecture rules in active lint, contract, migration, or CI checks; a prose rule without a fitness check is advisory only.
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

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, relevant contract/provider/database checks, and `pnpm build` for every foundation change.
