# Changelog

All notable changes to the CRM. Follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versions use `MAJOR.MINOR.PATCH`.

## [Unreleased]

### Added
- LICENSE, SECURITY.md, this changelog and a pull request template (project standard).
- CI now runs on every pull request (the repository is public), with branch protection on `main`: `verify` and `security` must pass.

### Security
- `effect` (pulled in by `@prisma/config`, which pins 3.20.0) is overridden to `^3.22.1`, fixing a high-severity ReDoS advisory (GHSA-7589-6fvf-x4pw) that made the CI `security` check fail. No Prisma 7 release ships the fix yet; remove the override when one does.

### Fixed
- CI schema check for Prisma 7 (`--shadow-database-url` was removed); two tests that depended on the real clock now pin their date.
- README stack and prerequisites now match the code (Next.js 16, React 19, Prisma 7, Node 24).

Earlier history is in the git log. The first tagged release will be `v0.1.0`, the version in `package.json`.
