import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zulip_embed/zulip_embed.dart';

void main() {
  testWidgets('ZulipChat renders seeded demo messages', (tester) async {
    final transport = DemoTransport();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ZulipChat(
            transport: transport,
            channel: 'general',
            topic: 'welcome',
          ),
        ),
      ),
    );
    // Let connect + fetch complete.
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle(const Duration(milliseconds: 300));

    expect(find.text('#general'), findsOneWidget);
    expect(find.text('welcome'), findsOneWidget);
    expect(find.textContaining('Welcome to the Zulip embed preview'),
        findsOneWidget);
  });

  testWidgets('Composer is disabled until the client reports connected',
      (tester) async {
    final transport = DemoTransport();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ZulipChat(transport: transport, channel: 'general'),
        ),
      ),
    );
    // Right after pump, still connecting.
    final textFieldFinder = find.byType(TextField);
    expect(textFieldFinder, findsOneWidget);
    await tester.pumpAndSettle(const Duration(milliseconds: 400));
    expect(
      tester.widget<TextField>(textFieldFinder).enabled,
      isTrue,
    );
  });
}
