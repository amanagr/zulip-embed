# Zulip Embed v1 implementation plan

Source: synthesis of a 5-PM panel (dev-infra, open-source, enterprise-security, AI-native, community/creator) reviewed and sequenced by the synthesis PM. Assume project is independent of Kandra Labs / Zulip — all trademark and `@zulip/*` npm-scope coordination items are out of scope.

## Current-state summary

The repo at `/home/aman/zulip-embed` is a pnpm workspace with four publishable units: the core web package at `src/` (published as `zulip-embed`), a React wrapper at `packages/react/`, a React Native package at `packages/react-native/`, and a Flutter package at `packages/flutter/`. The core package exports the `<zulip-chat>`, `<zulip-channel-list>`, and `<zulip-topic-list>` custom elements, the `ZulipClient`, and three transports (`ZulipTransport`, `DemoTransport`, `SnapshotTransport`). Everything compiles from `src/index.ts` into a single Vite library bundle (`dist/zulip-embed.js` = 174 KB raw, 43 KB gzipped; IIFE = 132 KB raw, 39 KB gzipped). The demo page at `demo/index.html` + `demo/main.ts` is also the production landing page — `VITE_MODE=site` reuses it into `site/`. Tests are 36 vitest files in `tests/` plus 5 Dart test files in `packages/flutter/test/` plus 2 React tests in `packages/react/tests/`. There is no `docs/` directory yet.

The component in `src/component.ts` is 1322 lines, a single `ZulipChatElement` that owns template construction, state, transport lifecycle, and every keyboard / scroll / composer handler. Observed attributes today are the 16 listed at `src/component.ts:37-54`; the ones that tear down and rebuild the client are `demo`, `demo-variant`, `snapshot-url`, `server`, `email`, `api-key`, `channel`, `topic`. The `bootstrapClient()` method at `src/component.ts:648` instantiates a new `ZulipTransport` directly from the `email` + `api-key` attributes, then wraps it in a `ZulipClient` and subscribes with an `initToken` fence. No `CustomEvent` is dispatched off `<zulip-chat>` today — event-dispatch is used only in `src/channel-list.ts:387` and in `src/topic-list.ts`. That is the single biggest gap for the React hook + event surface work.

