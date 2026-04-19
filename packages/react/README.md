# @zulip/react

Thin React wrappers around the framework-agnostic
[`@zulip/embed`](https://github.com/zulip/zulip-embed) Web Components.

## Install

```sh
pnpm add @zulip/embed @zulip/react
```

`@zulip/embed` is a peer dependency — install both. Importing from
`@zulip/react` registers the Web Components as a side effect, so you
don't also need an explicit `import "@zulip/embed"`.

## Usage

### Embedded chat

```tsx
import {ZulipChat} from "@zulip/react";

export function SupportPage() {
  return (
    <ZulipChat
      server="https://chat.example.com"
      email="you@example.com"
      apiKey={import.meta.env.VITE_ZULIP_KEY}
      channel="general"
      topic="welcome"
      theme="light"
      mode="inline"
      brandName="Acme Support"
      brandLogo="/logo.png"
    />
  );
}
```

### Channel + topic pickers

```tsx
import {ZulipChannelList, ZulipTopicList} from "@zulip/react";

export function Sidebar() {
  const [channel, setChannel] = useState("general");
  return (
    <>
      <ZulipChannelList
        snapshotUrl="/data/channels.json"
        theme="light"
        onChannelSelected={(c) => setChannel(c.name)}
      />
      <ZulipTopicList
        snapshotUrl="/data/channels.json"
        channel={channel}
        onTopicSelected={(t) => console.log(t.topic)}
      />
    </>
  );
}
```

## Offline modes

- `demo` — seeded messages + echo bot, no network.
- `snapshotUrl` — pre-fetched JSON payload (read-only).

## Imperative access

```tsx
const ref = useRef<ZulipChatElement>(null);
// ...
<ZulipChat ref={ref} mode="floating" demo channel="general" />;
// Later:
ref.current?.open();
ref.current?.close();
```

## License

Apache-2.0
