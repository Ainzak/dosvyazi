# Development foundation

The first milestone provides a responsive English status workspace and an ASP.NET Core controller API connected to PostgreSQL through EF Core/Npgsql. It does not yet provide sessions, communities, messaging, SignalR subscriptions, voice, domain tables or migrations. The UI identifies later workflows explicitly.

## Toolchain and dependency compatibility

Exact direct npm versions and transitive integrity hashes are in `package.json`, `apps/web/package.json` and `package-lock.json`. NuGet dependencies use exact project references and `packages.lock.json` in each project. `global.json` selects SDK 10.0.400 with same-feature-band patch roll-forward; `.node-version` records Node 22.22.2. The official PostgreSQL image is pinned by tag and digest in `deploy/compose.dev.yml`.

| Component | Selected version | Compatibility source |
| --- | --- | --- |
| React / React DOM | 19.3.0 | [React versions](https://react.dev/versions) |
| Vite / React plugin | 8.3.3 / 6.1.2 | [Vite Node requirements](https://vite.dev/guide/); published plugin requires Vite 8 |
| TypeScript / typescript-eslint | 6.0.3 / 8.71.1 | [typescript-eslint supported versions](https://typescript-eslint.io/users/dependency-versions/); published peer range is below 6.1 |
| React Router (Declarative Mode) | 8.4.0 | [Declarative installation](https://reactrouter.com/start/declarative/installation); published peers require React 19.2.7+ and Node 22.22+ |
| TanStack Query | 5.104.1 | [Installation and React compatibility](https://tanstack.com/query/latest/docs/framework/react/installation) |
| ASP.NET Core / EF Core | 10.0.11 / 10.0.11 | [.NET support](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core), [EF Core 10](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) |
| Npgsql EF provider | 10.0.3 | [Npgsql 10 release notes](https://www.npgsql.org/efcore/release-notes/10.0.html); NuGet metadata requires EF Core 10 |
| PostgreSQL | 18.6 | [PostgreSQL 18 docs](https://www.postgresql.org/docs/18/), [official container](https://hub.docker.com/_/postgres) |
| ESLint / @eslint/js | 10.12.0 / 10.0.1 | [ESLint version support](https://eslint.org/version-support); published engines support Node 22.13+ |
| Playwright | 1.64.0 | [Playwright installation](https://playwright.dev/docs/intro) |

Package registry metadata was also checked for exact versions, engines and peer dependencies. Lockfiles are the dependency baseline; update them deliberately and rerun checks. Do not use `latest` images or floating direct dependency ranges.

## First run

Install the prerequisites from the README and start Docker's Linux engine. From the repository root:

```powershell
npm ci
npm run setup
npm run check
npm run dev:database
```

The setup command generates an untracked `deploy/.env` and never overwrites an existing one. It contains development database identifiers, port and a random password; do not publish its contents. The scripts accept simple unquoted dotenv values, lowercase SQL identifiers, a numeric port, and a 16–128 character password using letters, digits, underscore or hyphen. The template password must be replaced if configuring manually.

In separate terminals, run `npm run dev:api` and `npm run dev:web`. Open `http://127.0.0.1:5173`. API port: 5080; database host port: 15432. All listeners bind to loopback. The Vite proxy forwards `/api`, `/health` and development `/openapi`; `/hubs` is reserved for a later authenticated slice. There is no broad CORS policy. The API accepts configuration through standard ASP.NET Core providers; `ConnectionStrings__Dosvyazi` overrides the local database configuration when using another PostgreSQL 18 instance. Never put secrets in `VITE_` variables.

The API can start with no database configuration: liveness and system metadata work, while readiness is HTTP 503. An inaccessible database must not display as ready. The UI supports initial loading, unavailability, manual retry and periodic recovery checks. These are HTTP connection states; SignalR/media reconnect is still future work.

## Health and contract

- `GET /api/v1/system`: product and milestone metadata.
- `GET /health/live`: HTTP 200 while the host can serve requests; independent of PostgreSQL.
- `GET /health/ready`: HTTP 200 when the EF/Npgsql database probe succeeds, otherwise 503. Responses contain only status and named check states, with no connection strings or exception details. This is a connectivity check, not a domain schema/migration check.
- `GET /openapi/v1.json`: development only. Unmatched API routes use ProblemDetails.

With the API running on port 5080, `npm run generate:api` regenerates `apps/web/src/api/schema.d.ts` from the real OpenAPI document. Review and keep that generated file so `npm ci` and web builds do not require a running API. After changing API contracts, regenerate it and run checks. There is no hand-maintained duplicate DTO definition in the UI.

## Checks

```powershell
npm run check
npm run test:database
npm run install:browser
npm run test:e2e
```

`check` runs ESLint, strict UI/E2E TypeScript checking, production web build, locked .NET restore, .NET build with warnings as errors, and API pipeline tests. Stop a running development API before rebuilding on Windows: its executable can be locked by the running process. The build runs serially with build servers disabled to work in restricted environments.

`test:database` explicitly requires the configured real PostgreSQL instance. It checks provider wiring, server major 18 and repeated successful readiness calls; it fails if unavailable. Set `DOSVYAZI_TEST_CONNECTION` to use a separate PostgreSQL 18 instance. Ordinary API tests cover missing/unavailable database failures without a database substitute.

Playwright starts isolated local API/web processes on 5081/5174, then stops them at completion. Tests run in desktop and mobile Chromium viewports, cover live API wiring, navigation, loading, failure/retry, loss/recovery after a successful response, invalid readiness data and overflow. Deterministic failure-state tests intercept HTTP requests; they are UI tests, while the live smoke scenario calls the real API. Chromium emulation does not replace testing on actual phones or all browser engines.

The scripts keep .NET CLI home, NuGet caches, browser binaries, TRX results, browser screenshots and traces inside ignored `.local/`. Network access is needed for initial dependency/browser downloads and NuGet audit metadata. A restricted sandbox may also require approval for loopback connections or Docker's named pipe; request the necessary normal escalation instead of bypassing protection.

## Stopping and troubleshooting

Stop API/web processes with Ctrl+C. `npm run stop:database` stops only this Compose service and retains its volume. Changing `POSTGRES_PASSWORD` after database initialization does not change the existing database password; restore the correct local configuration rather than deleting data.

If a port is busy or reserved, change `POSTGRES_PORT` in ignored `deploy/.env` and rerun `npm run dev:database`, then restart the API. `DOSVYAZI_API_PORT` controls the API listener, and `DOSVYAZI_API_TARGET` controls the Vite proxy target; restart the corresponding process after changes. The default browser port can be changed with `npm run dev --workspace @dosvyazi/web -- --port 5175`.

PostgreSQL 18's official image uses `/var/lib/postgresql/18/docker` and declares its volume at `/var/lib/postgresql`. This Compose configuration uses that new mount location. Do not apply older PostgreSQL 17 volume instructions to this image or delete a volume to fix configuration.

Keep this development Compose file local; production TLS, Caddy/static UI hosting, least-privilege database roles, backups, persisted Data Protection keys and LiveKit networking will be implemented and verified in their authorized stages. Private files and attachments will remain outside the public web root when implemented.
