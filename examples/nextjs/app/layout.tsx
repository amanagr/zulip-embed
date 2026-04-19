import type {ReactNode} from "react";

export const metadata = {
    title: "Zulip Embed — Next.js example",
    description:
        "Minimal Next.js App Router app showing how to mount <zulip-chat> inside a client wrapper.",
};

export default function RootLayout({children}: {children: ReactNode}) {
    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    fontFamily:
                        "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
                    background: "#f7f7f9",
                    color: "#111827",
                }}
            >
                {children}
            </body>
        </html>
    );
}
