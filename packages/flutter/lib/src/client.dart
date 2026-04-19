import 'dart:async';

import 'transport.dart';
import 'types.dart';

/// Thin stateful wrapper around a [Transport] that tracks the active scope,
/// the last-seen connection status, and rebroadcasts transport events over
/// a Dart [Stream].
class ZulipClient {
  ZulipClient(this.transport);

  final Transport transport;
  final _controller = StreamController<ZulipEvent>.broadcast();
  ConnectionStatus _status = ConnectionStatus.disconnected;
  ScopeFilter? _scope;

  ConnectionStatus get status => _status;
  Stream<ZulipEvent> get events => _controller.stream;
  int? get currentUserId => transport.currentUserId;
  ScopeFilter? get scope => _scope;

  /// Resolves with the connected viewer's full [User] record once the
  /// transport has fetched `/users/me` (or the equivalent for synthetic
  /// transports). Prefer this over [currentUserId] when you need the
  /// email / full name / avatar, or when you want to await readiness.
  /// Mirrors TS `ZulipClient.whenReady`.
  Future<User> get whenReady => transport.getCurrentUser();

  Future<void> connect(ScopeFilter scope) async {
    _scope = scope;
    await transport.connect(
      scope: scope,
      onEvent: (event) {
        if (event is ConnectionEvent) _status = event.status;
        _controller.add(event);
      },
    );
  }

  Future<List<Message>> fetchMessages({int limit = 50}) {
    final s = _scope;
    if (s == null) {
      throw StateError('ZulipClient.fetchMessages called before connect().');
    }
    return transport.getMessages(scope: s, limit: limit);
  }

  /// Post [content] into the currently-connected scope. For DM flows or
  /// sending to a channel other than the active scope, call
  /// [sendMessageWithParams] directly.
  Future<Message> sendMessage(String content) {
    final s = _scope;
    if (s == null) {
      throw StateError('ZulipClient.sendMessage called before connect().');
    }
    return transport.sendMessage(
      ChannelSendParams(
        channel: s.channel,
        topic: s.topic ?? 'general chat',
        content: content,
      ),
    );
  }

  /// Send a message using an explicit discriminated [SendMessageParams]
  /// (either [ChannelSendParams] or [DirectSendParams]). Does not require
  /// an active scope.
  Future<Message> sendMessageWithParams(SendMessageParams params) =>
      transport.sendMessage(params);

  /// Convenience: edit the content and/or topic of [messageId]. Routes
  /// to the appropriate [EditMessageParams] subclass. Callers that want
  /// a strictly-typed call site can use [editMessageWithParams] instead.
  Future<void> editMessage({
    required int messageId,
    String? content,
    String? topic,
  }) {
    if (content == null && topic == null) {
      throw ArgumentError(
        'editMessage: must pass content, topic, or both (received neither).',
      );
    }
    final EditMessageParams params;
    if (content != null && topic != null) {
      params = EditContentAndTopicParams(
        messageId: messageId,
        content: content,
        topic: topic,
      );
    } else if (content != null) {
      params = EditContentParams(messageId: messageId, content: content);
    } else {
      params = EditTopicParams(messageId: messageId, topic: topic!);
    }
    return transport.editMessage(params);
  }

  /// Edit a message with an explicit discriminated [EditMessageParams].
  Future<void> editMessageWithParams(EditMessageParams params) =>
      transport.editMessage(params);

  Future<void> deleteMessage(int messageId) {
    return transport.deleteMessage(messageId);
  }

  Future<void> addReaction({required int messageId, required String emoji}) {
    return transport.addReaction(
      ReactionParams(messageId: messageId, emoji: emoji),
    );
  }

  Future<void> removeReaction({required int messageId, required String emoji}) {
    return transport.removeReaction(
      ReactionParams(messageId: messageId, emoji: emoji),
    );
  }

  Future<List<Channel>> listChannels() => transport.listChannels();
  Future<List<Topic>> listTopics(String channel) =>
      transport.listTopics(channel);

  /// Fire a typing start/stop ping for the current scope. Best-effort —
  /// failures are swallowed by the transport.
  Future<void> sendTyping(TypingOp op) async {
    final s = _scope;
    if (s == null) return;
    await transport.sendTyping(op: op, scope: s);
  }

  Future<void> dispose() async {
    await transport.close();
    await _controller.close();
  }
}
