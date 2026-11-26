# Changelog

All notable changes to the CRM. Follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versions use `MAJOR.MINOR.PATCH`.

## [Unreleased]

### Changed
- Tailwind CSS 3 → 4 (`@tailwindcss/postcss`, theme in `src/app/globals.css` with `@theme inline`, `tailwind.config.ts` removed). `tailwindcss-animate` replaced by `tw-animate-css` (the dialog, menu and sheet animations). New `stack-y-*` utility (Tailwind 3 spacing) where a field label is inline: v4's `space-y` would have removed the gap under it. Screens compared before and after in screenshots (25 pages, light, dark and mobile): no visible change.

### Added
- LICENSE, SECURITY.md, this changelog and a pull request template (project standard).
- CI now runs on every pull request (the repository is public), with branch protection on `main`: `verify` and `security` must pass.
- `.env.example` lists every setting the code reads (added: `SHADOW_DATABASE_URL`, `TEST_DATABASE_URL`, `AUTH_URL`/`AUTH_SECRET`, `WHATSAPP_API_VERSION`, `DEFAULT_PHONE_COUNTRY_CODE`). `tests/env-example.test.ts` fails when the code reads a setting that is not listed, or a listed one is used nowhere.

### Security
- `effect` (pulled in by `@prisma/config`, which pins 3.20.0) is overridden to `^3.22.1`, fixing a high-severity ReDoS advisory (GHSA-7589-6fvf-x4pw) that made the CI `security` check fail. No Prisma 7 release ships the fix yet; remove the override when one does.

### Fixed
- CI schema check for Prisma 7 (`--shadow-database-url` was removed); two tests that depended on the real clock now pin their date.
- README stack and prerequisites now match the code (Next.js 16, React 19, Prisma 7, Node 24).
- The weekly restore drill failed from 2026-11-23: `ubuntu-latest` moved to Ubuntu 26.04, which has no `postgresql-client-16`. The drill job is pinned to `ubuntu-24.04`.

Earlier history is in the git log. The first tagged release will be `v0.1.0`, the version in `package.json`.
