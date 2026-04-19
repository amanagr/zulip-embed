# zulip_embed

First-class Flutter widgets for embedding [Zulip](https://zulip.com) chat into any Flutter app — iOS, Android, macOS, Windows, Linux, or web.

No WebView. No JavaScript bridge. Pure Dart widgets that talk to the Zulip REST API directly, with a pluggable transport so you can swap in a fake for tests and demos.

## Install

```yaml
dependencies:
  zulip_embed: ^0.1.0
```

## Quickstart

```dart
import 'package:flutter/material.dart';
import 'package:zulip_embed/zulip_embed.dart';

void main() => runApp(const MyApp());

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) {
    final transport = ZulipTransport(
      serverUrl: Uri.parse('https://chat.example.com'),
      email: 'you@example.com',
      apiKey: const String.fromEnvironment('ZULIP_API_KEY'),
    );
    return MaterialApp(
      home: Scaffold(
        body: ZulipChat(
          transport: transport,
          channel: 'general',
          topic: 'welcome',
        ),
      ),
    );
  }
}
```

## Demo mode

Render the widget without a Zulip server — handy for previews, docs, and tests:

```dart
ZulipChat(transport: DemoTransport(), channel: 'general', topic: 'welcome')
```

The demo transport seeds two welcome messages and echoes whatever the user sends after an ~800 ms delay. Everything is in-process; no network involved.

## Theming

Pass a [`ZulipTheme`](lib/src/theme.dart) — pick `light`/`dark` or build your own:

```dart
ZulipChat(
  transport: transport,
  channel: 'general',
  theme: ZulipTheme.dark,
)
```

## Architecture

```
ZulipChat (widget)
   └── ZulipClient (state)
         └── Transport (IO)
               ├── DemoTransport  — in-process fake
               └── ZulipTransport — real REST + long-poll
```

The `Transport` boundary keeps the widgets ignorant of HTTP, so you can drop in a mock for tests or point at a proxy for corporate-network installs.

## Example app

An example app with a runtime-switchable demo/live mode and a light/dark toggle lives in [`example/`](example/). Run it with `flutter run` from that directory.

## Status

- [x] `ZulipChat` widget (header, message list, composer)
- [x] `DemoTransport` with echo bot
- [x] `ZulipTransport` with `/api/v1/register`, `/api/v1/events` long-poll, `/api/v1/messages`
- [x] `ZulipTheme` with light + dark presets
- [ ] Pagination / older-messages loading
- [ ] Markdown rendering (currently renders HTML-stripped text)
- [ ] Reactions, threads, typing indicators
- [ ] JWT SSO / ephemeral credential flow

## License

Apache-2.0 — same as the companion Web Component at the root of this repo.
