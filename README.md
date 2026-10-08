# Dosvyazi (ДоСвязи)

A multifunctional group communication platform. This monorepo contains the browser UI, backend, tests and deployment configuration.

## Structure

- `apps/web/` - React and TypeScript browser client.
- `apps/api/` - ASP.NET Core API and SignalR events.
- `tests/` - integration and end-to-end tests.
- `deploy/` - Docker Compose, Caddy and service configuration.
- `docs/` - public technical documentation.
- [AGENTS.md](AGENTS.md) - development rules for contributors and AI agents.

The development foundation and two-user text slice are implemented: an English React workspace, registration/profile editing, communities, bounded invitations, membership/bans and persisted text messages, live updates and reconnect recovery. The controller API includes OpenAPI, PostgreSQL migrations and readiness checks. Voice and Gatherings follow in separate milestones. The architecture remains a modular monolith with PostgreSQL and separate self-hosted LiveKit for future voice workflows.

## Development

Prerequisites: .NET SDK 10.0.400, Node.js 22.22.2 (or compatible Node 24+), npm 10.9.7+, and Docker with a running Linux engine and Compose v2. Run commands from the repository root.

```powershell
npm ci
npm run setup
npm run check
npm run dev:database
npm run migrate:api
```

Start these in two separate terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Open [the development workspace](http://127.0.0.1:5173). The API listens on `127.0.0.1:5080`; browser requests use the Vite proxy on the same origin. PostgreSQL is bound only to `127.0.0.1:15432` by default. `npm run setup` creates an ignored `deploy/.env` with a random password and preserves existing configuration.

```powershell
npm run test:database
npm run install:browser
npm run test:e2e
```

See [development instructions](docs/development.md), [accounts](docs/accounts.md), [communities](docs/communities.md) and [messaging](docs/messaging.md) for configuration, contracts, checks and troubleshooting. This setup is for local development.

## Local Materials

The entire `.local/` directory is excluded from Git: `plans/` for working plans, `research/` for NIR materials, and `artifacts/` for reports and experiment results. It is not included in clones and needs a separate backup.

Markdown and DOCX files are not globally ignored: public documentation should remain trackable. Place private materials inside `.local/`. Git ignore rules do not prevent explicit `git add -f`.

## License

Original project code is distributed under [MIT](LICENSE). Third-party components retain their own licenses; notices will be added as dependencies are introduced.
