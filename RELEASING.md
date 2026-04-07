# Releasing EloquentJS

This document describes the full release process for the EloquentJS monorepo,
including stable releases, pre-releases (alpha/beta), and hotfixes.

---

## Overview

All packages share a single version number. Releases are driven by git tags.
Pushing a `v*` tag triggers the GitHub Actions release workflow which:

1. Runs the full test suite
2. Validates the version matches the tag
3. Publishes all 7 packages to npm in dependency order
4. Creates a GitHub Release with the changelog entry

---

## Prerequisites

- Node.js 18+
- npm access to the `@eloquentjs` org: `npm login`
- Push access to the repo
- `NPM_TOKEN` secret set in GitHub → Settings → Secrets → Actions

---

## Release Types

| Command | Example | When to use |
|---|---|---|
| `npm run release:patch` | `1.0.0 → 1.0.1` | Bug fixes, small improvements |
| `npm run release:minor` | `1.0.0 → 1.1.0` | New features, backwards-compatible |
| `npm run release:major` | `1.0.0 → 2.0.0` | Breaking changes |
| `npm run release:alpha` | `1.0.0 → 1.0.1-alpha.0` | Early preview, may break |
| `npm run release:beta` | `1.0.0 → 1.0.1-beta.0` | Feature-complete, final testing |
| `npm run release:alpha -- --preminc` | `1.0.1-alpha.0 → 1.0.1-alpha.1` | Iterate on same pre-release |

---

## Step-by-Step: Stable Release

### 1. Prepare

```bash
# Make sure you're on the main branch with a clean working tree
git checkout main
git pull origin main
git status   # should be clean
```

### 2. Decide the bump type

Follow [Semantic Versioning](https://semver.org/):
- **patch** — backwards-compatible bug fixes
- **minor** — new backwards-compatible functionality
- **major** — incompatible API changes (must document in CHANGELOG)

### 3. Run the release script

```bash
# Dry run first to preview
npm run release:patch -- --dry-run

# When happy, run for real
npm run release:patch
```

This will:
- Run all tests (fails and exits if any fail)
- Bump the version in all 8 `package.json` files
- Update `CHANGELOG.md` with commits since the last tag
- Create a git commit: `chore(release): 1.0.1`
- Create an annotated git tag: `v1.0.1`

### 4. Review

```bash
git diff HEAD~1          # review the version bump commit
cat CHANGELOG.md         # review the generated changelog
```

Edit `CHANGELOG.md` manually if the auto-generated entries need cleanup.
If you edited the changelog, amend the commit:

```bash
git add CHANGELOG.md
git commit --amend --no-edit
```

### 5. Push

```bash
git push origin main
git push origin --tags
```

GitHub Actions picks up the tag and publishes automatically.

### 6. Verify

```bash
# Watch the Actions tab, or check npm after ~2 minutes
npm view @eloquentjs/core version
npm view @eloquentjs/cli version

# Install and smoke-test
npm install @eloquentjs/core@latest
```

---

## Step-by-Step: Pre-Release (Alpha / Beta)

Pre-releases are published under a dist-tag (`alpha` or `beta`) so they
don't affect users who run `npm install @eloquentjs/core`.

```bash
# Start an alpha from current stable
npm run release:alpha
# → 1.1.0-alpha.0

# Iterate (more fixes, same cycle)
npm run release:alpha -- --preminc
# → 1.1.0-alpha.1

# Promote to beta when stable enough
npm run release:beta
# → 1.1.0-beta.0

# Promote to stable release
npm run release:minor
# → 1.1.0
```

**Installing pre-releases:**

```bash
npm install @eloquentjs/core@alpha   # latest alpha
npm install @eloquentjs/core@beta    # latest beta
npm install @eloquentjs/core@1.1.0-alpha.2   # specific version
```

---

## Step-by-Step: Hotfix

A hotfix patches a production release without including unreleased features.

```bash
# Create a hotfix branch from the release tag
git checkout -b hotfix/fix-crash-on-null v1.1.0

# Make the fix, commit it
git commit -m "fix(core): handle null value in getAttribute"

# Release the patch
npm run release:patch
git push origin hotfix/fix-crash-on-null --tags

# Merge back to main
git checkout main
git merge hotfix/fix-crash-on-null --no-ff
git push origin main

# Clean up
git branch -d hotfix/fix-crash-on-null
```

---

## Manual Publishing (without git tags)

If you need to publish without triggering the full tag flow:

```bash
# Dry run
node scripts/publish.js --dry-run

# Publish stable
node scripts/publish.js

# Publish as alpha
node scripts/publish.js --tag=alpha

# Publish single package only
node scripts/publish.js --package=core

# With 2FA OTP
node scripts/publish.js --otp=123456
```

---

## Promoting Pre-Release to Latest

After a pre-release has been tested and is ready to become the stable release:

```bash
# Option A: run the stable release script
npm run release:patch     # or minor/major — drops the pre suffix

# Option B: manually promote the dist-tag (if already published)
npm dist-tag add @eloquentjs/core@1.1.0 latest
npm dist-tag add @eloquentjs/codegen@1.1.0 latest
npm dist-tag add @eloquentjs/pgsql@1.1.0 latest
npm dist-tag add @eloquentjs/mongodb@1.1.0 latest
npm dist-tag add @eloquentjs/realtime@1.1.0 latest
npm dist-tag add @eloquentjs/graphql@1.1.0 latest
npm dist-tag add @eloquentjs/api@1.1.0 latest
npm dist-tag add @eloquentjs/cli@1.1.0 latest
```

---

## Commit Message Convention

This repo uses [Conventional Commits](https://conventionalcommits.org) to
auto-generate changelogs.

```
<type>(<scope>): <description>

Types:
  feat      New feature
  fix       Bug fix
  perf      Performance improvement
  refactor  Code change without feature/fix
  docs      Documentation only
  test      Adding or fixing tests
  chore     Tooling, CI, dependencies
  ci        CI configuration
  build     Build system changes
  revert    Revert a previous commit

Breaking changes:
  feat(core)!: rename Model.boot to Model.initialize
               ^                                      ← '!' marks breaking

Scope examples:
  feat(core): add whereJsonContains
  fix(pgsql): correct parameter numbering in UPDATE
  feat(cli): add migrate:fresh --seed flag
  docs(api): add Fastify example
```

---

## GitHub Environments

The release workflow uses two GitHub Environments for approval gates:

| Environment | Triggered by | Requires approval |
|---|---|---|
| `prerelease` | alpha/beta/rc tags | No (auto-deploys) |
| `production` | stable version tags | Optional (add reviewer in GitHub Settings) |

Set up environments at: **Repo → Settings → Environments**

---

## Required Secrets

| Secret | Where to get it |
|---|---|
| `NPM_TOKEN` | npm → Account → Access Tokens → Automation token |
| `CODECOV_TOKEN` | codecov.io → your repo → Settings |

Add at: **Repo → Settings → Secrets and variables → Actions**

---

## Troubleshooting

**"Version already exists on npm"**
The publish script skips already-published versions. If you need to republish
(e.g. the package was unpublished), use `npm unpublish @eloquentjs/core@X.Y.Z`
first (only possible within 72 hours of publish).

**"Working directory has uncommitted changes"**
The release script checks for a clean git state. Commit or stash everything:
```bash
git stash
npm run release:patch
git stash pop
```

**"Tests failed"**
Fix the failing tests before releasing. The script won't proceed past a test failure.

**Tag exists but publish didn't run**
Re-trigger the workflow from GitHub Actions → Release → Re-run, or publish manually:
```bash
node scripts/publish.js
```
