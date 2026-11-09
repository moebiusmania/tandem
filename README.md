# Tandem

Shared to-do lists for two people. Built with **Bun**, **Hono** (server-side JSX), **SQLite** (`bun:sqlite`),
**htmx** (boosted links and forms, so pages update without full reloads) and **Alpine.js** (the CSP build, for small bits of UI state).
Styling is vanilla CSS: cascade layers, nesting, container queries, `:has()`, `color-mix()`, `@starting-style`
and view transitions. Animations are turned off when the user has `prefers-reduced-motion` set.

## Run

```bash
bun install                      # also copies htmx/Alpine/fonts into public/vendor
bun run user:create alice    # prints a generated password
bun run dev                      # http://localhost:3000  (NODE_ENV=development)
```

Production: `bun start` (secure cookies + HSTS by default; serve it behind TLS).

| Env var | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `DATABASE_PATH` | `data/tandem.sqlite` | SQLite file |
| `COOKIE_SECURE` | `true` (prod), `false` (dev) | `Secure` + `__Host-` cookies |
| `HSTS` | same as `COOKIE_SECURE` | Strict-Transport-Security |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for the client IP |
| `ALLOWED_ORIGINS` | – | Extra origins allowed to POST (public URL behind a proxy) |

### Docker (behind a reverse proxy)

```bash
cp .env.example .env              # set TANDEM_BIND (private-network IP) and TANDEM_PUBLIC_URL
docker compose up -d --build      # published on ${TANDEM_BIND}:3203
docker compose exec app bun create-user.js alice           # create a user
docker compose exec app bun create-user.js alice --reset   # new password
```

Point your reverse proxy at `<TANDEM_BIND>:3203`. TLS ends at the proxy, so the container keeps
secure cookies and HSTS on, allows `TANDEM_PUBLIC_URL` as a form-post origin, and trusts `X-Forwarded-For`
for the login rate limit (the port is only reachable from the private network). The SQLite database lives
in the `data` volume.

Hardening: distroless image pinned by digest, non-root (65532), read-only root filesystem, `noexec` tmpfs,
all capabilities dropped, `no-new-privileges`, pid / memory / CPU / file-descriptor limits, health check on `/healthz`,
rotated logs, and a dedicated bridge subnet.

User management (there is no sign-up):

```bash
bun run user:create bob --name "Bob"     # add the second person
bun run user:create alice --reset          # new password, signs out all sessions
```

## Icons

The favicon (`favicon.ico` + SVG), PWA icons (192, 512, maskable 512) and the iOS home-screen icon are all
drawn from the logo by `bun run icons`, which writes `public/icons/`. It needs no image tools.
The web app manifest is `public/manifest.webmanifest`.

## Tests

```bash
bun test              # 144 tests
bun test --coverage   # threshold: 100% lines and functions (bunfig.toml)
bun run typecheck
```

## Security (OWASP ASVS / Top 10)

| Area | Control |
|---|---|
| Passwords | argon2id (m=19 MiB, t=2, p=1); 12–128 characters, no composition rules; generated passwords come from a CSPRNG |
| Login | Same generic error for unknown user, wrong password and locked account; a dummy hash is verified when the user doesn't exist, so timing doesn't reveal accounts; account locks for 15 min after 5 consecutive failures; per-IP rate limit (429 + `Retry-After`) |
| Sessions | 256-bit random token; only its SHA-256 is stored; new session on every login (prevents session fixation); idle and absolute timeouts; `HttpOnly`, `SameSite=Strict`, `Secure` + `__Host-` prefix; logout deletes the session server-side and sends `Clear-Site-Data` |
| CSRF | Origin / `Sec-Fetch-Site` check, plus a synchronizer token bound to the session (double-submit cookie on the login form) |
| Access control | Every list and item query checks owner-or-shared; only the owner can rename, share or delete a list; a forbidden resource returns 404 so it can't be told apart from a missing one |
| Injection / XSS | Prepared statements only; JSX auto-escaping; zod validation, length limits and control-character stripping on all input |
| Headers | CSP `default-src 'none'` with only same-origin scripts/styles (no inline code, no `unsafe-*`); `frame-ancestors 'none'`, nosniff, `Referrer-Policy: no-referrer`, COOP/COEP/CORP, Permissions-Policy, HSTS |
| Caching | Pages are `no-store`; htmx history snapshots are disabled, so list data is never written to localStorage |
| Redirects | `next` targets must be same-site relative paths (no open redirects) |
| DoS | 16 KB body limit; caps on lists per user and tasks per list; rate-limiter memory is bounded |
| Logging | Structured JSON events for login, lockout, logout, CSRF rejection and sharing changes; CR/LF stripped (no log injection); secrets never logged; generic 500 pages with no stack traces |
| Supply chain | No CDNs: htmx, Alpine and the fonts are served from the app's own origin |
