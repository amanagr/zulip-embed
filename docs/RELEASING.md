# Releasing `zulip-embed`

Playbook for cutting a new release. Covers the TypeScript packages
(`zulip-embed`, `zulip-embed-react`, `zulip-embed-react-native`) and
the Flutter package (`zulip_embed`). Keep the TypeScript and Flutter
package versions aligned across a release so the SDKs don't drift.

See [`CHANGELOG.md`](../CHANGELOG.md) for the release history and the
[`README.md` "Verified releases" section](../README.md#verified-releases)
for what the SRI manifest looks like on a published tag.

## 1. Pre-flight checks

Run every gate CI runs, locally, before you touch `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm -w run build
pnpm check:bundle
pnpm format:check
```

Workspace packages:

```bash
pnpm -C packages/react typecheck
pnpm -C packages/react test
pnpm -C packages/react-native typecheck
pnpm -C packages/react-native test
```

Flutter:

```bash
cd packages/flutter
dart pub get
dart analyze
dart test
cd -
```

If any of these fail on `main`, fix forward before continuing.

## 2. Bump versions

Keep these four in lockstep. The release workflow's
`Verify tag matches root version` step reads the root `package.json`
and will fail the publish if the git tag disagrees.

```bash
# Root — Web Components + headless SDK
$EDITOR package.json              # "version": "0.X.Y"

# React wrapper
$EDITOR packages/react/package.json

# React Native alpha
$EDITOR packages/react-native/package.json

# Flutter
$EDITOR packages/flutter/pubspec.yaml   # version: 0.X.Y
```

Release candidates use pre-release identifiers:
`0.8.0-rc.0`, `0.8.0-rc.1`, … → `0.8.0`. React Native currently ships
as `0.X.Y-alpha` to signal the narrower surface area (see
[`packages/react-native/README.md`](../packages/react-native/README.md)).
Root and React move together; RN and Flutter should match the
semantic version but can carry different pre-release tags.

## 3. Update `CHANGELOG.md`

Move any "Unreleased" bullets into a dated `## 0.X.Y — YYYY-MM-DD`
section at the top of the file. Cross-link any migration notes:

```markdown
## 0.X.Y — YYYY-MM-DD

…

See [`MIGRATION.md`](./MIGRATION.md) for the 0.(X-1) → 0.X upgrade
walkthrough.
```

If this release has migration impact, add (or extend) a section in
[`MIGRATION.md`](../MIGRATION.md) at the same time.

## 4. Commit and tag

```bash
git add package.json packages/*/package.json packages/flutter/pubspec.yaml \
        CHANGELOG.md MIGRATION.md
git commit -m "chore(release): 0.X.Y"
git tag v0.X.Y
```

Never force-push a tag. If a tag goes out with the wrong SHA, delete
it on the remote (`git push --delete origin v0.X.Y`) only if nothing
has been published against it yet — after an npm publish, the SRI
chain is baked in and a retag loses provenance. Cut a `0.X.Y+1`
instead.

## 5. Push

```bash
git push origin main --follow-tags
```

`--follow-tags` pushes annotated tags that point at commits already on
the remote, which is what you want. CI runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml) on
the tag push:

1. `publish` job: `typecheck`, `test`, `pnpm -w run build`,
   `check:bundle`, `scripts/release.mjs` to produce
   `dist/INTEGRITY.{json,md}`, then
   `pnpm publish` for each workspace in topological order
   (`zulip-embed` → `zulip-embed-react` → `zulip-embed-react-native`).
   Uploads the integrity manifest as a workflow artifact.
2. `sri-readme` job (only on tag push): checks out `main`, regenerates
   the manifest, and runs `scripts/splice-sri.mjs` to replace the
   `<!-- sri:start --> … <!-- sri:end -->` block in `README.md` with
   the real hashes. Commits back as
   `chore(release): update SRI hashes for vX.Y.Z [skip ci]`.

## 6. npm publish (manual fallback)

The GitHub Action is the supported path. If you must publish by hand
(e.g. the runner is unavailable), keep provenance on and preserve
topological order:

```bash
pnpm -w run build
node scripts/release.mjs                           # dist/INTEGRITY.{json,md}
pnpm --filter zulip-embed-react run build
pnpm --filter zulip-embed-react-native run build

NPM_CONFIG_PROVENANCE=true pnpm publish --access public
NPM_CONFIG_PROVENANCE=true pnpm --filter zulip-embed-react publish --access public
NPM_CONFIG_PROVENANCE=true pnpm --filter zulip-embed-react-native publish --access public
```

`publishConfig: {access: "public", provenance: true}` in each
`package.json` means `--access public` is the default and
provenance is enforced even without `NPM_CONFIG_PROVENANCE`, but
pass both for belt-and-suspenders.

For Flutter, `dart pub publish` runs from `packages/flutter/` — the
pub.dev credential flow is interactive and not wired to the Action
yet.

## 7. Post-release

Verify the release from a clean shell:

```bash
npm view zulip-embed@0.X.Y versions
npm view zulip-embed@0.X.Y dist.signatures        # Sigstore provenance
curl -sSL https://unpkg.com/zulip-embed@0.X.Y/dist/INTEGRITY.md | head -20
```

Then prepare `main` for the next cycle:

- Confirm CI's SRI splice landed on `main` and the `README.md`
  "Verified releases" table shows the new hashes.
- Bump every `package.json` and `pubspec.yaml` on `main` to the next
  release-candidate identifier — e.g. after `0.8.0` ships, push
  `0.9.0-rc.0` so `main` never pretends to be the last release.
- Add an "Unreleased" heading at the top of `CHANGELOG.md` for
  follow-up work.

## 8. Rollback

Never `npm unpublish`. Unpublishing breaks the SRI chain for every
downstream consumer who pinned the hash, and npm forbids republishing
the same version number for 24 hours. Use `npm deprecate` instead — it
leaves the tarball on the registry so existing installs keep working,
and surfaces a warning to anyone installing it new:

```bash
npm deprecate zulip-embed@0.X.Y "Published with a regression in the emoji picker; install 0.X.Y+1 instead."
npm deprecate zulip-embed-react@0.X.Y "Published against broken zulip-embed@0.X.Y; install 0.X.Y+1 instead."
npm deprecate zulip-embed-react-native@0.X.Y "…"
```

Then cut the follow-up release as in sections 2–5. Add a note to the
broken version's section in [`CHANGELOG.md`](../CHANGELOG.md) pointing
at the replacement.

## Further reading

- [`CHANGELOG.md`](../CHANGELOG.md) — per-release notes.
- [`MIGRATION.md`](../MIGRATION.md) — per-release upgrade guides.
- [`README.md#verified-releases`](../README.md#verified-releases) —
  what the SRI table looks like on a published tag.
- [`.github/workflows/release.yml`](../.github/workflows/release.yml)
  — canonical definition of what CI does on tag push.
- [`scripts/release.mjs`](../scripts/release.mjs) — SRI manifest
  generator.
- [`scripts/splice-sri.mjs`](../scripts/splice-sri.mjs) — README table
  rewriter.
