# Release Process

Project Memory uses a lightweight Changesets-based flow.

## 1) Add changeset

```bash
pnpm changeset
```

Choose affected packages and bump type.

## 2) Validate before merge

```bash
pnpm release:verify
```

## 3) Prepare release

```bash
pnpm release:status
```

Then update `CHANGELOG.md`, review the release notes draft, and tag a release in GitHub.

## Notes

- Replace `your-org/project-memory` in `.changeset/config.json` with your real GitHub repo.
- For fully automated publishing, add npm/token workflow later.
- `pnpm release:verify` runs the current 1.0.0 quality gates:
  - formatting
  - strict TypeScript checks
  - core unit tests
  - full workspace build
  - benchmark/report script syntax validation
