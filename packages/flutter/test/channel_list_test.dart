import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zulip_embed/zulip_embed.dart';

void main() {
  testWidgets('ZulipChannelList renders the demo channel and fires callback',
      (tester) async {
    final transport = DemoTransport();
    // Demo connect is a no-op for the list, but we emulate the usual
    // lifecycle so listChannels has something to enumerate.
    await transport.connect(
      scope: const ScopeFilter.channel('general', topic: 'welcome'),
      onEvent: (_) {},
    );

    Channel? tapped;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ZulipChannelList(
            transport: transport,
            onChannelSelected: (c) => tapped = c,
          ),
        ),
      ),
    );
    // Can't use pumpAndSettle here because ZulipChannelList renders a
    // CircularProgressIndicator while loading and its ticker never
    // settles. Pump manually past the demo-transport microtask hop and
    // the widget's setState that clears the loading flag.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final rowFinder = find.text('#general');
    expect(rowFinder, findsOneWidget);
    await tester.tap(rowFinder);
    expect(tapped, isNotNull);
    expect(tapped!.name, 'general');

    await transport.close();
  });

  testWidgets('ZulipTopicList renders topics after connecting',
      (tester) async {
    final transport = DemoTransport();
    await transport.connect(
      scope: const ScopeFilter.channel('general', topic: 'welcome'),
      onEvent: (_) {},
    );

    Topic? tapped;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ZulipTopicList(
            transport: transport,
            channel: 'general',
            onTopicSelected: (t) => tapped = t,
          ),
        ),
      ),
    );
    // Can't use pumpAndSettle here because ZulipChannelList renders a
    // CircularProgressIndicator while loading and its ticker never
    // settles. Pump manually past the demo-transport microtask hop and
    // the widget's setState that clears the loading flag.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final rowFinder = find.text('welcome');
    expect(rowFinder, findsOneWidget);
    await tester.tap(rowFinder);
    expect(tapped, isNotNull);
    expect(tapped!.name, 'welcome');

    await transport.close();
  });
}
