import 'dart:async';

import 'transport.dart';
import 'types.dart';

const int _demoBotId = 1;
const int _viewerId = 2;

/// In-memory fake transport that seeds a few messages and echoes whatever
/// you send after a short delay. Useful for docs, examples, and tests so
/// the widgets render without a Zulip server.
class DemoTransport extends Transport {
  final List<Message> _messages = [];
  final Set<Timer> _pendingReplies = {};
  int _nextId = 1000;
  ZulipEventListener? _listener;

  @override
  int? get currentUserId => _viewerId;

  @override
  Future<void> connect({
    required ScopeFilter scope,
    required ZulipEventListener onEvent,
  }) async {
    _listener = onEvent;
    onEvent(const ConnectionEvent(ConnectionStatus.connecting));
    _seed(scope);
    await Future<void>.delayed(const Duration(milliseconds: 150));
    onEvent(const ConnectionEvent(ConnectionStatus.connected));
  }

  void _seed(ScopeFilter scope) {
    final topic = scope.topic ?? 'welcome';
    final now = DateTime.now();
    _messages.addAll([
      Message(
        id: 1,
        senderId: _demoBotId,
        senderName: 'Zulip Bot',
        channel: scope.channel,
        topic: topic,
        content: 'Welcome to the Zulip embed preview. 👋',
        timestamp: now.subtract(const Duration(minutes: 5)),
      ),
      Message(
        id: 2,
        senderId: _demoBotId,
        senderName: 'Zulip Bot',
        channel: scope.channel,
        topic: topic,
        content:
            'Messages you send will be echoed back by this in-process bot — '
            'no Zulip server is involved in demo mode.',
        timestamp: now.subtract(const Duration(minutes: 4)),
      ),
    ]);
  }

  @override
  Future<void> close() async {
    for (final t in _pendingReplies) {
      t.cancel();
    }
    _pendingReplies.clear();
    _listener = null;
  }

  @override
  Future<List<Message>> getMessages({
    required ScopeFilter scope,
    int limit = 50,
  }) async {
    final matching = _messages.where((m) {
      if (m.channel != scope.channel) return false;
      if (scope.topic != null && m.topic != scope.topic) return false;
      return true;
    }).toList();
    if (matching.length <= limit) return matching;
    return matching.sublist(matching.length - limit);
  }

  @override
  Future<Message> sendMessage(SendMessageParams params) async {
    final msg = Message(
      id: _nextId++,
      senderId: _viewerId,
      senderName: 'You',
      channel: params.channel,
      topic: params.topic ?? 'general chat',
      content: params.content,
      timestamp: DateTime.now(),
    );
    _messages.add(msg);
    _listener?.call(MessageEvent(msg));
    _scheduleEcho(msg);
    return msg;
  }

  void _scheduleEcho(Message prompt) {
    late Timer timer;
    timer = Timer(const Duration(milliseconds: 800), () {
      _pendingReplies.remove(timer);
      if (_listener == null) return;
      final reply = Message(
        id: _nextId++,
        senderId: _demoBotId,
        senderName: 'Zulip Bot',
        channel: prompt.channel,
        topic: prompt.topic,
        content: _echoReply(prompt.content),
        timestamp: DateTime.now(),
      );
      _messages.add(reply);
      _listener?.call(MessageEvent(reply));
    });
    _pendingReplies.add(timer);
  }

  String _echoReply(String content) {
    final trimmed = content.trim();
    if (trimmed.isEmpty) return 'I heard… nothing?';
    if (trimmed.endsWith('?')) {
      return 'Great question — in a real deployment your team would answer '
          'this in #${_messages.last.channel} > ${_messages.last.topic}.';
    }
    return 'Echo: $trimmed';
  }
}
