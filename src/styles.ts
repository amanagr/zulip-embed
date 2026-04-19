export const COMPONENT_STYLES = `
:host {
    --zc-font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --zc-font-size: 14px;
    --zc-line-height: 1.5;
    --zc-radius: 12px;
    --zc-radius-sm: 6px;
    --zc-spacing-xs: 4px;
    --zc-spacing-sm: 8px;
    --zc-spacing-md: 12px;
    --zc-spacing-lg: 16px;
    --zc-color-bg: #ffffff;
    --zc-color-surface: #f7f7f9;
    --zc-color-border: #e5e7eb;
    --zc-color-text: #111827;
    --zc-color-muted: #6b7280;
    --zc-color-accent: #6172f3;
    --zc-color-accent-contrast: #ffffff;
    --zc-color-error: #dc2626;
    --zc-color-success: #16a34a;
    --zc-shadow-floating: 0 20px 40px rgba(17, 24, 39, 0.18);
    --zc-height: 560px;
    --zc-width: 380px;
    --zc-max-height: 80vh;

    display: block;
    font-family: var(--zc-font-family);
    font-size: var(--zc-font-size);
    line-height: var(--zc-line-height);
    color: var(--zc-color-text);
    box-sizing: border-box;
}

:host([theme="dark"]) {
    --zc-color-bg: #111827;
    --zc-color-surface: #1f2937;
    --zc-color-border: #374151;
    --zc-color-text: #f9fafb;
    --zc-color-muted: #9ca3af;
    --zc-color-accent: #818cf8;
    --zc-shadow-floating: 0 20px 40px rgba(0, 0, 0, 0.55);
}

*,
*::before,
*::after {
    box-sizing: inherit;
}

button {
    font: inherit;
    color: inherit;
    cursor: pointer;
}

.root {
    display: flex;
    flex-direction: column;
    background: var(--zc-color-bg);
    border: 1px solid var(--zc-color-border);
    border-radius: var(--zc-radius);
    overflow: hidden;
    height: var(--zc-height);
    width: 100%;
    max-height: var(--zc-max-height);
}

:host([mode="floating"]) {
    position: fixed;
    bottom: var(--zc-spacing-lg);
    right: var(--zc-spacing-lg);
    z-index: 9999;
    width: auto;
}

:host([mode="floating"][open]) {
    width: var(--zc-width);
}

:host([mode="floating"]) .root {
    box-shadow: var(--zc-shadow-floating);
    width: var(--zc-width);
    margin-left: auto;
}

:host([mode="floating"]:not([open])) .root {
    display: none;
}

:host(:not([mode="floating"])) .launcher {
    display: none;
}

:host([mode="floating"][open]) .launcher {
    display: none;
}

.launcher {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--zc-color-accent);
    color: var(--zc-color-accent-contrast);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--zc-shadow-floating);
    transition:
        transform 150ms ease,
        box-shadow 150ms ease;
    margin-left: auto;
}

.launcher:hover {
    transform: translateY(-1px);
}

.launcher:focus-visible {
    outline: 2px solid var(--zc-color-accent);
    outline-offset: 3px;
}

.launcher svg {
    width: 26px;
    height: 26px;
}

.header-close {
    background: transparent;
    border: none;
    padding: 4px;
    border-radius: var(--zc-radius-sm);
    color: var(--zc-color-muted);
    display: none;
    align-items: center;
    justify-content: center;
    transition: background 120ms ease;
}

:host([mode="floating"]) .header-close {
    display: inline-flex;
}

.header-close:hover {
    background: var(--zc-color-border);
    color: var(--zc-color-text);
}

.header-close:focus-visible {
    outline: 2px solid var(--zc-color-accent);
    outline-offset: 2px;
}

.header-close svg {
    width: 16px;
    height: 16px;
}

.header {
    display: flex;
    align-items: center;
    gap: var(--zc-spacing-sm);
    padding: var(--zc-spacing-md) var(--zc-spacing-lg);
    border-bottom: 1px solid var(--zc-color-border);
    background: var(--zc-color-surface);
}

.header-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
}

.header-channel {
    font-weight: 600;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.header-channel::before {
    content: "#";
    color: var(--zc-color-muted);
    margin-right: 2px;
}

.header-topic {
    font-size: 12px;
    color: var(--zc-color-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--zc-color-muted);
    flex-shrink: 0;
}

.status-dot[data-status="connected"] {
    background: var(--zc-color-success);
}

.status-dot[data-status="connecting"] {
    background: #f59e0b;
}

.status-dot[data-status="error"],
.status-dot[data-status="disconnected"] {
    background: var(--zc-color-error);
}

.feed {
    flex: 1;
    overflow-y: auto;
    padding: var(--zc-spacing-md) var(--zc-spacing-lg);
    scroll-behavior: smooth;
}

.feed-empty,
.feed-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--zc-color-muted);
    font-size: 13px;
}

.feed-top-banner {
    text-align: center;
    font-size: 11px;
    color: var(--zc-color-muted);
    padding: 6px 0 10px;
}

.feed-top-banner-end {
    color: var(--zc-color-muted);
    opacity: 0.6;
}

.message {
    display: flex;
    gap: var(--zc-spacing-md);
    padding: var(--zc-spacing-sm) 0;
}

.message + .message.same-sender {
    padding-top: 2px;
}

.message.same-sender .avatar,
.message.same-sender .message-meta {
    visibility: hidden;
    height: 0;
    margin: 0;
    padding: 0;
}

.avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-weight: 600;
    font-size: 12px;
    flex-shrink: 0;
    overflow: hidden;
    background: var(--zc-color-muted);
}

.avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.message-body {
    min-width: 0;
    flex: 1;
}

.message-meta {
    display: flex;
    align-items: baseline;
    gap: var(--zc-spacing-sm);
    margin-bottom: 2px;
}

.message-sender {
    font-weight: 600;
    font-size: 13px;
}

.message-time {
    font-size: 11px;
    color: var(--zc-color-muted);
}

.message-content {
    word-wrap: break-word;
    overflow-wrap: anywhere;
}

.message-content > *:first-child {
    margin-top: 0;
}

.message-content > *:last-child {
    margin-bottom: 0;
}

.message-content p {
    margin: 0 0 6px;
}

.message-content a {
    color: var(--zc-color-accent);
    text-decoration: none;
}

.message-content a:hover {
    text-decoration: underline;
}

.message-content strong,
.message-content b {
    font-weight: 600;
}

.message-content em,
.message-content i {
    font-style: italic;
}

.message-content del,
.message-content s {
    text-decoration: line-through;
    color: var(--zc-color-muted);
}

.message-content code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    background: var(--zc-color-surface);
    border: 1px solid var(--zc-color-border);
    border-radius: 4px;
    padding: 1px 4px;
}

.message-content pre {
    background: var(--zc-color-surface);
    border: 1px solid var(--zc-color-border);
    border-radius: var(--zc-radius-sm);
    padding: 8px 10px;
    overflow-x: auto;
    font-size: 12.5px;
    margin: 6px 0;
}

.message-content pre code {
    border: none;
    padding: 0;
    background: transparent;
}

/*
 * Pygments-compatible syntax theme.
 *
 * Zulip runs fenced code blocks through Pygments on the server and emits
 * class="k" / class="s" / class="c" etc. on nested <span>s, wrapped in
 * either <div class="codehilite"> or <div class="highlight">. The classes
 * pass through DOMPurify untouched; all we need is a theme to color them.
 *
 * The palette is token-grouped rather than one-rule-per-Pygments-class to
 * keep the CSS small. Light-mode defaults live here; dark overrides follow
 * in the :host([theme="dark"]) block at the top of the stylesheet via the
 * color variables below — tokens reference --zc-syntax-* so themers can
 * retint the whole palette with a few variable overrides.
 */
:host {
    --zc-syntax-comment: #6a737d;
    --zc-syntax-keyword: #d73a49;
    --zc-syntax-string: #032f62;
    --zc-syntax-number: #005cc5;
    --zc-syntax-name: #6f42c1;
    --zc-syntax-type: #22863a;
    --zc-syntax-operator: #d73a49;
    --zc-syntax-punctuation: var(--zc-color-text);
    --zc-syntax-builtin: #005cc5;
    --zc-syntax-error: #b31d28;
}

:host([theme="dark"]) {
    --zc-syntax-comment: #8b949e;
    --zc-syntax-keyword: #ff7b72;
    --zc-syntax-string: #a5d6ff;
    --zc-syntax-number: #79c0ff;
    --zc-syntax-name: #d2a8ff;
    --zc-syntax-type: #7ee787;
    --zc-syntax-operator: #ff7b72;
    --zc-syntax-punctuation: var(--zc-color-text);
    --zc-syntax-builtin: #79c0ff;
    --zc-syntax-error: #ffa198;
}

.message-content .codehilite,
.message-content .highlight {
    margin: 6px 0;
    border-radius: var(--zc-radius-sm);
    overflow: hidden;
}

.message-content .codehilite pre,
.message-content .highlight pre {
    margin: 0;
}

/* Comments */
.message-content .c,
.message-content .ch,
.message-content .cm,
.message-content .cp,
.message-content .cpf,
.message-content .c1,
.message-content .cs { color: var(--zc-syntax-comment); font-style: italic; }

/* Keywords + reserved words */
.message-content .k,
.message-content .kc,
.message-content .kd,
.message-content .kn,
.message-content .kp,
.message-content .kr { color: var(--zc-syntax-keyword); font-weight: 600; }

/* Keyword.Type → distinct hue so class/type names stand out */
.message-content .kt { color: var(--zc-syntax-type); font-weight: 600; }

/* Strings (and the many Pygments string subclasses) */
.message-content .s,
.message-content .sa,
.message-content .sb,
.message-content .sc,
.message-content .dl,
.message-content .sd,
.message-content .s2,
.message-content .se,
.message-content .sh,
.message-content .si,
.message-content .sx,
.message-content .sr,
.message-content .s1,
.message-content .ss { color: var(--zc-syntax-string); }

/* Numbers */
.message-content .m,
.message-content .mb,
.message-content .mf,
.message-content .mh,
.message-content .mi,
.message-content .il,
.message-content .mo { color: var(--zc-syntax-number); }

/* Operators */
.message-content .o,
.message-content .ow { color: var(--zc-syntax-operator); }

/* Names */
.message-content .na,
.message-content .nb,
.message-content .bp,
.message-content .nc,
.message-content .nd,
.message-content .ni,
.message-content .ne,
.message-content .nf,
.message-content .fm,
.message-content .nl,
.message-content .nn,
.message-content .py,
.message-content .nt,
.message-content .nv,
.message-content .vc,
.message-content .vg,
.message-content .vi,
.message-content .vm,
.message-content .nx { color: var(--zc-syntax-name); }

/* Builtin pseudo-names like True/False/None */
.message-content .kc,
.message-content .nb { color: var(--zc-syntax-builtin); }

/* Diagnostics */
.message-content .err { color: var(--zc-syntax-error); }

/* Generic diff/output tokens */
.message-content .gd { color: var(--zc-syntax-error); }
.message-content .gi { color: var(--zc-syntax-type); }
.message-content .gu { color: var(--zc-syntax-name); font-weight: 600; }
.message-content .gh { color: var(--zc-syntax-name); font-weight: 600; }
.message-content .gs { font-weight: 600; }
.message-content .ge { font-style: italic; }

.message-content blockquote {
    margin: 6px 0;
    padding: 2px 0 2px 10px;
    border-left: 3px solid var(--zc-color-border);
    color: var(--zc-color-muted);
}

.message-content ul,
.message-content ol {
    margin: 6px 0;
    padding-left: 22px;
}

.message-content li + li {
    margin-top: 2px;
}

.message-content table {
    border-collapse: collapse;
    margin: 6px 0;
    font-size: 13px;
}

.message-content th,
.message-content td {
    border: 1px solid var(--zc-color-border);
    padding: 4px 8px;
    text-align: left;
}

.message-content th {
    background: var(--zc-color-surface);
    font-weight: 600;
}

.message-content img {
    max-width: 100%;
    height: auto;
    border-radius: var(--zc-radius-sm);
    margin: 4px 0;
    border: 1px solid var(--zc-color-border);
}

.message-content img.emoji {
    display: inline-block;
    width: 18px;
    height: 18px;
    vertical-align: text-bottom;
    margin: 0 1px;
    border: none;
    border-radius: 0;
}

.message-content .user-mention,
.message-content .topic-mention,
.message-content .stream,
.message-content .stream-topic {
    background: color-mix(in srgb, var(--zc-color-accent) 12%, transparent);
    color: var(--zc-color-accent);
    padding: 0 4px;
    border-radius: 3px;
    font-weight: 500;
    text-decoration: none;
}

.message-content .user-mention.user-mention-me {
    background: color-mix(in srgb, var(--zc-color-accent) 22%, transparent);
}

.message-content h1,
.message-content h2,
.message-content h3,
.message-content h4,
.message-content h5,
.message-content h6 {
    margin: 10px 0 4px;
    font-weight: 600;
    line-height: 1.3;
}

.message-content h1 { font-size: 18px; }
.message-content h2 { font-size: 16px; }
.message-content h3 { font-size: 15px; }
.message-content h4,
.message-content h5,
.message-content h6 { font-size: 14px; }

.message-content hr {
    border: none;
    border-top: 1px solid var(--zc-color-border);
    margin: 10px 0;
}

.message-content kbd {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px;
    background: var(--zc-color-surface);
    border: 1px solid var(--zc-color-border);
    border-bottom-width: 2px;
    border-radius: 3px;
    padding: 0 4px;
}

.message-content .spoiler-block {
    border: 1px solid var(--zc-color-border);
    border-radius: var(--zc-radius-sm);
    margin: 6px 0;
    overflow: hidden;
    background: var(--zc-color-surface);
}

.message-content .spoiler-header {
    padding: 6px 10px;
    font-weight: 600;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
    user-select: none;
}

.message-content .spoiler-header::before {
    content: "";
    display: inline-block;
    width: 0;
    height: 0;
    border-left: 5px solid currentColor;
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    transition: transform 120ms ease;
    flex-shrink: 0;
}

.message-content .spoiler-block[data-revealed="true"] .spoiler-header::before {
    transform: rotate(90deg);
}

.message-content .spoiler-header:focus-visible {
    outline: 2px solid var(--zc-color-accent);
    outline-offset: -2px;
}

.message-content .spoiler-header:hover {
    background: color-mix(in srgb, var(--zc-color-accent) 8%, transparent);
}

.message-content .spoiler-content {
    padding: 0 10px;
    max-height: 0;
    overflow: hidden;
    transition: max-height 180ms ease, padding 180ms ease;
}

.message-content .spoiler-block[data-revealed="true"] .spoiler-content {
    padding: 2px 10px 8px;
    max-height: none;
}

.message-content .spoiler-content > *:first-child {
    margin-top: 0;
}

.message-content .spoiler-content > *:last-child {
    margin-bottom: 0;
}

@media (prefers-reduced-motion: reduce) {
    .message-content .spoiler-header::before,
    .message-content .spoiler-content {
        transition: none;
    }
}

.reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
}

.reaction,
.reaction-add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    font-size: 12px;
    border-radius: 999px;
    border: 1px solid var(--zc-color-border);
    background: var(--zc-color-surface);
    color: var(--zc-color-text);
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
}

.reaction:hover,
.reaction-add:hover {
    border-color: var(--zc-color-accent);
}

.reaction-mine {
    background: color-mix(in srgb, var(--zc-color-accent) 16%, transparent);
    border-color: var(--zc-color-accent);
    color: var(--zc-color-accent);
}

.reaction-emoji {
    line-height: 1;
}

.reaction-count {
    font-variant-numeric: tabular-nums;
}

.reaction-add {
    padding: 1px 6px;
    color: var(--zc-color-muted);
}

.reaction-add svg {
    width: 14px;
    height: 14px;
}

.composer {
    border-top: 1px solid var(--zc-color-border);
    padding: var(--zc-spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--zc-spacing-sm);
    background: var(--zc-color-bg);
}

:host([read-only]) .composer,
:host([snapshot-url]) .composer {
    display: none;
}

.composer-row {
    display: flex;
    align-items: flex-end;
    gap: var(--zc-spacing-sm);
}

.composer-input {
    flex: 1;
    resize: none;
    border: 1px solid var(--zc-color-border);
    border-radius: var(--zc-radius-sm);
    padding: var(--zc-spacing-sm) var(--zc-spacing-md);
    font: inherit;
    color: inherit;
    background: var(--zc-color-surface);
    min-height: 36px;
    max-height: 120px;
    outline: none;
    transition: border-color 120ms ease;
}

.composer-input:focus {
    border-color: var(--zc-color-accent);
}

.composer-send {
    border: none;
    background: var(--zc-color-accent);
    color: var(--zc-color-accent-contrast);
    border-radius: var(--zc-radius-sm);
    padding: var(--zc-spacing-sm) var(--zc-spacing-md);
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: opacity 120ms ease;
}

.composer-send:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.composer-hint {
    font-size: 11px;
    color: var(--zc-color-muted);
}

.error-banner {
    background: #fee2e2;
    color: #991b1b;
    padding: var(--zc-spacing-sm) var(--zc-spacing-lg);
    font-size: 12px;
    border-bottom: 1px solid #fecaca;
}

:host([theme="dark"]) .error-banner {
    background: #7f1d1d;
    color: #fecaca;
    border-bottom-color: #991b1b;
}

.footer {
    padding: 6px var(--zc-spacing-lg);
    border-top: 1px solid var(--zc-color-border);
    font-size: 11px;
    color: var(--zc-color-muted);
    text-align: center;
    background: var(--zc-color-surface);
}

.footer a {
    color: inherit;
    text-decoration: underline;
}

@media (prefers-reduced-motion: reduce) {
    .feed {
        scroll-behavior: auto;
    }
}
`;
