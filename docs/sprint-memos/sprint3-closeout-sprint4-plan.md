# Sprint 3 closeout + Sprint 4 plan

_Sprint 3 theme: **agent-native primitives → 0.6**_
_Sprint 4 theme: **surface area + distribution → 0.8**_

Authored 2026-04-19 by the synthesis PM. Ground truth:
`git log --oneline | head -80`, `CHANGELOG.md`, `docs/V1_PLAN.md`,
repo state at `HEAD = 7b67326`.

---

## 1. Sprint 3 closeout

### Shipped this sprint (post 0.4 cut at `8ceb010`)

Counted from `git log 8ceb010..HEAD`:

- **#6 — MessagePart discriminated union** (`c14348f`, `feat(0.6)`).
  Adds `Message.parts?: MessagePart[]` with `text` / `code` /
  `tool_call` / `tool_result` variants in `src/types.ts`;
  `renderContent` now prefers `parts` over `content` when present
  (`src/render.ts`). Purely additive; existing consumers unchanged.
- **Flutter parity for Sprint 1 domain-model work** (`4733afa`).
  Dart sealed classes for `Message` / `SendMessageParams` /
  `EditMessageParams`. Unblocks #8's Flutter mirror.
- **#5 — `ZulipClient.startAgentReply` streaming primitive**
  (`c1e8c7a`, `feat(0.6)`). New `src/agent-reply.ts` (381 lines);
  local-echoes tokens at 60fps, broadcasts edits at ≤4Hz via a
  trailing-edge 250ms debounce; abort lands a terminal edit with a
  sentinel `tool_result`. Transport gained `sendMessageWithId()` for
  synchronous id handoff. 404 new lines of tests in
  `tests/agent-reply.test.ts`.
- **#7 — Confirmation widget** (`7b083e8`, `feat(0.6)`).
  `ConfirmationMessagePart` with idempotent double-click guard and a
  composed `zulip-confirmation-response` `CustomEvent` re-emitted on
  the host. 281 lines of tests in `tests/confirmation-widget.test.ts`.
  Deliberately no wire-format plumbing yet — parts survive only
  in-session; that's #6's remit and is in follow-up scope.

Tooling / infra from this sprint:

