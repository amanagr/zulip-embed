import type {Message, Stream, User} from "./types.ts";

const AVATAR_PLACEHOLDER = "";

export const DEMO_GUEST_USER: User = {
    userId: 1000,
    email: "you@example.com",
    fullName: "You",
    avatarUrl: AVATAR_PLACEHOLDER,
};

export const DEMO_USERS: User[] = [
    DEMO_GUEST_USER,
    {
        userId: 11,
        email: "ada@example.com",
        fullName: "Ada Lovelace",
        avatarUrl: AVATAR_PLACEHOLDER,
    },
    {
        userId: 12,
        email: "grace@example.com",
        fullName: "Grace Hopper",
        avatarUrl: AVATAR_PLACEHOLDER,
    },
    {
        userId: 13,
        email: "alan@example.com",
        fullName: "Alan Turing",
        avatarUrl: AVATAR_PLACEHOLDER,
    },
    {
        userId: 14,
        email: "zulip-bot@example.com",
        fullName: "Zulip Bot",
        avatarUrl: AVATAR_PLACEHOLDER,
    },
];

export const DEMO_STREAMS: Stream[] = [
    {streamId: 1, name: "general", description: "Say hello to the team"},
    {streamId: 2, name: "support", description: "Ask questions, share bugs"},
    {streamId: 3, name: "design", description: "Mocks, critiques, and color debates"},
];

const MINUTE = 60 * 1000;

function demoMessage(
    id: number,
    senderEmail: string,
    channel: string,
    topic: string,
    content: string,
    minutesAgo: number,
): Message {
    const sender = DEMO_USERS.find((u) => u.email === senderEmail);
    if (sender === undefined) {
        throw new Error(`Unknown demo sender: ${senderEmail}`);
    }
    return {
        id,
        senderId: sender.userId,
        senderFullName: sender.fullName,
        senderEmail: sender.email,
        avatarUrl: sender.avatarUrl,
        timestamp: Date.now() - minutesAgo * MINUTE,
        content,
        contentIsHtml: false,
        type: "stream",
        streamName: channel,
        topic,
        reactions: [],
    };
}

export function seedMessages(channel: string, topic: string | undefined): Message[] {
    const resolvedTopic = topic ?? "welcome";
    return [
        demoMessage(
            1,
            "ada@example.com",
            channel,
            resolvedTopic,
            "Welcome to the Zulip embed demo! This chat is powered by an in-memory transport, so nothing leaves your browser.",
            45,
        ),
        demoMessage(
            2,
            "grace@example.com",
            channel,
            resolvedTopic,
            "Try sending a message — Zulip Bot will echo it back after a moment.",
            30,
        ),
        demoMessage(
            3,
            "alan@example.com",
            channel,
            resolvedTopic,
            "Topics in Zulip let each conversation stay focused. This one is pinned to the topic shown in the header.",
            15,
        ),
        demoMessage(
            4,
            "zulip-bot@example.com",
            channel,
            resolvedTopic,
            "Ready when you are!",
            2,
        ),
    ];
}
