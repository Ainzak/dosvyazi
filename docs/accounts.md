# Accounts and sessions

The browser supports registration, sign-in, sign-out and editing the current user's display name at `/register`, `/login` and `/account`. This stage has no email delivery, email confirmation, password recovery, MFA, external login, account deletion or global Identity roles. [Communities](communities.md) provide owner/member access; full role-based permissions remain a later stage.

## HTTP contract

All paths below start with `/api/v1/account`. Responses containing profiles expose only `id`, `email` and `displayName`; passwords, hashes, security stamps and session identifiers are never returned in profile DTOs. Account responses disable caching. OpenAPI is available only in Development; the browser uses its generated TypeScript types.

| Method/path | Behavior |
| --- | --- |
| `GET /csrf` | Returns an identity-bound `requestToken` and sets a host-only CSRF cookie |
| `POST /register` | Accepts `email`, `password`, `displayName`; creates an account/session and returns 201 with its profile |
| `POST /login` | Accepts `email`, `password`; creates a session and returns 200 with its profile |
| `POST /logout` | Revokes the current database session, clears its cookie and returns 204; repeated anonymous logout with a fresh CSRF token also returns 204 |
| `GET /me` | Returns the authenticated profile; anonymous or invalid sessions receive 401 |
| `PUT /me` | Accepts `displayName`; updates only the authenticated user and returns the profile |

Email uniqueness is case-insensitive and enforced by a unique normalized-email database index, including concurrent registration. Display names are trimmed, 2–40 characters, with no control characters. Passwords are 12–128 characters with at least four distinct characters; mandatory character classes are disabled. ASP.NET Core Identity handles hashing and verification.

Invalid request fields return 400. Registration conflicts or Identity policy failures return a generic 409; incorrect credentials and locked accounts return a generic 401. Profile concurrency conflicts return 409. Errors use ProblemDetails and do not expose database configuration or exception details.

## Session and request protection

- `dosvyazi.session` is a host-only, HttpOnly, SameSite=Strict browser session cookie. The server enforces an absolute 12-hour lifetime with no sliding renewal. Secure is required outside Development and on HTTPS requests in Development. Closing a browser is not a substitute for server logout, because browsers may restore session cookies.
- PostgreSQL stores session identifiers, owners, creation/expiry and revocation timestamps. Every authenticated request checks the database session and Identity security stamp. Logout rejects subsequent use of a copied cookie. Successful sign-in/registration also revokes the session supplied with that request; other devices remain signed in. Unavailable storage fails closed with a sanitized server error.
- Unsafe controller requests require an antiforgery cookie plus `X-CSRF-TOKEN`. The UI obtains a fresh request token before each mutation, including after identity changes in another tab. The API uses `IAntiforgery.ValidateRequestAsync` explicitly through a controller filter: `AddControllers` does not supply MVC's view-specific antiforgery filter services. See [Microsoft's antiforgery guidance](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery?view=aspnetcore-10.0).
- Unsafe browser requests with an Origin header must match the current request's scheme/host/port. There is no broad CORS policy. The local Vite proxy preserves the browser's Host/Origin; production proxy/TLS configuration belongs to deployment work.
- Registration and login share an in-process fixed window of 30 attempts per minute per remote IP. `Accounts__PermitLimit` overrides the development default. Excess requests return 429 and `Retry-After: 60`. Five failed password attempts lock an account for 15 minutes. Rate-limit state resets with the host; this is a single-process baseline, not distributed abuse protection.

Data Protection keys persist in ignored `.local/data-protection` through the development runner. Direct non-Development startup requires `DataProtection__KeyPath`. Newly generated keys on Windows use current-user DPAPI; explicit filesystem persistence on other systems needs protected permissions and an appropriate key-encryption setup for production. Existing keys are not re-encrypted by changing configuration. Keep keys private and persisted alongside the database: losing them invalidates existing cookie/CSRF tokens. See [cookie authentication](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie?view=aspnetcore-10.0) and [key configuration](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview?view=aspnetcore-10.0).

The UI keeps credentials out of localStorage and distinguishes failed session checks from anonymous sessions. It shows loading/error/retry states and preserves entered profile values after failed saves. Read [development instructions](development.md) for migrations and real PostgreSQL/browser checks. Session-history pruning, recovery flows, production key/backup handling and deployment hardening remain later work.
