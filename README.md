# Axiom platform

Authoritative NestJS/Fastify API and worker platform for Axiom. It is a TypeScript modular monolith with organization-scoped PostgreSQL ownership.

The sole product, architecture-decision, implementation-status, and roadmap authority is [the master SRS](../shipmind/SRS.md). Read [AGENTS.md](AGENTS.md) for platform working rules. This README contains local operation only.

## Environment

The local defaults are intentionally restricted to the Docker `axiom` database on `127.0.0.1:54329`. Copy `.env.example` only when overriding defaults, and never commit credentials or `.local/` session files.

## Start locally

```bash
pnpm install
pnpm db:up
pnpm db:migrate
pnpm auth:local-session
pnpm dev
```

The API listens on `http://127.0.0.1:4100`; OpenAPI is available at `/api/openapi.json`.

Start the source-analysis worker separately when testing durable ingestion:

```bash
pnpm dev:worker
```

The local session command:

- refuses non-local and non-`axiom*` databases;
- stores only the SHA-256 token hash in PostgreSQL;
- revokes the previous local-owner session;
- writes the raw token to ignored `.local/session-token` with mode `0600`;
- creates no external identity, provider, billing, connector, or cloud side effect.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:providers
pnpm test:db
pnpm eval:tickets
pnpm build
```

Database integration tests are restricted to `axiom_test*` databases. Migration forward/rollback verification must use a disposable test database, never the local main database.

## Local utility commands

```bash
pnpm worker:once
pnpm billing:local-provision
pnpm billing:local-webhook -- --event-id=fixture-example
pnpm models:local-provision
pnpm start
pnpm start:worker
```

The billing webhook command previews by default. Hosted model adapters, commercial subscription providers, Jira/Trello publication, repository writes, and AWS deployment remain disabled until their master-SRS gates pass. No command in this repository deploys to Vercel or creates AWS resources.

## Migration ownership

New commercial database migrations belong here. The legacy web repository retains older migrations only as migration input. Do not generate a new Drizzle migration from an incomplete mapped schema; first verify that every affected canonical table is represented and test forward and rollback behavior on a disposable database.
