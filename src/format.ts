const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
    const delta = now - timestamp;
    if (delta < MINUTE) return "just now";
    if (delta < HOUR) {
        const mins = Math.floor(delta / MINUTE);
        return `${String(mins)} min${mins === 1 ? "" : "s"} ago`;
    }
    if (delta < DAY) {
        const hours = Math.floor(delta / HOUR);
        return `${String(hours)} hour${hours === 1 ? "" : "s"} ago`;
    }
    const days = Math.floor(delta / DAY);
    return `${String(days)} day${days === 1 ? "" : "s"} ago`;
}

export function formatTimeOfDay(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"});
}

export function getInitials(fullName: string): string {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
    return (first + last).toUpperCase();
}

const AVATAR_PALETTE = [
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
    "#f97316",
];

export function avatarColor(seed: number): string {
    const index = Math.abs(seed) % AVATAR_PALETTE.length;
    return AVATAR_PALETTE[index] ?? "#3b82f6";
}
