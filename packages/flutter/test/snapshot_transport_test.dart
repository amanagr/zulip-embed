import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zulip_embed/zulip_embed.dart';

Map<String, dynamic> _fixture({
  String channel = 'general',
  String topic = 'welcome',
}) {
  return {
    'version': 1,
    'generatedAt': 1700000000000,
    'server': 'https://chat.zulip.org',
    'channel': channel,
    'topic': topic,
    'messages': [
      {
        'id': 1,
        'senderId': 10,
        'senderFullName': 'Alice',
        'senderEmail': 'a@x',
        'avatarUrl': '',
        'timestamp': 1700000000000,
        'content': '<p>hello</p>',
        'contentIsHtml': true,
        'type': 'channel',
        'channelName': channel,
        'topic': topic,
        'reactions': [],
      },
      {
        'id': 2,
        'senderId': 11,
        'senderFullName': 'Bob',
        'senderEmail': 'b@x',
        'avatarUrl': '',
        'timestamp': 1700000001000,
        'content': 'off-topic',
        'contentIsHtml': false,
        'type': 'channel',
        'channelName': channel,
        'topic': 'other',
        'reactions': [],
      },
    ],
  };
}

void main() {
  group('SnapshotTransport', () {
    test('loads snapshot over http and filters to scope', () async {
      final client = MockClient((req) async {
        expect(req.url.toString(), 'https://example.test/snap.json');
        return http.Response(jsonEncode(_fixture()), 200);
      });
      final transport = SnapshotTransport(
        url: 'https://example.test/snap.json',
        httpClient: client,
      );
      final events = <ZulipEvent>[];
      await transport.connect(
        scope: const ScopeFilter(channel: 'general', topic: 'welcome'),
        onEvent: events.add,
      );
      final messages = await transport.getMessages(
        scope: const ScopeFilter(channel: 'general', topic: 'welcome'),
      );
      expect(messages, hasLength(1));
      expect(messages.first.id, 1);
      expect(events.last, isA<ConnectionEvent>());
      await transport.close();
    });

    test('accepts inline data without hitting the network', () async {
      final transport = SnapshotTransport(
        url: 'unused',
        inlineData: _fixture(),
      );
      await transport.connect(
        scope: const ScopeFilter(channel: 'general'),
        onEvent: (_) {},
      );
      final messages = await transport.getMessages(
        scope: const ScopeFilter(channel: 'general'),
      );
      // No topic filter — both messages survive.
      expect(messages, hasLength(2));
      await transport.close();
    });

    test('rejects sendMessage with a clear error', () async {
      final transport = SnapshotTransport(
        url: 'unused',
        inlineData: _fixture(),
      );
      await transport.connect(
        scope: const ScopeFilter(channel: 'general'),
        onEvent: (_) {},
      );
      await expectLater(
        transport.sendMessage(
          const ChannelSendParams(
            channel: 'general',
            topic: 'general chat',
            content: 'hi',
          ),
        ),
        throwsA(isA<StateError>()),
      );
      await transport.close();
    });

    test('rejects unsafe url schemes at construction', () {
      expect(
        () => SnapshotTransport(url: 'javascript:alert(1)'),
        throwsArgumentError,
      );
      expect(
        () => SnapshotTransport(url: 'file:///etc/passwd'),
        throwsArgumentError,
      );
      expect(
        () => SnapshotTransport(url: '//evil.tld/snap.json'),
        throwsArgumentError,
      );
      expect(
        () => SnapshotTransport(url: ''),
        throwsArgumentError,
      );
    });

    test('rejects unsupported snapshot version', () async {
      final transport = SnapshotTransport(
        url: 'unused',
        inlineData: {
          'version': 2,
          'generatedAt': 0,
          'server': '',
          'channel': 'general',
          'messages': [],
        },
      );
      await expectLater(
        transport.connect(
          scope: const ScopeFilter(channel: 'general'),
          onEvent: (_) {},
        ),
        throwsA(isA<FormatException>()),
      );
    });
  });
}
