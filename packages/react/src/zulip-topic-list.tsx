// Thin React wrapper for <zulip-topic-list>. Converts the
// `topic-selected` CustomEvent into a React-style `onTopicSelected`
// prop. Mirrors ZulipChannelList exactly but with a `channel` prop.

import {createElement, useEffect, useRef, forwardRef, useImperativeHandle} from "react";
import type {CSSProperties, ReactElement} from "react";

import "zulip-embed";
import type {ZulipTopicListElement} from "zulip-embed";

export interface TopicSelectedDetail {
    topic: string;
}

export interface ZulipTopicListProps {
    server?: string;
    email?: string;
    apiKey?: string;
    demo?: boolean;
    snapshotUrl?: string;
    channel: string;
    theme?: "light" | "dark";
    onTopicSelected?: (detail: TopicSelectedDetail) => void;
    className?: string;
    style?: CSSProperties;
    id?: string;
}

export const ZulipTopicList = forwardRef<ZulipTopicListElement, ZulipTopicListProps>(
    function ZulipTopicList(props, ref): ReactElement {
        const innerRef = useRef<ZulipTopicListElement | null>(null);
        useImperativeHandle(ref, () => innerRef.current as ZulipTopicListElement, []);

        const handlerRef = useRef<typeof props.onTopicSelected>(props.onTopicSelected);
        handlerRef.current = props.onTopicSelected;

        useEffect(() => {
            const el = innerRef.current;
            if (!el) return;
            applyAttr(el, "server", props.server);
            applyAttr(el, "email", props.email);
            applyAttr(el, "api-key", props.apiKey);
            applyAttr(el, "snapshot-url", props.snapshotUrl);
            applyAttr(el, "channel", props.channel);
            applyAttr(el, "theme", props.theme);
            applyBool(el, "demo", props.demo);
        }, [
            props.server,
            props.email,
            props.apiKey,
            props.demo,
            props.snapshotUrl,
            props.channel,
            props.theme,
        ]);

        useEffect(() => {
            const el = innerRef.current;
            if (!el) return;
            const listener = (e: Event): void => {
                const detail = (e as CustomEvent<TopicSelectedDetail>).detail;
                handlerRef.current?.(detail);
            };
            el.addEventListener("topic-selected", listener);
            return () => el.removeEventListener("topic-selected", listener);
        }, []);

        const elementProps: Record<string, unknown> = {ref: innerRef};
        if (props.className !== undefined) elementProps["className"] = props.className;
        if (props.style !== undefined) elementProps["style"] = props.style;
        if (props.id !== undefined) elementProps["id"] = props.id;
        return createElement("zulip-topic-list", elementProps);
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
