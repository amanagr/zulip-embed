// Thin React wrapper for <zulip-dm-list>. Converts the `dm-selected`
// CustomEvent into a React-style `onDmSelected` prop so callers don't
// have to touch addEventListener. Mirrors the channel-list wrapper.

import {createElement, useEffect, useRef, forwardRef, useImperativeHandle} from "react";
import type {CSSProperties, ReactElement} from "react";

import "zulip-embed";
import type {User, ZulipDmListElement} from "zulip-embed";

export interface DmSelectedDetail {
    userIds: number[];
    users: User[];
    lastMessageId: number;
}

export interface ZulipDmListProps {
    server?: string;
    email?: string;
    apiKey?: string;
    authToken?: string;
    demo?: boolean;
    snapshotUrl?: string;
    theme?: "light" | "dark";
    onDmSelected?: (detail: DmSelectedDetail) => void;
    className?: string;
    style?: CSSProperties;
    id?: string;
}

export const ZulipDmList = forwardRef<ZulipDmListElement, ZulipDmListProps>(
    function ZulipDmList(props, ref): ReactElement {
        const innerRef = useRef<ZulipDmListElement | null>(null);
        useImperativeHandle(ref, () => innerRef.current as ZulipDmListElement, []);

        const handlerRef = useRef<typeof props.onDmSelected>(props.onDmSelected);
        handlerRef.current = props.onDmSelected;

        useEffect(() => {
            const el = innerRef.current;
            if (!el) return;
            applyAttr(el, "server", props.server);
            applyAttr(el, "email", props.email);
            applyAttr(el, "api-key", props.apiKey);
            applyAttr(el, "auth-token", props.authToken);
            applyAttr(el, "snapshot-url", props.snapshotUrl);
            applyAttr(el, "theme", props.theme);
            applyBool(el, "demo", props.demo);
        }, [
            props.server,
            props.email,
            props.apiKey,
            props.authToken,
            props.demo,
            props.snapshotUrl,
            props.theme,
        ]);

        useEffect(() => {
            const el = innerRef.current;
            if (!el) return;
            const listener = (e: Event): void => {
                const detail = (e as CustomEvent<DmSelectedDetail>).detail;
                handlerRef.current?.(detail);
            };
            el.addEventListener("dm-selected", listener);
            return () => el.removeEventListener("dm-selected", listener);
        }, []);

        const elementProps: Record<string, unknown> = {ref: innerRef};
        if (props.className !== undefined) elementProps["className"] = props.className;
        if (props.style !== undefined) elementProps["style"] = props.style;
        if (props.id !== undefined) elementProps["id"] = props.id;
        return createElement("zulip-dm-list", elementProps);
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
