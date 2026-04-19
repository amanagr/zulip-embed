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
}
