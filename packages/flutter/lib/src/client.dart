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

  Future<Message> sendMessage(String content) {
    final s = _scope;
    if (s == null) {
      throw StateError('ZulipClient.sendMessage called before connect().');
    }
    return transport.sendMessage(
      SendMessageParams(channel: s.channel, topic: s.topic, content: content),
    );
  }

  Future<void> editMessage({
    required int messageId,
    String? content,
    String? topic,
  }) {
    return transport.editMessage(EditMessageParams(
      messageId: messageId,
      content: content,
      topic: topic,
    ));
  }

  Future<void> deleteMessage(int messageId) {
    return transport.deleteMessage(messageId);
  }

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
