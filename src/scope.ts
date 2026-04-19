// ScopeFilter helpers — normalize / narrow / compare across the
// channel|dm discriminated union introduced in 0.8.
//
// The main entry point is `normalizeScope`, which accepts either the
// modern `{kind, ...}` form or the legacy flat `{channel, topic?}` shape
// and always returns a `NormalizedScope`. The legacy form emits a
// one-shot deprecation warning so adopters can migrate without the
// console drowning in duplicate notices.
//
// Callers inside this SDK MUST funnel user input through `normalizeScope`
// before persisting a scope on a transport or client — the rest of the
// code assumes the `kind` discriminator is always present.

import type {
    ChannelScope,
    DmScope,
    LegacyChannelScope,
    NormalizedScope,
    ScopeFilter,
} from "./types.ts";

// Track which unique caller sites have already been warned. We key on
// the caller's own stack frame when we can get it; otherwise we fall
// back to an "anonymous" sentinel so the first call still logs exactly
// once. The Set lives for the lifetime of the module (i.e. the page /
// tab / test worker), which matches "log once per unique caller" well
// enough for adopter diagnostics.
const DEPRECATED_WARNED = new Set<string>();

export function normalizeScope(scope: ScopeFilter): NormalizedScope {
    if ("kind" in scope) {
        if (scope.kind === "channel") {
            return {kind: "channel", channel: scope.channel, topic: scope.topic};
        }
        return {kind: "dm", userIds: canonicalUserIds(scope.userIds)};
    }
    // Legacy shape — warn once per unique caller site, then widen.
    warnLegacyShapeOnce();
    const legacy = scope as LegacyChannelScope;
    return {kind: "channel", channel: legacy.channel, topic: legacy.topic};
}

// Dedupe + sort the user id list so equivalent DM scopes compare equal.
// Zulip's server is order-sensitive on the wire, so we normalize here and
// let transports serialize in ascending order.
export function canonicalUserIds(userIds: number[]): number[] {
    const seen = new Set<number>();
    for (const id of userIds) {
        if (Number.isFinite(id)) seen.add(id);
    }
    return [...seen].sort((a, b) => a - b);
}

// Pattern-match helper used by transports / client code so we don't
// scatter `if (scope.kind === "channel")` everywhere. Mirrors the
// `Message` narrow pattern elsewhere in the SDK.
export function isChannelScope(scope: NormalizedScope): scope is ChannelScope {
    return scope.kind === "channel";
}

export function isDmScope(scope: NormalizedScope): scope is DmScope {
    return scope.kind === "dm";
}

// Test hook — reset the dedupe set so each test case exercises the
// deprecation warning path cleanly. Not exported from the package
// entry; tests reach in via relative import.
export function __resetDeprecationWarnings(): void {
    DEPRECATED_WARNED.clear();
}

function warnLegacyShapeOnce(): void {
    // Cheap caller fingerprint: the second non-node_modules frame on the
    // stack typically identifies the adopter's own site. When we can't
    // get a stack (older JS engines, frozen globalThis.Error), we fall
    // back to a single "anonymous" key so the first call still logs
    // exactly once instead of spamming.
    const fingerprint = callerFingerprint();
    if (DEPRECATED_WARNED.has(fingerprint)) return;
    DEPRECATED_WARNED.add(fingerprint);
    // eslint-disable-next-line no-console
    console.warn(
        "[zulip-embed] ScopeFilter without kind is deprecated; use kind: 'channel'",
    );
}

function callerFingerprint(): string {
    try {
        const stack = new Error().stack;
        if (typeof stack !== "string") return "anonymous";
        // Skip the first three frames: the Error ctor, this helper, and
        // warnLegacyShapeOnce. The fourth is `normalizeScope`, the fifth
        // is the actual caller.
        const frames = stack.split("\n");
        return frames[5] ?? frames[4] ?? "anonymous";
    } catch {
        return "anonymous";
    }
}
