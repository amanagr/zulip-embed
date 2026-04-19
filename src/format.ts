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

const AVATAR_HUE_COUNT = 12;
const AVATAR_HUE_STEP = 360 / AVATAR_HUE_COUNT;
const AVATAR_HUE_OFFSET = 40;
const AVATAR_SATURATION = 68;
const AVATAR_LIGHTNESS_START = 55;
const AVATAR_LIGHTNESS_END = 42;

export function avatarColor(seed: number): string {
    const bucket = Math.abs(seed) % AVATAR_HUE_COUNT;
    const h1 = Math.round(bucket * AVATAR_HUE_STEP);
    const h2 = (h1 + AVATAR_HUE_OFFSET) % 360;
    const start = `hsl(${String(h1)}, ${String(AVATAR_SATURATION)}%, ${String(AVATAR_LIGHTNESS_START)}%)`;
    const end = `hsl(${String(h2)}, ${String(AVATAR_SATURATION)}%, ${String(AVATAR_LIGHTNESS_END)}%)`;
    return `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
}
