# Contributing

Thanks for pitching in. Zulip Embed is an Apache-2.0, multi-language
SDK (TypeScript + React + React Native + Flutter), so contributions
that keep the packages honest and consistent are especially welcome.

## Getting started

```bash
git clone https://github.com/amanagr/zulip-embed.git
cd zulip-embed
pnpm install
pnpm dev              # live demo at http://localhost:5173
```

Where things live:

| Path                     | What it is                                                     |
| ------------------------ | -------------------------------------------------------------- |
| `src/`                   | `zulip-embed` — the Web Components and headless TypeScript SDK |
| `src/entries/`           | Subpath-entry files (`chat`, `channel-list`, `topic-list`, …)  |
| `tests/`                 | Vitest suite for the root SDK                                  |
| `packages/react/`        | `zulip-embed-react` — JSX wrappers + `useZulipChat` hook       |
| `packages/react-native/` | `zulip-embed-react-native` — RN alpha preview                  |
| `packages/flutter/`      | `zulip_embed` — Flutter widgets + transport                    |
| `demo/`                  | Landing page + playground (what ships to GitHub Pages)         |
| `scripts/`               | CI helpers (bundle-size checker, snapshot fetchers, release)   |
| `docs/`                  | Long-form docs: onboarding, architecture, JWT, migrations      |

If you're touching the transport layer, the render pipeline, or the
event loop, read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
first — it explains the transport / scope / event model the packages
share.

## Parity rules

Two conventions cut across the whole repo. Please follow both.

### 1. Say "channel," not "stream"

Zulip renamed **streams** to **channels** in Zulip 9 (October 2024).
New code, types, attributes, comments, tests, and docs should always
use `channel` / `Channel` / `channelName` / `channelId` — never the
legacy `stream` terminology.

Two narrow exceptions, both on the wire to the Zulip server:

- `buildNarrow()` emits `[["stream", channel]]` when registering event
  queues — Zulip servers older than 9 reject the `channel` alias
  on `/api/v1/register`.
- `sendMessage()` sends `type=stream` to `/api/v1/messages` for the
  same reason.

Both are marked with a short comment pointing to this rule. Don't
"fix" them without confirming the oldest supported Zulip server
accepts the new spelling. When you parse responses that come back with
`"stream"`, normalize to `"channel"` before handing the value to SDK
consumers — callers of this SDK should never have to know the server
still speaks the older dialect.

### 2. Keep TypeScript and Flutter in parity

`src/` (TypeScript) and `packages/flutter/` (Dart) share the same
domain model — `Transport`, `DemoTransport`, `ZulipTransport`,
`ZulipClient`, the themed chat widget. When you change the model in
one language, **mirror the change in the other in the same PR**, or
open a follow-up PR that lands before the next release. We don't want
the SDKs to drift.

React and React Native are thin wrappers over the TypeScript core, so
they follow it automatically — but if a public attribute or prop name
changes, update the wrapper typings too.

## Before you send a PR

From the repo root:

```bash
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest
pnpm check:bundle     # verify per-subpath gzip budgets
pnpm format:check     # prettier
```

For Flutter changes:

```bash
cd packages/flutter
dart pub get
dart analyze
dart test
```

All four root checks are required to pass before merge. If any of
them fail locally, CI will fail the same way — fix it before pushing.

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/).
Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`,
`perf`, `style`, `build`, `ci`.

- Subject line: short, lowercase, no trailing period. Under ~72
  characters. Scopes are optional but handy: `feat(flutter): …`,
  `fix(render): …`.
- Body: wrap at ~72 characters. Explain the _why_ — the diff already
  shows the _what_.
- Trailers: `Co-Authored-By: Name <email>` lines are welcome at the
  bottom of the body. Squash-merges preserve them on the merge commit.

Examples pulled from the actual log:

```
feat(0.8): <zulip-announcement> pinned-banner element + Flutter mirror
fix(styles): move host sizing onto :host so external height rules work
chore(release): SRI manifest + dist/INTEGRITY.{json,md}
```

## Tests

Every behavior change needs at least one test. Where to put them:

- **Root SDK (`src/`)** → add to `tests/` at the repo root. Vitest,
  jsdom environment, one file per feature area.
- **React wrapper** → `packages/react/tests/`.
- **React Native wrapper** → `packages/react-native/tests/`.
- **Flutter package** → `packages/flutter/test/`.

If you're fixing a bug, add a test that fails on `main` and passes on
your branch before you send the PR. For rendering / sanitizer
changes, include a fixture that demonstrates the exact input and the
expected DOM.

## Bundle budget

`pnpm check:bundle` enforces per-subpath gzip budgets defined in
`scripts/bundle-check.mjs`. If your change pushes a subpath past its
budget, you have two options:

1. **Shrink it** — tree-shake better, move a dependency behind a
   dynamic `import()`, or split out a new subpath entry.
2. **Justify a bump** — update `scripts/bundle-check.mjs` in the same
   PR, and explain in the PR description why the additional bytes are
   worth it. A reviewer will sanity-check the call.

Silently raising the budget without calling it out is the one thing
guaranteed to get a PR bounced.

## Reporting bugs / requesting features

Use the issue templates in `.github/ISSUE_TEMPLATE/`:

- **Bug report** — minimal repro, environment info, expected vs.
  actual behavior.
- **Feature request** — problem you're trying to solve first, then
  the proposal.

For questions and general discussion, use
[GitHub Discussions](https://github.com/zulip/zulip-embed/discussions).
For anything that looks security-sensitive, follow
[`SECURITY.md`](./SECURITY.md) — private email, not a GitHub issue.

## Code of conduct

This project follows the Contributor Covenant. See
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Enforcement reports go
to `security@zulip.com` — the Zulip maintainers handle code-of-conduct
reports from the same mailbox they use for security reports.
