// Thin React wrapper for <zulip-channel-list>. Converts the
// `channel-selected` CustomEvent into a React-style `onChannelSelected`
// prop so callers don't have to touch addEventListener.

import {createElement, useEffect, useRef, forwardRef, useImperativeHandle} from "react";
import type {CSSProperties, ReactElement} from "react";

import "zulip-embed";
import type {ZulipChannelListElement} from "zulip-embed";

export interface ChannelSelectedDetail {
    channelId: number;
    name: string;
}

export interface ZulipChannelListProps {
    server?: string;
    authToken?: string;
    demo?: boolean;
    snapshotUrl?: string;
    theme?: "light" | "dark";
    onChannelSelected?: (detail: ChannelSelectedDetail) => void;
    className?: string;
    style?: CSSProperties;
    id?: string;
}

export const ZulipChannelList = forwardRef<ZulipChannelListElement, ZulipChannelListProps>(
    function ZulipChannelList(props, ref): ReactElement {
        const innerRef = useRef<ZulipChannelListElement | null>(null);
        useImperativeHandle(ref, () => innerRef.current as ZulipChannelListElement, []);

        // Stash the latest handler in a ref so the listener installed
        // on the element can stay mounted even when the parent
        // re-renders with a fresh function identity.
        const handlerRef = useRef<typeof props.onChannelSelected>(props.onChannelSelected);
        handlerRef.current = props.onChannelSelected;

        useEffect(() => {
            const el = innerRef.current;
            if (!el) return;
            applyAttr(el, "server", props.server);
            applyAttr(el, "auth-token", props.authToken);
            applyAttr(el, "snapshot-url", props.snapshotUrl);
            applyAttr(el, "theme", props.theme);
            applyBool(el, "demo", props.demo);
        }, [
            props.server,
            props.authToken,
            props.demo,
            props.snapshotUrl,
            props.theme,
        ]);

        useEffect(() => {
            const el = innerRef.current;
            if (!el) return;
            const listener = (e: Event): void => {
                const detail = (e as CustomEvent<ChannelSelectedDetail>).detail;
                handlerRef.current?.(detail);
            };
            el.addEventListener("channel-selected", listener);
            return () => el.removeEventListener("channel-selected", listener);
        }, []);

        const elementProps: Record<string, unknown> = {ref: innerRef};
        if (props.className !== undefined) elementProps["className"] = props.className;
        if (props.style !== undefined) elementProps["style"] = props.style;
        if (props.id !== undefined) elementProps["id"] = props.id;
        return createElement("zulip-channel-list", elementProps);
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
