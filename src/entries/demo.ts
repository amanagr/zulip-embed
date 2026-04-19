// zulip-embed/demo — in-memory and snapshot transports for offline
// development, storybooks, and static landing pages. No custom-element
// registration; pair with /chat or /all when you need the UI.

export {DemoTransport} from "../demo-transport.ts";
export type {DemoTransportOptions} from "../demo-transport.ts";
export {SnapshotTransport} from "../snapshot-transport.ts";
export type {SnapshotFile, SnapshotTransportOptions} from "../snapshot-transport.ts";
export type {Transport} from "../transport.ts";