The transport layer is small. `src/transport.ts` is 65 lines defining the `Transport` interface. `src/zulip-transport.ts` is the 734-line live implementation: HTTP Basic auth header built in the constructor from `email:apiKey`, `/api/v1/register` long-polling with `last_event_id`, zod schemas for every Zulip response, and a channel-id cache for typing. `ZulipClient` at `src/client.ts` is a thin 95-line pass-through around a single `Transport`. It does not maintain any state, so there is no `getState()` today — a drift note: `packages/react-native/src/ZulipChatScreen.tsx:69` already calls `client.getState()` which does not exist on the core class (only in RN's local `zulip-embed.d.ts`); the RN package only typechecks because it re-exports the core `ZulipClient` but its `.d.ts` augments the shape. This is a latent runtime bug that fits naturally inside item #16.

The Flutter package (`packages/flutter/lib/src/`) mirrors the TS domain model: same transports, same client shape, same widget surface. Per `CLAUDE.md` every domain-model change in TS must land in Dart in the same sprint. The Flutter `ZulipChat` widget at `packages/flutter/lib/src/widgets/zulip_chat.dart` already has edit / delete / reaction / typing parity — strictly ahead of what the RN package offers. The RN package is bare plain-text rendering with `stripHtml`; it accurately reflects the "downgrade to alpha" bullet in item #16.

## Sprint plan

Six two-week sprints. Each sprint lands one user-visible milestone and ships to npm as `0.2 → 0.4 → 0.6 → 0.8 → 1.0-rc → 1.0`.

### Sprint 1: auth + types foundation (weeks 1–2)

- **Goal.** Replace the "API key in the DOM" foot-gun with JWT handoff, and lock in type-safe public API shapes the rest of v1 will build on.
- **Deliverable.** A host app can drop `<zulip-chat auth-token="...">`, receive a derived API key in closure only, and consume every callback with discriminated-union types. `whenReady` resolves with the current user.
- **Items.** #2 (JWT handoff), #3 (discriminated unions + whenReady), #13 (error taxonomy + reconnecting state).
- **Dependency notes.** #3 must land in the same sprint as #2 — one breaking wave, not two. #13 rides along because the taxonomy is declarative type work on event shapes we are already rewriting. Nothing downstream can start before these.
- **Definition of done.**
  - `api-key` attribute removed from `OBSERVED_ATTRIBUTES` and `REINIT_ATTRIBUTES`; `email` attribute kept but flagged optional — resolved from `/users/me` after JWT exchange.
  - `refreshAuthToken?: () => Promise<string>` callback round-trips on 401 and reconnects without dropping messages.
  - `client.whenReady: Promise<User>` added; tests calling `getCurrentUserId()` move to `await client.whenReady`.
  - `ErrorEvent.code` union tested with fixture responses for each code.
  - Flutter parity: `ZulipTransport` constructor gains `authToken` + `refreshAuthToken`; Dart unions for channel vs direct.
  - Docs: `CHANGELOG.md` for 0.2 + `docs/migration-0.2.md`.

### Sprint 2: events + React-native SDK shape (weeks 3–4)

- **Goal.** `<zulip-chat>` behaves like a real Web Component — fires typed `CustomEvent`s, exposes `beforeSend` / `redactMessage` hooks — and React gets a headless `useZulipChat` hook.
- **Deliverable.** Host apps wire `<zulip-chat onMessage={...} beforeSend={...}>` in React or plain HTML and build their own UI on `client.getState()`.
- **Items.** #4 (typed event surface + React hook + `"use client"`), partial #16 (sugar on `ZulipClient`: `getState`, `loadOlder`, `sendMessage(string)`), partial #13 (wire `"reconnecting"` into `ZulipTransport.pollLoop`).
- **Dependency notes.** Depends on sprint 1 (#3 event shape). Unblocks #5 (streaming primitive), #15 (onboarding reads `onMessage`).
- **Definition of done.**
  - `<zulip-chat>` dispatches `zulip-message`, `zulip-error`, `zulip-connection-change`, `zulip-audit` as `CustomEvent<T>`.
  - React wrapper forwards camelCase `on*` props + `"use client"` directive; `useZulipChat(transport, scope)` hook in `packages/react/src/hooks.ts`.
  - `ZulipClient.getState/loadOlder/sendMessage(content: string)` overload lands; RN runtime bug dies.
  - `ConnectionEvent` emits `"reconnecting"` with `{attempt, delayMs, reason}` during backoff.

### Sprint 3: agent-native primitives (weeks 5–6)

- **Goal.** Ship primitives making Zulip Embed an AI-native chat SDK: streaming token rendering, structured `MessagePart` content, inline confirmation widgets, agent-as-participant rendering.
- **Deliverable.** "Agent reply, live" demo tab streams tokens at 60fps, shows a tool-call panel, and renders an approve/deny widget the user clicks to continue.
- **Items.** #5 (streaming), #6 (`MessagePart[]`), #7 (confirmation widget), #8 (agent rendering).
- **Dependency notes.** #6 must merge before #7 or #8. #5 depends on #4's event surface + #6. Order: #6 → #5 → #7 → #8.

### Sprint 4: surface area + distribution (weeks 7–8)

- **Goal.** Bundle down to 70KB critical path. Ship DM + announcement + topic-lifecycle primitives. RN alpha status. SRI + signed releases.
- **Deliverable.** unpkg script tag is 70KB gzipped. `client.spawnTopic(...)` / `resolveTopic(...)` available. `<zulip-announcement>` + `<zulip-dm-list>` shipped. RN README reads "alpha — text-only."
- **Items.** #9 (topic lifecycle), #10 (bundle surgery), #11 (announcement), #12 (DM surface), #16 (RN alpha finalization).
- **Dependency notes.** #10 blocks 1.0 release train. #10 ships before #11 + #12 since subpath exports define where new elements live. #12 depends on #3's `SendMessageParams`.

### Sprint 5: docs + onboarding (weeks 9–10)

- **Goal.** Every supported deployment path has an end-to-end doc. First-time visitor to demo gets walked through topic creation.
- **Deliverable.** `docs/` filled with four production guides. Landing-page demo shows coach-mark + starter prompts + `/new-topic` pill.
- **Items.** #14 (production docs pack), #15 (onboarding flow).
- **Dependency notes.** #15 depends on #4 (listens for `zulip-message` for reaction-nudge trigger). #14 depends on #2 and #10 being final.

### Sprint 6: polish + release (weeks 11–12)

- **Goal.** Ship 1.0. Copywriting, micro-interactions, landing-page sanding.
- **Deliverable.** `zulip-embed@1.0.0` on npm, signed GitHub release, updated landing page, migration guide from 0.1.
- **Items.** #17 (SRI + signed releases finalization), #18 (copywriting + micro-interactions), release-candidate burn-down.

## Item details

### #2 — Replace `api-key` with JWT handoff

- **Files touched.** `src/component.ts` (lines 37-54, 648-770, `bootstrapClient`), `src/zulip-transport.ts` (constructor at line 176, new `authToken`/`refreshAuthToken` fields, new `exchangeToken` private method), `src/client.ts` (options type), `packages/react/src/zulip-chat.tsx` (props + attribute mapping, `useEffect` at line 59), `packages/react-native/src/index.ts`, `packages/flutter/lib/src/zulip_transport.dart`, `tests/zulip-transport.test.ts`, new `tests/auth-token.test.ts`.
- **Public API additions.**
  ```ts
  interface ZulipClientOptions {
      transport: Transport;
      authToken?: string;
      refreshAuthToken?: () => Promise<string>;
  }
  interface ZulipTransportOptions {
      serverUrl: string;
      scope: ScopeFilter;
      historyLimit?: number;
      // Either (email + apiKey) OR authToken must be supplied.
      email?: string;
      apiKey?: string;
      authToken?: string;
      refreshAuthToken?: () => Promise<string>;
  }
  ```
  `<zulip-chat>` `auth-token` attribute added to `OBSERVED_ATTRIBUTES` and `REINIT_ATTRIBUTES`; `api-key` removed.
- **Test strategy.** `tests/auth-token.test.ts`: stub `fetch`, assert initial POST to `/api/internal/jwt/fetch_api_key`, `Basic` header on subsequent calls, 401 → `refreshAuthToken` → retry path, derived key never assigned to a publicly reachable field.
- **Size.** M (2–3 days including Flutter parity).
- **Risks.** Some Zulip deployments don't have the JWT auth backend enabled. Pre-flight check (`transport.probeAuth()`), surface clean `ErrorEvent { code: "jwt-not-configured" }` rather than 404. Open question: keep `apiKey` in `ZulipTransportOptions` through v1 for dev workflows; remove the `api-key` attribute from the component now.

### #3 — Discriminated unions + `whenReady`

- **Files touched.** `src/types.ts` (full rewrite of `Message`, `SendMessageParams`), `src/transport.ts` (lines 31-38: split `EditMessageParams` into three variants), `src/client.ts` (add `whenReady`), `src/zulip-transport.ts` (`convertMessage` at line 688; `loadCurrentUser` resolves `whenReady`), `src/demo-transport.ts`, `src/snapshot-transport.ts`, every downstream call site in `src/component.ts`, `src/render.ts`, `src/channel-list.ts`, and `tests/`.
- **Public API additions.**
  ```ts
  export type Message =
      | (MessageBase & { type: "channel"; channelName: string; topic: string })
      | (MessageBase & { type: "direct"; recipients: User[] });
  export type SendMessageParams =
      | { type: "channel"; channel: string; topic: string; content: string }
      | { type: "direct"; recipients: string[]; content: string };
  export type EditMessageParams =
      | { messageId: number; kind: "content"; content: string }
      | { messageId: number; kind: "topic"; topic: string }
      | { messageId: number; kind: "both"; content: string; topic: string };
  interface ZulipClient {
      whenReady: Promise<User>;
      getCurrentUserId(): number | undefined; // deprecated — kept for migration
  }
  ```
- **Test strategy.** Compile-time `expectType` assertions in tests. Runtime: `tests/client.test.ts` `whenReady` race test; extend `tests/zulip-transport-mutations.test.ts` for each edit variant.
- **Size.** L (3–4 days; high blast radius across call sites).
- **Risks.** Optional `channelName?: string | undefined` in `src/types.ts:26-28` is relied on by `src/render.ts` and `DemoTransport`. Every call site needs to branch on `message.type` instead. Grep-driven codemod at the top of sprint 1.

### #4 — Typed CustomEvent surface + React hook

- **Files touched.** `src/component.ts` (event dispatcher methods + property accessors for `beforeSend`/`redactMessage`), new `packages/react/src/hooks.ts`, `packages/react/src/zulip-chat.tsx` (`"use client"` at line 1 + `addEventListener` wiring), `packages/react/src/index.ts`, `src/client.ts` (new `onAnyEvent` subscription helper), `tests/component-events.test.ts`, `packages/react/tests/use-zulip-chat.test.tsx`.
- **Public API additions.**
  ```ts
  interface ZulipChatElement extends HTMLElement {
      beforeSend?: (params: SendMessageParams) => SendMessageParams | Promise<SendMessageParams> | null;
      redactMessage?: (message: Message) => Message;
  }
  interface ZulipChatEventMap {
      "zulip-message": CustomEvent<{ message: Message }>;
      "zulip-error": CustomEvent<{ code: ErrorCode; error: string }>;
      "zulip-connection-change": CustomEvent<ConnectionEvent>;
      "zulip-audit": CustomEvent<{ kind: "send" | "edit" | "delete" | "react"; messageId?: number }>;
  }
  function useZulipChat(
      transport: Transport,
      scope: ScopeFilter,
  ): {
      state: { messages: Message[]; status: ConnectionStatus };
      sendMessage: (params: SendMessageParams | string) => Promise<void>;
      addReaction: (p: ReactionParams) => Promise<void>;
      removeReaction: (p: ReactionParams) => Promise<void>;
      editMessage: (p: EditMessageParams) => Promise<void>;
      deleteMessage: (id: number) => Promise<void>;
      loadOlder: () => Promise<void>;
  };
  ```
- **Size.** L (3–5 days; React hook needs care for StrictMode double-connect).
- **Risks.** `<zulip-chat>` recreates its client on any `REINIT_ATTRIBUTES` change. `beforeSend` must survive a reinit — expose it as a JS property, not an attribute.

### #5 — `client.startAgentReply()` streaming primitive

- **Files touched.** `src/client.ts`, new `src/agent-reply.ts` (handle class, RAF scheduler, debounce), `src/transport.ts`, `src/zulip-transport.ts` (provisional `sendMessage`, batch `editMessage` at ≤4Hz), `src/render.ts` (streaming-message CSS class + incremental text-node updates), `src/component.ts`, new `tests/agent-reply.test.ts`.
- **Public API additions.**
  ```ts
  interface AgentReplyHandle {
      messageId: Promise<number>;
      appendToken(text: string): void;
      appendEvent(event: MessagePart): void;
      finish(final?: { parts?: MessagePart[]; content?: string }): Promise<void>;
      abort(reason?: string): Promise<void>;
  }
  interface ZulipClient {
      startAgentReply(
          scope: ScopeFilter,
          options: { author: Pick<User, "fullName" | "avatarUrl"> & { agentModel?: string } },
      ): AgentReplyHandle;
  }
  ```
- **Test strategy.** Fake-timers: append 200 tokens, advance 250ms, assert one `editMessage` call. Abort after 100 tokens, assert final edit with partial content + `"aborted": true` in `parts` (no exception thrown).
- **Size.** L (5 days).
- **Risks.** Zulip has no native streaming; `editMessage` debounce is best we can do and still looks like rubber-banding in broadcast. Local-echo mode: originating viewer sees 60fps, others see 4Hz broadcast.

### #6 — `Message.parts: MessagePart[]` structured content

- **Files touched.** `src/types.ts`, `src/render.ts` (new `renderParts()`, fall-through to legacy `content`), `src/zulip-transport.ts` (parse reserved payload prefix — message starts with `\u0001zulipembed:v1:` + JSON), `src/demo-transport.ts`, `tests/message-parts-render.test.ts`, Flutter mirror.
- **Public API additions.**
  ```ts
  export type MessagePart =
      | { type: "text"; text: string }
      | { type: "code"; language: string; code: string }
      | { type: "toolCall"; name: string; args: unknown; callId: string }
      | { type: "toolResult"; callId: string; ok: boolean; result: unknown }
      | { type: "artifact"; title: string; url: string; mime: string }
      | { type: "confirmation"; id: string; prompt: string; approveLabel?: string; denyLabel?: string; payloadSig: string };
  interface Message {
      parts?: MessagePart[];
  }
  ```
- **Size.** M (3 days once #3 landed).
- **Risks.** Wire-format-in-content-string means parts survive Zulip's sync to mobile/desktop as literal text — tag is `\u0001` prefixed so invisible in most terminals.

### #7 — Confirmation widget

- **Files touched.** `src/render.ts` (render `confirmation` part), `src/component.ts` (wire click → `client.sendMessage(...)` with reply citing `confirmationId`), new `tests/confirmation-widget.test.ts`.
- **Size.** S (1 day).
- **Risks.** Idempotency: disable both buttons immediately after first click. Payload-signature verification is the host's job.

### #8 — Agent/first-class participant rendering

- **Files touched.** `src/types.ts` (add `Message.author`), `src/render.ts` (branch on `author.kind` for avatar gradient + "AI" badge + collapsible sections), `src/styles.ts`, `tests/render.test.ts`, Flutter mirror.
- **Public API additions.**
  ```ts
  interface Message {
      author?: {
          kind: "human" | "agent";
          name: string;
          avatarUrl: string;
          agentModel?: string;
      };
  }
  ```
- **Size.** M (2–3 days including Flutter).

### #9 — Topic lifecycle verbs

- **Files touched.** `src/transport.ts`, `src/zulip-transport.ts` (via `/api/v1/streams/{id}/topics` + resolve sentinel), `src/demo-transport.ts`, `src/snapshot-transport.ts`, `src/client.ts`, `tests/zulip-transport-mutations.test.ts`, Flutter mirror.
- **Public API additions.**
  ```ts
  interface Transport {
      spawnTopic(channel: string, options: { topic: string; kind?: "thread" | "announcement" }): Promise<void>;
      resolveTopic(channel: string, topic: string): Promise<void>;
      onTopicResolved(cb: (event: { channel: string; topic: string }) => void): () => void;
  }
  ```
- **Size.** M (2 days).

### #10 — Bundle surgery

- **Files touched.** `vite.config.ts` (multi-entry `build.rollupOptions.input`), `package.json` `exports` map, split `src/index.ts` into `src/entries/chat.ts`, `channel-list.ts`, `topic-list.ts`, `announcement.ts`, `dm-list.ts`, `agent.ts`, `demo.ts`; dynamic imports in `src/component.ts` around `DemoTransport`/`SnapshotTransport`/`createEmojiPicker`/`EMOJI_GLYPHS`; new `scripts/bundle-check.mjs` CI-gated.
- **Public API additions.** Subpath entries:
  ```
  zulip-embed             — zero-side-effect type entry
  zulip-embed/chat        — registers <zulip-chat>
  zulip-embed/channel-list
  zulip-embed/topic-list
  zulip-embed/dm-list
  zulip-embed/announcement
  zulip-embed/agent       — startAgentReply + AgentReplyHandle
  zulip-embed/demo        — DemoTransport + SnapshotTransport
  zulip-embed/all         — compat; registers everything
  ```
- **Test strategy.** `scripts/bundle-check.mjs`: `chat` ≤ 72KB, `channel-list` ≤ 20KB, `topic-list` ≤ 15KB, `announcement` ≤ 10KB, `dm-list` ≤ 25KB. Runs under `pnpm test`.
- **Size.** L (5 days).
- **Risks.** `zulip-embed/all` preserves muscle memory but we hide it from headline docs.

### #11 — `<zulip-announcement>` pinned banner

- **Files touched.** New `src/announcement.ts` (~200 lines), `src/entries/announcement.ts`, `src/index.ts` re-exports, `tests/announcement.test.ts`, Flutter mirror as `ZulipAnnouncement`.
- **Public API.**
  ```html
  <zulip-announcement server="..." auth-token="..." message-id="123456" dismissible></zulip-announcement>
  ```
- **Size.** M (2 days including Flutter).
- **Risks.** Single-message fetch isn't in `Transport` today. Add `Transport.fetchMessage(id)` or use `listMessages` with `anchor=<id>&num_before=0&num_after=0`.

### #12 — DM surface + `<zulip-dm-list>`

- **Files touched.** `src/component.ts` (composer branches on `scope.kind`), `src/types.ts` (`ScopeFilter` gains `kind` discriminator), `src/transport.ts` (+`listDmConversations()`), `src/zulip-transport.ts` (`/api/v1/users/me/huddles` + private messages), new `src/dm-list.ts`, `src/entries/dm-list.ts`, `tests/dm-list.test.ts`, Flutter mirror.
- **Public API additions.**
  ```ts
  type ScopeFilter =
      | { kind: "channel"; channel: string; topic?: string }
      | { kind: "direct"; recipients: User[] };
  interface Transport {
      listDmConversations(): Promise<DmConversation[]>;
  }
  ```
- **Size.** L (5 days; `ScopeFilter` widens across 30+ call sites).
- **Risks.** `ScopeFilter` widening is breaking for structural users. Compat: accept flat shape with runtime warning for two releases.

### #13 — Error taxonomy + reconnecting state

- **Files touched.** `src/types.ts` (widen `ErrorEvent`, widen `ConnectionEvent`), `src/zulip-transport.ts` (`describeHttpError` at line 659 maps HTTP status → `ErrorCode`; `pollLoop` at 556 emits `"reconnecting"` + backoff metadata), `src/component.ts` (error banner renders code + retry affordance), tests.
- **Public API additions.**
  ```ts
  type ErrorCode =
      | "unauthorized" | "channel-not-subscribed" | "network"
      | "rate-limited" | "jwt-not-configured" | "unknown";
  interface ErrorEvent {
      type: "error";
      code: ErrorCode;
      error: string;
      retryAfterMs?: number;
  }
  type ConnectionStatus =
      "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";
  interface ConnectionEvent {
      type: "connection";
      status: ConnectionStatus;
      attempt?: number;
      delayMs?: number;
  }
  ```
- **Size.** M (2 days).

### #14 — Production docs pack

- **Files touched.** New `docs/QUICKSTART-PRODUCTION.md`, `docs/csp.md`, `docs/auth.md`, `docs/topics-onboarding.md`; README link updates.
- **Size.** L (5 days of writing).
- **Risks.** Docs drift. Add CI grep: every public attribute on `<zulip-chat>` must appear in `docs/auth.md` or `docs/QUICKSTART-PRODUCTION.md`.

### #15 — Topic-onboarding coach-mark

- **Files touched.** New `src/onboarding.ts` (~300 lines), `src/component.ts` (observer for `starter-prompts` + mount coach-mark on first paint), `src/styles.ts`, `src/demo-data.ts` (first-run seed welcome topic), `tests/onboarding.test.ts`, Flutter mirror.
- **Public API.**
  ```html
  <zulip-chat
      starter-prompts="Say hi,Ask a question,Report a bug"
      onboarding="coach-mark,topic-strip,reaction-nudge"
  ></zulip-chat>
  ```
- **Size.** L (5 days; UX polish).
- **Risks.** Coach-mark positioning in shadow DOM needs `getBoundingClientRect` polling; `@supports (anchor-name: --x)` progressive enhancement.

### #16 — RN alpha downgrade

- **Files touched.** `packages/react-native/README.md` (new top-of-file banner), `README.md` parity table root, `src/client.ts` (three sugar methods — sprint 2 partial), `packages/react-native/src/zulip-embed.d.ts` (delete duplicate `getState`).
- **Public API additions.**
  ```ts
  interface ZulipClient {
      getState(): { messages: Message[]; status: ConnectionStatus };
      loadOlder(): Promise<void>;
      sendMessage(content: string): Promise<void>;
      sendMessage(params: SendMessageParams): Promise<void>;
  }
  ```
- **Size.** S (1 day for docs; methods land sprint 2).

### #17 — SRI + signed releases

- **Files touched.** New `.github/workflows/release.yml`, `scripts/release.mjs`, README SRI table, `package.json` `publishConfig`.
- **Size.** M (2 days).

### #18 — Copywriting + micro-interactions

- **Files touched.** `src/format.ts` (line 44: `avatarColor` returns gradient tuples), `src/render.ts` (reaction click confetti hook, empty-state starter chips), `src/styles.ts` (new `@keyframes confetti`, `send-shimmer`, `typing-dot`), `src/component.ts` (three-dot typing indicator).
- **Size.** M (3 days).
- **Risks.** `prefers-reduced-motion: reduce` disables all animations.

## Cross-cutting

### Breaking changes (all in 0.2)

- **#2** removes the `api-key` attribute. Migration: replace with `auth-token` (preferred) or pass `apiKey` through `ZulipTransport` options on the JS side.
- **#3** narrows `Message`, `SendMessageParams`, `EditMessageParams`. Migration: `if (msg.channelName)` → `if (msg.type === "channel")`. Codemod in `scripts/codemod-0.2.mjs`.
- **#12** widens `ScopeFilter` with `kind`. Compat: old flat shape accepted for one release with console warning.
- **#10** reshapes `exports`. Migration: switch to subpath imports or use `zulip-embed/all`.
- **#13** widens `ConnectionStatus` with `"reconnecting"`. Exhaustive switches must add a branch.

### Flutter parity per-sprint

- **#2** Dart `ZulipTransport` gains `authToken` + `refreshAuthToken`, JWT exchange. S.
- **#3** `types.dart` — `Message`/`SendMessageParams`/`EditMessageParams` as `sealed class`. Downstream: `widgets/message_list.dart`, `widgets/composer.dart`. M.
- **#5** `AgentReplyHandle` in `client.dart`; widget streaming state. M.
- **#6** `MessagePart` sealed class; `MessageList` falls through to `content` when null. M.
- **#8** `Message.author`; agent avatar gradient in `format.dart`. S.
- **#9** `spawnTopic`, `resolveTopic` in `Transport`. S.
- **#11** `ZulipAnnouncement` widget. S.
- **#12** Widen `ScopeFilter` to sealed class; `ZulipDmList` widget. M.
- **#13** `ErrorCode` enum, `ConnectionStatus.reconnecting`. S.
- **#15** `starterPrompts` / `onboarding` props on `ZulipChat`. M.
- **#18** gradient `avatarColor` tuples; typing-dots animation with `AnimationController`. M.

Items **#4, #7, #10, #14, #16, #17** are Flutter-irrelevant.

### Test infra additions

- **`tests/fixtures/`** — new directory: `auth-token-exchange.json`, `dm-conversations.json`, `agent-reply-events.jsonl`, `onboarding-seed.json`.
- **`tests/helpers/mock-fetch.ts`** — centralize fetch stubs (currently inlined in 6 test files).
- **`tests/helpers/event-recorder.ts`** — record all `CustomEvent`s on a `<zulip-chat>` for assertion.
- **Snapshot updates** — `renderParts`, agent layout, confirmation widget, typing dots, empty-state chips.
- **Bundle budget CI gate** — `scripts/bundle-check.mjs` under `pnpm test`.
- **Flutter** — `packages/flutter/test/message_parts_test.dart`, `agent_reply_test.dart`, `scope_filter_test.dart`.

### Release process

- **0.2 (end of sprint 1)** — JWT handoff, discriminated unions, error taxonomy, `"reconnecting"`. All v1 breaking changes here. `docs/migration-0.2.md`.
- **0.4 (end of sprint 2)** — typed event surface, React hook, `ZulipClient` sugar, RN runtime bug fixed.
- **0.6 (end of sprint 3)** — agent primitives. Demo page "Agent reply, live" tab.
- **0.8 (end of sprint 4)** — bundle surgery, topic lifecycle, announcement, DM list, RN alpha banner, SRI. `zulip-embed/chat` subpath published.
- **1.0-rc (start of sprint 6)** — tagged after sprint 5 docs complete. One-week external-beta burn-in. Bugfix-only until 1.0.
- **1.0 (end of sprint 6)** — polish pass lands, signed release, README SRI table updated, blog post.

## De-scoped / resized during planning

- **#5 size bump to L** — 4Hz `editMessage` debounce + 60fps local echo + abort-cleanup = 5 days.
- **#10 gains a `/all` entry** — preserves one-import muscle memory while headline docs show subpaths.
- **#12 bumped L** — `ScopeFilter` touched by every scope-aware file (30+ call sites).
- **#15's "reaction-nudge after 5 scrolled messages" trimmed** — depends on message-viewed tracking we don't have; moves to v1.1.
- **Post-v1**: `zulip-embed-mcp-server` (v1.1 — read-only server first: channels/topics/search), presence + `<zulip-user-list>` (v1.1), file upload with `beforeSend` DLP hook (v1.1), search (v1.1, bundled with MCP), bubble layout variant (v1.1), polls/scheduled/GIFs (v1.2), SAML/OIDC enterprise (v1.2+), Notion/Teachable/Framer starter kits (v1.1).

## Landing page + demo track

Runs concurrent (one sprint behind engineering).

- **Sprint 1 (design only).** Pull `packages/flutter/example/` screenshots into `demo/public/`. Wireframe "Agent reply, live" + onboarding walkthrough.
- **Sprint 2.** "Headless React" tab using `useZulipChat` — code alongside live render.
- **Sprint 3.** "Agent reply, live" tab: provisional message → 200 tokens @ 60fps → tool call panel → confirmation widget → approval resolves thread.
- **Sprint 4.** "Pick your bundle" — three tabs showing live gzipped size from build output.
- **Sprint 5.** Onboarding walkthrough: coach-mark, starter prompts, `/new-topic` pill. Landing-page copy rewritten for adoption-research principles.
- **Sprint 6.** Copy pass matching #18 component copy pass. Replace "v0.1 developer preview" banner with "v1.0 — production". `localStorage`-backed "What's new" modal.
