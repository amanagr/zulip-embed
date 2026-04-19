import 'types.dart';

typedef ZulipEventListener = void Function(ZulipEvent event);

/// Pluggable IO boundary. Implementations talk to a live Zulip server
/// ([ZulipTransport]) or a self-contained in-process fake ([DemoTransport]).
abstract class Transport {
  int? get currentUserId;

  Future<void> connect({
    required ScopeFilter scope,
    required ZulipEventListener onEvent,
  });

  Future<void> close();

  Future<List<Message>> getMessages({
    required ScopeFilter scope,
    int limit = 50,
  });

  Future<Message> sendMessage(SendMessageParams params);

  /// Fire a typing ping for [scope]. Best-effort — transports without
  /// typing support (snapshot, demo) inherit the default no-op and the
  /// composer's debounced emitter doesn't need to feature-detect.
  Future<void> sendTyping({
    required TypingOp op,
    required ScopeFilter scope,
  }) async {}
}
