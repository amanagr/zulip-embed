/// First-class Flutter widgets for embedding Zulip chat.
///
/// Typical usage:
/// ```dart
/// ZulipChat(
///   transport: ZulipTransport(
///     serverUrl: Uri.parse('https://chat.example.com'),
///     email: 'you@example.com',
///     apiKey: '...',
///   ),
///   channel: 'general',
///   topic: 'welcome',
/// )
/// ```
library;

export 'src/client.dart';
export 'src/demo_transport.dart';
export 'src/format.dart' show avatarColor, formatTime, initialsFor;
export 'src/snapshot_transport.dart';
export 'src/theme.dart';
export 'src/transport.dart';
export 'src/types.dart';
export 'src/widgets/composer.dart' show Composer;
export 'src/widgets/message_list.dart' show MessageList;
export 'src/widgets/zulip_chat.dart' show ZulipChat;
export 'src/zulip_transport.dart';
