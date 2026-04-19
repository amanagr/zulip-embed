import {Component, CUSTOM_ELEMENTS_SCHEMA} from "@angular/core";

// Standalone Angular component that renders the framework-agnostic
// <zulip-chat> Web Component.
//
// The `CUSTOM_ELEMENTS_SCHEMA` hook is the Angular-specific gotcha:
// Angular's template compiler treats any unknown tag as an error by
// default ("'zulip-chat' is not a known element"). Adding
// `CUSTOM_ELEMENTS_SCHEMA` to `schemas` tells the compiler "any tag
// with a dash in its name is a Custom Element, render it as plain
// DOM." Analogous to Vue's `isCustomElement` flag, but at the
// component level rather than the compiler level.
@Component({
    selector: "app-root",
    standalone: true,
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    template: `
        <main class="wrap">
            <h1>Zulip Embed — Angular 18 (Vite) example</h1>
            <p class="lead">
                This page renders
                <code>&lt;zulip-chat demo&gt;</code> from a standalone Angular component. Demo mode
                routes through an in-memory transport with seeded messages — no server needed.
            </p>

            <zulip-chat
                demo
                channel="general"
                topic="welcome"
                theme="light"
                mode="inline"
                brand-name="Demo Chat"
            ></zulip-chat>

            <footer>
                Drop <code>demo</code> and add <code>server</code> and
                <code>auth-token</code> for live mode.
            </footer>
        </main>
    `,
    styles: [
        `
            .wrap {
                max-width: 720px;
                margin: 0 auto;
                padding: 32px 20px 56px;
            }

            h1 {
                margin: 0 0 8px;
                font-size: 22px;
                font-weight: 700;
            }

            p.lead {
                margin: 0 0 24px;
                color: #4b5563;
                font-size: 14px;
                line-height: 1.55;
            }

            p.lead code,
            footer code {
                background: #eef1f5;
                padding: 1px 5px;
                border-radius: 4px;
                font-size: 13px;
            }

            zulip-chat {
                width: 100%;
                height: 560px;
                display: block;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 10px 30px -12px rgba(17, 24, 39, 0.25);
            }

            footer {
                margin-top: 20px;
                font-size: 12px;
                color: #6b7280;
                text-align: center;
            }
        `,
    ],
})
export class AppComponent {}
