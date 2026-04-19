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

  /// Edit a message's content, topic, or both. Transports that cannot
  /// mutate (snapshot) should throw `StateError`.
  Future<void> editMessage(EditMessageParams params);

  /// Delete a message. Transports that cannot mutate (snapshot) should
  /// throw `StateError`.
  Future<void> deleteMessage(int messageId);

  /// Fire a typing ping for [scope]. Best-effort — transports without
  /// typing support (snapshot, demo) inherit the default no-op and the
  /// composer's debounced emitter doesn't need to feature-detect.
  Future<void> sendTyping({
    required TypingOp op,
    required ScopeFilter scope,
  }) async {}

  /// List channels visible to the connected viewer. Default implementation
  /// returns empty so transports that don't enumerate subscriptions
  /// (snapshot) can stay quiet without overriding.
  Future<List<Channel>> listChannels() async => const [];

  /// List topics inside [channel]. Same default rationale as listChannels.
  Future<List<Topic>> listTopics(String channel) async => const [];
}