- `chore(agent-reply)` (`a27778d`) — dropped unused DI field from the
  streaming primitive (found during the #7 landing).
- `chore(react-native)` (`8cb1291`) — ambient types synced with the new
  discriminated unions.

### Still open from Sprint 3 original scope

- **#8 — Agent/first-class participant rendering.** Per user,
  **landing in parallel, to be verified post-merge.** Expected
  deliverable: `Message.author: { kind: "human" | "agent"; ...
  agentModel? }`, gradient avatar + "AI" badge in `src/render.ts`,
  Flutter mirror. Verify at merge time:
  1. `Message.author` typed in `src/types.ts` and exported.
  2. `src/render.ts` branches on `author.kind`.
  3. `packages/flutter/lib/src/format.dart` mirrors.
  4. `tests/render.test.ts` adds an agent-branded row assertion.

### Scope creep / reactive fixes absorbed

Thirteen `fix(...)` and `security:` commits landed alongside feature
work. Two buckets:

**Security hardening (unplanned, user-triggered).** Worth calling out
separately — they reveal a renderer threat-model that the Sprint 4
bundle-split work must not regress:

- `cbb4df9` — `fix(render)`: block `image-set` / `cross-fade` / `src`
  / `paint` / `element` URL smuggling inside CSS `url(...)` contexts.
- `fc4b400` — `fix(component)`: brand-logo validator bypass via a
  C0-control-char prefix.
- `d21e469` — `fix(channel-list)`: validate `channel.color` as hex
  before styling.
- `2cd0d10` — `fix(react-native)`: partial-entity bypass in
  `stripHtml` (only affects RN package's plain-text path).

**UI/CSS papercuts.** Four visible bugs reported by early users:

- `7b67326` — sizing on `:host` so external height rules take effect.
- `e8a5939` — emoji-picker category nav crushed by grid flex squeeze.
- `302cf22` — composer textarea invisible on light theme.
- `4e6a24f` — `fix(ci)`: build core bundle before `@zulip/react`
  typecheck (latent ordering bug exposed when the React package was
  added).

### Risk callouts for Sprint 4

1. **`agent-reply` is load-bearing but only one consumer today.**
   `src/agent-reply.ts` is 381 lines that talk to `Transport.editMessage`
   at 4Hz with a trailing-edge debounce, plus
   `sendMessageWithId()` contract. The bundle-split work in #10 must
   keep `startAgentReply` inside the `agent` subpath entry and not
   accidentally eager-load it into the base `@zulip/embed/chat` tree.
   Single-consumer code paths are where regressions hide — any change
   to `ZulipClient`'s event fan-out during splitting needs the
   `agent-reply.test.ts` fake-timer suite run under the new entry
   layout.

2. **CSS-URL sanitizer regression surface.** The four security fixes
   (`cbb4df9`, `fc4b400`, `d21e469`, plus the earlier `9625b14` /
   `045285a`) are all in `src/render.ts` and `src/component.ts` —
   exactly the files #10 plans to re-entry-point and #11 / #12 plan to
   extend. Sprint 4 must add a regression-suite assertion that every
   hardening commit's fixture still fails the renderer under the
   subpath-split build, not just the monolith.

3. **`ConfirmationMessagePart` is in-session only.** Noted explicitly in
   `7b083e8`: parts do not yet survive a Zulip sync. If Sprint 4 ships
   an `<zulip-announcement>` that renders `parts`, it'll render empty on
   reload. Either defer that support to the #6-wire-format follow-up
   (v1.1) or have announcement widgets fall back to `content` until the
   `\u0001zulipembed:v1:` serializer is real.

4. **Single-file monolith.** `src/component.ts` is still ~1300 lines
   per `V1_PLAN.md`. Every Sprint 3 feature added to it (event
   re-emit, streaming message class, confirmation click handler).
   The bundle surgery (#10) has to land before any more surface-area
   work piles in, or the monolith will be too tightly coupled to
   entry-split cleanly.

5. **No npm publish has happened yet.** The repo is at `0.2.0` in
   `package.json` on disk but `git tag` is empty and there are no
   published releases. Every CHANGELOG entry through 0.6 exists only
   in-repo. **Sprint 4 is the first sprint where "ship" means "exists
   on the npm registry"** — planning has to account for that being a
   first-time path, not an amendment.

---

## 2. Sprint 4 scope (surface area + distribution → 0.8)

**Framing.** Sprint 4 is the "can an external developer install,
import, and depend on us?" gate. Everything in flight since 0.1 has
been in-tree — the demo site is the only artifact external users see.
Sprint 4 converts the repo into a shippable package. Polish (#18) and
final release theater (#17) are explicitly Sprint 6.

### Picked items for 0.8 (highest-leverage, in order)

1. **#10 — Bundle surgery + subpath exports** _(originally Sprint 4
   scope in V1_PLAN.md; keep here, it blocks everything else)_.
   Gate for v1.0: without subpath entries, `@zulip/embed/chat` is
   conceptually meaningless and the 70KB budget line in the README is
   aspirational. Must land first — #11 and #12 depend on `entries/`
   existing, and the npm publish workflow needs a final `exports` map
   to version-lock.

2. **#17 — npm publish flow + signed release automation** _(moved up
   from Sprint 6; see rationale below)_. Gate for v1.0: we have never
   published a single tarball. The risk of discovering that
   `.npmignore`, `files`, `exports`, `types`, and `peerDependencies`
   are wrong is highest on the **first** publish, not the 1.0 one.
   Shipping `0.8.0-rc.0` to npm surfaces `types` resolution, subpath
   resolution, and CDN layout bugs **while we still have runway**
   rather than the week of 1.0. Trimmed: only the mechanical tag → npm
   workflow lands in Sprint 4; SRI attestation + sigstore
   cosign-signing stay in Sprint 6 (#17's polish tail).

3. **#12 — DM surface + `<zulip-dm-list>`**. Gate for v1.0: the
   feature matrix in `README.md:342` promises DMs "v0.5" — we skipped
   that milestone and every new adopter pipeline I've seen asks for
   DM support. Also the `ScopeFilter` widening is a breaking API
   change; doing it in 0.8 leaves time for a full deprecation window
   before 1.0.

4. **#11 — `<zulip-announcement>` pinned banner**. Gate for v1.0:
   smallest of the three new components but it's the primary
   marketing-page pattern most adopters will copy first. Falls
   naturally out of the `Transport.fetchMessage(id)` addition and
   validates the subpath-export layout on a minimal element before we
   bet on it with DMs.

5. **#16 — RN alpha finalization** (README banner + runtime-bug fix
   already in `5830cdf`). Gate for v1.0: RN currently claims ✅ in the
   README matrix but is plain-text only (no HTML renderer, no
   reactions UI, no typing indicator). Shipping 0.8 without honest
   status-setting risks a `@zulip/react-native` 1.0 that adopters
   feel misled by. S-sized task; included because it's a
   reputational fix, not a feature.

### Prioritization rationale (why these five, why this order)

- **#10 first** because every other item's file layout depends on
  `src/entries/*.ts` existing. Landing #10 last would force re-doing
  #11 and #12's publish path.
- **#17 second** because subpath exports only truly work when verified
  in an `npm install @zulip/embed@0.8.0-rc.0 && node -e "..."` loop.
  Delaying publish until 1.0 is a known anti-pattern — we eat a
  first-publish surprise on the RC, not the GA.
- **#12 third** because it carries the last breaking-change budget
  before 1.0 (`ScopeFilter` widening). The sprint that ships it has
  to also ship the compat path.
- **#11 fourth** because it's cheap (M, 2 days including Flutter) and
  it validates that the #10 entry-split actually supports
  single-component imports end-to-end.
- **#16 last** because it's a docs + deletion PR, not a feature. Slot
  it into any spare afternoon.

### Out of scope for Sprint 4

- **#9 — Topic lifecycle verbs** (original V1_PLAN Sprint 4). _Defer
  to Sprint 5._ `spawnTopic` / `resolveTopic` are nice but don't
  block publish, and we haven't hit a user asking. Carries no
  breaking-change risk; can slip a sprint.
- **Accessibility audit** of the composer + message list. _Defer to
  Sprint 6._ Will cause churn in the exact files bundle surgery is
  rewriting — do it after #10 stabilizes.
- **SSR compatibility (Next.js `"use client"` audit).** _Partial
  credit already taken:_ `5830cdf` added `"use client"` to the React
  wrapper. A deeper Next.js app-router smoke test is Sprint 5's docs
  pack (#14) where we'll build a real `next` example app.
- **Bundler compatibility matrix (Webpack / Rollup / Vite / esbuild
  direct).** _Trimmed:_ cover via one CI row per bundler in #17's
  publish workflow, but defer the full matrix (including older
  versions like webpack@4) to Sprint 6. Vite + esbuild are validated
  in-repo; Webpack 5 + Rollup 4 are the critical two to add.
- **Framework wrapper parity with the WC.** `packages/react` is at
  parity (hooks + channel-list + topic-list wrappers + tests).
  `packages/react-native` is intentionally a subset per #16. No new
  wrapper parity work in Sprint 4 — that's #16's "alpha" label doing
  its job.
- **Accessibility hooks, observability event taxonomy, first-party
  telemetry.** _Push to 1.x._ Zero adopters asking, large design
  surface.
- **CDN/unpkg smoke tests as a standalone item.** _Fold into #17._
  It's one `curl` line in the post-publish job.
- **#18 — Copywriting + micro-interactions.** Sprint 6 per
  `V1_PLAN.md:66`.

---

## 3. Immediate next actions (ordered, executable)

Assumed 2-week sprint starting 2026-04-20. First week focuses on #10;
second on #17 + #11.

1. **Create `src/entries/` scaffold.** Add six empty files:
   `entries/chat.ts`, `entries/channel-list.ts`,
   `entries/topic-list.ts`, `entries/announcement.ts`,
   `entries/dm-list.ts`, `entries/agent.ts`, `entries/demo.ts`. Each
   file re-exports the type surface for one component plus calls its
   `register*Element()`. Current `src/index.ts` becomes
   `src/entries/all.ts` verbatim.
2. **Extend `vite.config.ts` `build.rollupOptions.input`** to emit one
   ESM chunk per entry above. Verify all eight chunks compile with
   `pnpm build`; commit dist before any size work.
3. **Write `scripts/bundle-check.mjs`** that reads each dist chunk,
   runs `brotli -c` (or `zlib.gzipSync`) and fails CI if chunk sizes
   exceed: `chat ≤ 72KB`, `channel-list ≤ 20KB`, `topic-list ≤ 15KB`,
   `announcement ≤ 10KB`, `dm-list ≤ 25KB`, `agent ≤ 15KB`,
   `demo ≤ 30KB`. Wire into `pnpm test` (not a separate script).
4. **Dynamic-import `DemoTransport`, `SnapshotTransport`, and
   `EMOJI_GLYPHS`** from `src/component.ts` and `src/emoji-picker.ts`.
   Validate: in production build with `demo`/`snapshot-url` unset, the
   demo chunks are tree-shaken out.
5. **Rewrite `package.json` `exports` map** to add `./chat`,
   `./channel-list`, `./topic-list`, `./announcement`, `./dm-list`,
   `./agent`, `./demo`, and `./all` entries. Keep `"."` as the
   zero-side-effect type-only entry per plan. Bump to `0.8.0-rc.0`.
6. **Write `.github/workflows/release.yml`** triggered on
   `push: tags: ['v*']`. Steps: `pnpm install`, `pnpm test`,
   `pnpm build`, `pnpm -r build`, then `pnpm publish --access public`
   for the root and each workspace package in topological order
   (`@zulip/embed` → `@zulip/react` → `@zulip/react-native`). Uses
   `NPM_TOKEN` secret. Dry-run once with `--dry-run` flag on a PR
   branch before the first real tag.
7. **Add bundler-compat CI matrix row in the same `release.yml`.**
   Post-publish job consumes `@zulip/embed@0.8.0-rc.0` from the
   registry in three ephemeral projects: one Webpack 5, one Rollup 4,
   one Vite. Each resolves `@zulip/embed/chat` and asserts the IIFE
   runs without throwing. Fails the release if any fails.
8. **Publish `@zulip/embed@0.8.0-rc.0` to npm** from a tag on a
   release branch. Verify: `unpkg.com/@zulip/embed@0.8.0-rc.0/chat`
   loads and registers `<zulip-chat>` in a fresh HTML file with no
   other scripts.
9. **Write `src/announcement.ts` + `src/entries/announcement.ts`** per
   V1_PLAN item #11. `<zulip-announcement server auth-token
   message-id dismissible>` fetches one message via a new
   `Transport.fetchMessage(id)` (implemented as `listMessages` with
   `anchor=<id>&num_before=0&num_after=0`). ~200 lines.
   `tests/announcement.test.ts` + Flutter `ZulipAnnouncement` mirror.
10. **Write `src/dm-list.ts` + `<zulip-dm-list>`** with `ScopeFilter`
    widening per #12. The compat path: accept old flat shape at
    runtime, log one-shot `console.warn` per widened call site,
    remove in 1.0. Flutter mirror as sealed class.
11. **Update `packages/react-native/README.md` with an alpha
    banner** and flip the ✅ to 🟡 in the root `README.md` parity
    table. Delete the vestigial `getState` in
    `packages/react-native/src/zulip-embed.d.ts` now that the real
    method exists on `ZulipClient` after `5830cdf`.
12. **Tag `v0.8.0`** after items 1–11 ship green. Publish.

---

## 4. Open questions for the human

1. **npm org ownership.** `@zulip/*` is an npm scope. Do you have
   publish rights on `@zulip/embed` / `@zulip/react` /
   `@zulip/react-native` today, or does the first publish need to go
   to a different scope (e.g. `@zulip-embed/embed`)? Assumption
   otherwise: you own the scope and `NPM_TOKEN` is a pending TODO.
   _If I'm wrong, item #6 above needs to stall on provisioning._
2. **Version jump semantics.** `package.json` is at `0.2.0`; the plan
   has been shipping 0.4 / 0.6 / 0.8 tags in CHANGELOG notes only. OK
   to bump directly to `0.8.0-rc.0` on the next publish, skipping
   0.3–0.7 on the registry? (My call: yes — the package has never
   been published so there are no consumers to upgrade. Noted as an
   assumption and moved on.)

All other Sprint 4 decisions I've made unilaterally and documented
the assumption inline above.
