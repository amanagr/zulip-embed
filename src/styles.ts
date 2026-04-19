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
    white-space: pre-wrap;
}

.message-content a {
    color: var(--zc-color-accent);
}

.composer {
    border-top: 1px solid var(--zc-color-border);
    padding: var(--zc-spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--zc-spacing-sm);
    background: var(--zc-color-bg);
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
