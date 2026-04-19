import 'dart:async';

import 'transport.dart';
import 'types.dart';

const int _demoBotId = 1;
const int _viewerId = 2;

// Synthetic "guest" viewer for the in-process demo transport. Kept stable
// so tests and reaction-toggle logic can reason about ownership without a
// real /users/me round-trip. Mirrors DEMO_GUEST_USER in the TS SDK.
const User _demoGuestUser = User(
  id: _viewerId,
  fullName: 'You',
  email: 'you@example.com',
  avatarUrl: '',
);

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
  Future<User> getCurrentUser() async => _demoGuestUser;

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
      ChannelMessage(
        id: 1,
        senderId: _demoBotId,
        senderName: 'Zulip Bot',
        channelName: scope.channel,
        topic: topic,
        content: 'Welcome to the Zulip embed preview. 👋',
        timestamp: now.subtract(const Duration(minutes: 5)),
      ),
      ChannelMessage(
        id: 2,
        senderId: _demoBotId,
        senderName: 'Zulip Bot',
        channelName: scope.channel,
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
      // Demo transport only ever seeds ChannelMessages, but narrow
      // defensively so future DM support doesn't silently leak DMs
      // into channel scopes.
      if (m is! ChannelMessage) return false;
      if (m.channelName != scope.channel) return false;
      if (scope.topic != null && m.topic != scope.topic) return false;
      return true;
    }).toList();
    if (matching.length <= limit) return matching;
    return matching.sublist(matching.length - limit);
  }

  @override
  Future<List<Channel>> listChannels() async {
    final channels = <String, ChannelMessage>{};
    for (final m in _messages) {
      if (m is! ChannelMessage) continue;
      // Keep the most-recent message per channel for the summary.
      final prev = channels[m.channelName];
      if (prev == null || m.id > prev.id) channels[m.channelName] = m;
    }
    return [
      for (final entry in channels.entries)
        Channel(
          channelId: entry.value.id,
          name: entry.key,
          description: 'In-memory demo channel',
          color: '#7f56d9',
          pinToTop: true,
        ),
    ];
  }

  @override
  Future<List<Topic>> listTopics(String channel) async {
    final byTopic = <String, int>{};
    for (final m in _messages) {
      if (m is! ChannelMessage) continue;
      if (m.channelName != channel) continue;
      final prev = byTopic[m.topic] ?? -1;
      if (m.id > prev) byTopic[m.topic] = m.id;
    }
    final entries = byTopic.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    return [
      for (final e in entries) Topic(name: e.key, maxMessageId: e.value),
    ];
  }

  @override
  Future<Message> sendMessage(SendMessageParams params) async {
    // Demo transport only models channel sends today — DM support would
    // require a synthetic recipient directory. Accept but store a
    // ChannelMessage either way so existing widgets keep rendering.
    final Message msg = switch (params) {
      ChannelSendParams(
        :final channel,
        :final topic,
        :final content,
      ) =>
        ChannelMessage(
          id: _nextId++,
          senderId: _viewerId,
          senderName: 'You',
          channelName: channel,
          topic: topic,
          content: content,
          timestamp: DateTime.now(),
        ),
      DirectSendParams(:final recipients, :final content) => DirectMessage(
          id: _nextId++,
          senderId: _viewerId,
          senderName: 'You',
          recipients: [
            for (final email in recipients)
              User(id: 0, fullName: email, email: email),
          ],
          content: content,
          timestamp: DateTime.now(),
        ),
    };
    _messages.add(msg);
    _listener?.call(MessageEvent(msg));
    if (msg is ChannelMessage) _scheduleEcho(msg);
    return msg;
  }

  @override
  Future<void> editMessage(EditMessageParams params) async {
    final idx = _messages.indexWhere((m) => m.id == params.messageId);
    if (idx < 0) {
      throw StateError('Message ${params.messageId} not found');
    }
    final current = _messages[idx];
    if (current.senderId != _viewerId) {
      throw StateError('Only the author can edit this message');
    }
    final (String? newContent, String? newTopic) = switch (params) {
      EditContentParams(:final content) => (content, null),
      EditTopicParams(:final topic) => (null, topic),
      EditContentAndTopicParams(:final content, :final topic) => (
          content,
          topic,
        ),
    };
    _messages[idx] = current.copyWith(content: newContent, topic: newTopic);
    _listener?.call(
      MessageUpdateEvent(
        messageId: params.messageId,
        content: newContent,
        topic: newTopic,
        editedTimestamp: DateTime.now(),
      ),
    );
  }

  @override
  Future<void> deleteMessage(int messageId) async {
    final idx = _messages.indexWhere((m) => m.id == messageId);
    if (idx < 0) {
      throw StateError('Message $messageId not found');
    }
    if (_messages[idx].senderId != _viewerId) {
      throw StateError('Only the author can delete this message');
    }
    _messages.removeAt(idx);
    _listener?.call(MessageDeleteEvent(messageId));
  }

  @override
  Future<void> addReaction(ReactionParams params) async {
    _toggleReaction(params, add: true);
  }

  @override
  Future<void> removeReaction(ReactionParams params) async {
    _toggleReaction(params, add: false);
  }

  void _toggleReaction(ReactionParams params, {required bool add}) {
    final idx = _messages.indexWhere((m) => m.id == params.messageId);
    if (idx < 0) {
      throw StateError('Message ${params.messageId} not found');
    }
    final current = _messages[idx];
    final buckets = <String, Set<int>>{
      for (final r in current.reactions) r.emoji: r.userIds.toSet(),
    };
    final users = buckets.putIfAbsent(params.emoji, () => <int>{});
    if (add) {
      users.add(_viewerId);
    } else {
      users.remove(_viewerId);
      if (users.isEmpty) buckets.remove(params.emoji);
    }
    final next = [
      for (final entry in buckets.entries)
        Reaction(emoji: entry.key, userIds: entry.value.toList()),
    ];
    _messages[idx] = current.copyWith(reactions: next);
    _listener?.call(
      ReactionEvent(
        messageId: params.messageId,
        reactions: next,
      ),
    );
  }

  void _scheduleEcho(ChannelMessage prompt) {
    late Timer timer;
    timer = Timer(const Duration(milliseconds: 800), () {
      _pendingReplies.remove(timer);
      if (_listener == null) return;
      final reply = ChannelMessage(
        id: _nextId++,
        senderId: _demoBotId,
        senderName: 'Zulip Bot',
        channelName: prompt.channelName,
        topic: prompt.topic,
        content: _echoReply(prompt),
        timestamp: DateTime.now(),
      );
      _messages.add(reply);
      _listener?.call(MessageEvent(reply));
    });
    _pendingReplies.add(timer);
  }

  String _echoReply(ChannelMessage prompt) {
    final trimmed = prompt.content.trim();
    if (trimmed.isEmpty) return 'I heard… nothing?';
    if (trimmed.endsWith('?')) {
      return 'Great question — in a real deployment your team would answer '
          'this in #${prompt.channelName} > ${prompt.topic}.';
    }
    return 'Echo: $trimmed';
  }
}
