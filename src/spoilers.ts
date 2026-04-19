// Wire up Zulip spoiler blocks so the header acts as a reveal toggle.
//
// Zulip's server renders spoilers as:
//   <div class="spoiler-block">
//     <div class="spoiler-header">…</div>
//     <div class="spoiler-content" aria-hidden="true">…</div>
//   </div>
//
// The sanitizer preserves this structure but doesn't know anything about
// interactivity. This pass walks the rendered DOM and layers on click +
// keyboard behavior, plus a fallback header label when the author didn't
// supply one. It's idempotent — re-running on already-enhanced nodes is
// a no-op — so callers can invoke it after every render pass without
// tracking which nodes are new.
export function enhanceSpoilers(root: ParentNode): void {
    const blocks = root.querySelectorAll<HTMLElement>(".spoiler-block");
    for (const block of blocks) {
        const header = block.querySelector<HTMLElement>(":scope > .spoiler-header");
        const content = block.querySelector<HTMLElement>(":scope > .spoiler-content");
        if (header === null || content === null) continue;
        if (header.dataset["zcSpoiler"] === "ready") continue;
        header.dataset["zcSpoiler"] = "ready";

        if (header.textContent?.trim() === "") {
            header.textContent = "Spoiler";
        }
        header.setAttribute("role", "button");
        header.setAttribute("tabindex", "0");
        header.setAttribute("aria-expanded", "false");
        content.setAttribute("aria-hidden", "true");
        block.dataset["revealed"] = "false";

        const toggle = (): void => {
            const revealed = block.dataset["revealed"] === "true";
            const next = !revealed;
            block.dataset["revealed"] = next ? "true" : "false";
            header.setAttribute("aria-expanded", next ? "true" : "false");
            content.setAttribute("aria-hidden", next ? "false" : "true");
        };

        header.addEventListener("click", toggle);
        header.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle();
            }
        });
    }
}
