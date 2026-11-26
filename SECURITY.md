# Security policy

## Reporting a problem

Please do not open a public issue for a security problem. Email **info@facyke.com** with what you found and where (page, endpoint or file), how to reproduce it, and what an attacker could do with it. You will get a first reply within 5 working days.

## What is in scope

The code in this repository: the web app, the REST API, authentication, the multi-tenant data isolation (row-level security) and the AI assistant features. The last full review is in [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Running it safely

- Never commit `.env`. Use long random values for `NEXTAUTH_SECRET` and every API key, and set them per environment.
- Keep two-step verification on for every admin account. Production requires it for admins by default (`REQUIRE_ADMIN_MFA`).
- Apply database migrations with `npm run db:deploy` before deploying the code that needs them.
- Run behind HTTPS, and set `TRUSTED_PROXY_COUNT` to the number of reverse proxies in front of the app.

## Supported versions

Only `main` receives fixes.
