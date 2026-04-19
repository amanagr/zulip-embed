"use client";

// Thin React wrapper for <zulip-chat>. The component owns all
// rendering + transport logic; this wrapper just forwards props as
// HTML attributes (inverting kebab-case where needed), wires camelCase
// `on*` callbacks to the underlying CustomEvents, and exposes the
// underlying element via ref so advanced callers can call
// element.open() / element.close() imperatively.
//
// The "use client" directive above lets Next.js / React Server
// Component consumers drop this into a server tree without manually
// marking their own wrapper; the component is inherently client-side
// because it mounts a Web Component.

import {createElement, useEffect, useRef, forwardRef, useImperativeHandle} from "react";
import type {CSSProperties, ReactElement} from "react";

import "zulip-embed";
import type {
    ZulipChatElement,
    ZulipConnectionChangeEventDetail,
    ZulipErrorEventDetail,
    ZulipMessageEventDetail,
} from "zulip-embed";

export interface ZulipChatProps {
    // Live-connection credentials. Leave server/email/apiKey undefined
    // and pass `demo` or `snapshotUrl` to run offline.
    server?: string;
    email?: string;
    apiKey?: string;
    // JWT for server-side handoff. Preferred over api-key for live mode;
    // see docs/jwt.md for the exchange details.
    authToken?: string;

    // Scope: channel is required for live mode; topic is optional —
    // omitting it shows all topics in the channel.
    channel?: string;
    topic?: string;

    // Demo transport — seeded messages + echo bot, no network needed.
    demo?: boolean;
    demoVariant?: string;

    // Read-only snapshot. URL is fetched once on mount.
    snapshotUrl?: string;

    // Presentation knobs. `theme` toggles light/dark tokens; `mode`
    // picks inline vs floating (bottom-right messenger). Brand fields
    // rebadge the header without touching CSS.
    theme?: "light" | "dark";
    mode?: "inline" | "floating";
    open?: boolean;
    readOnly?: boolean;
    brandName?: string;
    brandLogo?: string;

    // Optional CDN override for KaTeX CSS (pulled on demand).
    katexCss?: string;

    // Typed event callbacks. These subscribe to the custom events the
    // underlying `<zulip-chat>` element dispatches on its host. They
    // receive the event's `detail` object directly — consumers don't
    // need to unwrap `CustomEvent`.
    onMessage?: (detail: ZulipMessageEventDetail) => void;
    onConnectionChange?: (detail: ZulipConnectionChangeEventDetail) => void;
    onError?: (detail: ZulipErrorEventDetail) => void;

    // Escape hatches — forwarded so callers can style the container
    // from their own stylesheet.
    className?: string;
    style?: CSSProperties;
    id?: string;
}

export const ZulipChat = forwardRef<ZulipChatElement, ZulipChatProps>(
    function ZulipChat(props, ref): ReactElement {
        const innerRef = useRef<ZulipChatElement | null>(null);
        // Expose the underlying element to callers that need
        // imperative access (.open(), .close()).
        useImperativeHandle(ref, () => innerRef.current as ZulipChatElement, []);

        useEffect(() => {
            const el = innerRef.current;
            if (!el) return;
            applyAttr(el, "server", props.server);
            applyAttr(el, "email", props.email);
            applyAttr(el, "api-key", props.apiKey);
            applyAttr(el, "auth-token", props.authToken);
            applyAttr(el, "channel", props.channel);
            applyAttr(el, "topic", props.topic);
            applyAttr(el, "demo-variant", props.demoVariant);
            applyAttr(el, "snapshot-url", props.snapshotUrl);
            applyAttr(el, "theme", props.theme);
            applyAttr(el, "mode", props.mode);
            applyAttr(el, "brand-name", props.brandName);
            applyAttr(el, "brand-logo", props.brandLogo);
            applyAttr(el, "katex-css", props.katexCss);
            applyBool(el, "demo", props.demo);
            applyBool(el, "open", props.open);
            applyBool(el, "read-only", props.readOnly);
        }, [
            props.server,
            props.email,
            props.apiKey,
            props.authToken,
            props.channel,
            props.topic,
            props.demo,
            props.demoVariant,
            props.snapshotUrl,
            props.theme,
            props.mode,
            props.open,
            props.readOnly,
            props.brandName,
            props.brandLogo,
            props.katexCss,
        ]);

        // Wire event callbacks. Each effect registers a listener that
        // reads the latest callback off a ref so consumers can pass
        // inline `() => setState(...)` handlers without retriggering
        // attach/detach on every render. We intentionally depend on the
        // refs only — the element identity is stable inside one mount.
        const onMessageRef = useRef(props.onMessage);
        const onConnectionChangeRef = useRef(props.onConnectionChange);
        const onErrorRef = useRef(props.onError);
        onMessageRef.current = props.onMessage;
        onConnectionChangeRef.current = props.onConnectionChange;
        onErrorRef.current = props.onError;

        useEffect(() => {
            const el = innerRef.current;
            if (!el) return;
            const onMessage = (e: Event): void => {
                onMessageRef.current?.((e as CustomEvent<ZulipMessageEventDetail>).detail);
            };
            const onConnection = (e: Event): void => {
                onConnectionChangeRef.current?.(
                    (e as CustomEvent<ZulipConnectionChangeEventDetail>).detail,
                );
            };
            const onErr = (e: Event): void => {
                onErrorRef.current?.((e as CustomEvent<ZulipErrorEventDetail>).detail);
            };
            el.addEventListener("zulip-message", onMessage);
            el.addEventListener("zulip-connection-change", onConnection);
            el.addEventListener("zulip-error", onErr);
            return () => {
                el.removeEventListener("zulip-message", onMessage);
                el.removeEventListener("zulip-connection-change", onConnection);
                el.removeEventListener("zulip-error", onErr);
            };
        }, []);

        // Using createElement with the lowercase tag keeps this file
        // compatible with React 17/18/19 without a JSX module
        // augmentation. className/style/id go straight through; the
        // rest of the attributes are set imperatively in the effect
        // so React's DOM diffing never sees them.
        const elementProps: Record<string, unknown> = {
            ref: innerRef,
        };
        if (props.className !== undefined) elementProps["className"] = props.className;
        if (props.style !== undefined) elementProps["style"] = props.style;
        if (props.id !== undefined) elementProps["id"] = props.id;
        return createElement("zulip-chat", elementProps);
    },
);

function applyAttr(el: HTMLElement, name: string, value: string | undefined): void {
    if (value === undefined || value === "") {
        el.removeAttribute(name);
    } else {
        el.setAttribute(name, value);
    }
}

function applyBool(el: HTMLElement, name: string, value: boolean | undefined): void {
    if (value === true) {
        if (!el.hasAttribute(name)) el.setAttribute(name, "");
    } else {
        el.removeAttribute(name);
    }
}
