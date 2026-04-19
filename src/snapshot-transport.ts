import type {
    GetMessagesOptions,
    GetMessagesResult,
    ReactionParams,
    Transport,
} from "./transport.ts";
import type {
    Message,
    ScopeFilter,
    SendMessageParams,
    ZulipEventListener,
} from "./types.ts";

export interface SnapshotFile {
    // Schema version so consumers can bail out if the on-disk format changes.
    // Bumped whenever a field is removed or semantically reinterpreted.
    version: 1;
    generatedAt: number;
    server: string;
    channel: string;
    topic: string | undefined;
    messages: Message[];
}

export interface SnapshotTransportOptions {
    url: string;
    scope: ScopeFilter;
    // Optional inline payload; when provided we skip the fetch entirely.
    // Useful for tests and for consumers that want to deliver the JSON
    // through their own plumbing.
    data?: SnapshotFile;
}

// Read-only transport that serves a pre-fetched JSON snapshot. Used by the
// demo site to show a close-to-live view of chat.zulip.org's #announce
// feed: a GitHub Action pulls the latest messages with a bot key at deploy
// time, bakes them into a JSON file, and the component fetches that file
// at runtime. No credentials ever reach the browser.
export class SnapshotTransport implements Transport {
    private readonly url: string;
    private readonly scope: ScopeFilter;
    private readonly inline: SnapshotFile | undefined;
    private messages: Message[] = [];
    private onEvent: ZulipEventListener | undefined;

    constructor(options: SnapshotTransportOptions) {
        this.url = options.url;
        this.scope = options.scope;
        this.inline = options.data;
    }

    async connect(onEvent: ZulipEventListener): Promise<void> {
        this.onEvent = onEvent;
        try {
            const file = this.inline ?? (await this.fetchSnapshot());
            this.messages = filterToScope(file.messages, this.scope);
            onEvent({type: "connection", status: "connected"});
        } catch (error) {
            onEvent({type: "connection", status: "error"});
            onEvent({type: "error", error: describeError(error)});
            throw error;
        }
    }

    async close(): Promise<void> {
        this.onEvent?.({type: "connection", status: "disconnected"});
        this.onEvent = undefined;
        return Promise.resolve();
    }

    async getMessages(
        _scope: ScopeFilter,
        options: GetMessagesOptions = {},
    ): Promise<GetMessagesResult> {
        // Snapshots are a fixed window — there is no backlog to paginate
        // into. Return everything on the first call and stop the scroll-up
        // loader by reporting hasMore=false.
        if (options.beforeId !== undefined) {
            return Promise.resolve({messages: [], hasMore: false});
        }
        return Promise.resolve({messages: [...this.messages], hasMore: false});
    }

    sendMessage(_params: SendMessageParams): Promise<void> {
        return Promise.reject(new Error("Snapshot transport is read-only"));
    }

    addReaction(_params: ReactionParams): Promise<void> {
        return Promise.reject(new Error("Snapshot transport is read-only"));
    }

    removeReaction(_params: ReactionParams): Promise<void> {
        return Promise.reject(new Error("Snapshot transport is read-only"));
    }

    getCurrentUserId(): number | undefined {
        // Snapshots are anonymous reads — there is no logged-in viewer, so
        // reaction highlighting treats every emoji as "not mine".
        return undefined;
    }

    private async fetchSnapshot(): Promise<SnapshotFile> {
        const response = await fetch(this.url);
        if (!response.ok) {
            throw new Error(
                `Failed to load snapshot from ${this.url}: HTTP ${String(response.status)}`,
            );
        }
        const body: unknown = await response.json();
        return parseSnapshot(body);
    }
}

function filterToScope(messages: Message[], scope: ScopeFilter): Message[] {
    return messages.filter((m) => {
        if (m.channelName !== scope.channel) return false;
        if (scope.topic !== undefined && m.topic !== scope.topic) return false;
        return true;
    });
}

// Hand-rolled validator rather than pulling zod in here — the snapshot
// format is narrow and stable, and we already validate at write time in
// the fetch script. Better to fail loudly with a specific field name than
// to carry a schema lib just for this.
function parseSnapshot(raw: unknown): SnapshotFile {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("Snapshot file is not a JSON object");
    }
    const obj = raw as Record<string, unknown>;
    if (obj["version"] !== 1) {
        throw new Error(
            `Unsupported snapshot version: ${String(obj["version"])} (expected 1)`,
        );
    }
    if (!Array.isArray(obj["messages"])) {
        throw new Error("Snapshot.messages is not an array");
    }
    return {
        version: 1,
        generatedAt: typeof obj["generatedAt"] === "number" ? obj["generatedAt"] : 0,
        server: typeof obj["server"] === "string" ? obj["server"] : "",
        channel: typeof obj["channel"] === "string" ? obj["channel"] : "",
        topic: typeof obj["topic"] === "string" ? obj["topic"] : undefined,
        messages: obj["messages"] as Message[],
    };
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
