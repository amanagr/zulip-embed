import "zone.js";
// Side-effect import: registers <zulip-chat> as a Custom Element.
// Angular renders any tag listed under a component's `schemas` as a
// plain DOM element once the element is defined. See
// `app/app.component.ts` for the `CUSTOM_ELEMENTS_SCHEMA` hook.
import "zulip-embed/chat";

import {bootstrapApplication} from "@angular/platform-browser";
import {AppComponent} from "./app/app.component";

bootstrapApplication(AppComponent).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
});
