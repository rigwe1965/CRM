## What and why

<!-- One or two sentences: what changes, and the problem it solves. -->

## Checklist

- [ ] Branch is `feat/…`, `fix/…`, `docs/…` or `chore/…`; nothing committed straight to `main`
- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass (CI also runs the schema check and the build)
- [ ] No secrets, keys, personal data or `.env` content in the diff
- [ ] `CHANGELOG.md` updated under `[Unreleased]` if users will notice the change
- [ ] Database change? A new numbered migration is included, and tenant-owned tables have row-level security
- [ ] Deploy needed? Say what to run (migrations first), because merging deploys nothing
