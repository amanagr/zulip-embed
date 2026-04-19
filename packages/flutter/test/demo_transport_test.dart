import 'package:flutter_test/flutter_test.dart';
import 'package:zulip_embed/zulip_embed.dart';

void main() {
  group('DemoTransport', () {
    test('reports connecting then connected on connect()', () async {
      final transport = DemoTransport();
      final events = <ZulipEvent>[];
      await transport.connect(
        scope: const ScopeFilter(channel: 'general', topic: 'welcome'),
        onEvent: events.add,
      );
      final statuses =
          events.whereType<ConnectionEvent>().map((e) => e.status).toList();
      expect(statuses.first, ConnectionStatus.connecting);
      expect(statuses.last, ConnectionStatus.connected);
      await transport.close();
    });

    test('seeds welcome messages scoped to the channel/topic', () async {
      final transport = DemoTransport();
      await transport.connect(
        scope: const ScopeFilter(channel: 'design', topic: 'intro'),
        onEvent: (_) {},
      );
      final messages = await transport.getMessages(
        scope: const ScopeFilter(channel: 'design', topic: 'intro'),
      );
      expect(messages.length, greaterThanOrEqualTo(2));
      expect(
        messages.every(
          (m) => m is ChannelMessage && m.channelName == 'design',
        ),
        isTrue,
      );
      expect(
        messages.every((m) => m is ChannelMessage && m.topic == 'intro'),
        isTrue,
      );
      await transport.close();
    });

    test('sendMessage emits the sent message and an echo reply', () async {
      final transport = DemoTransport();
      final events = <ZulipEvent>[];
      await transport.connect(
        scope: const ScopeFilter(channel: 'general', topic: 'welcome'),
        onEvent: events.add,
      );
      await transport.sendMessage(
        const ChannelSendParams(
          channel: 'general',
          topic: 'welcome',
          content: 'Hello Zulip',
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 1000));
      final messages =
          events.whereType<MessageEvent>().map((e) => e.message).toList();
      expect(messages.length, greaterThanOrEqualTo(2));
      expect(messages.first.content, 'Hello Zulip');
      expect(messages[1].content, contains('Echo: Hello Zulip'));
      await transport.close();
    });

    test('close() cancels any pending echo replies', () async {
      final transport = DemoTransport();
      final events = <ZulipEvent>[];
      await transport.connect(
        scope: const ScopeFilter(channel: 'general'),
        onEvent: events.add,
      );
      await transport.sendMessage(
        const ChannelSendParams(
          channel: 'general',
          topic: 'general chat',
          content: 'hi',
        ),
      );
      final before = events.whereType<MessageEvent>().length;
      await transport.close();
      await Future<void>.delayed(const Duration(milliseconds: 1000));
      final after = events.whereType<MessageEvent>().length;
      expect(after, before);
    });
  });

  group('ZulipClient', () {
    test('rebroadcasts transport events via a broadcast stream', () async {
      final transport = DemoTransport();
      final client = ZulipClient(transport);
      final received = <ZulipEvent>[];
      final sub = client.events.listen(received.add);
      await client.connect(const ScopeFilter(channel: 'general'));
      await client.sendMessage('ping');
      await Future<void>.delayed(const Duration(milliseconds: 1000));
      await sub.cancel();
      await client.dispose();
      expect(received.whereType<ConnectionEvent>(), isNotEmpty);
      expect(received.whereType<MessageEvent>().length, greaterThanOrEqualTo(2));
    });
  });
}
