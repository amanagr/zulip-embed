import 'package:flutter/foundation.dart';

@immutable
class Reaction {
  const Reaction({
    required this.emoji,
    required this.userIds,
  });

  final String emoji;
  final List<int> userIds;
  int get count => userIds.length;
}

@immutable
class User {
  const User({
    required this.id,
    required this.fullName,
    required this.email,
    this.avatarUrl,
  });

  final int id;
  final String fullName;
  final String email;
  final String? avatarUrl;
}

/// A Zulip message. Discriminated by concrete subclass: either a
/// [ChannelMessage] (posted to `channelName` under `topic`) or a
/// [DirectMessage] (sent to a list of [User] recipients).
///
/// Mirrors the TypeScript `Message = ChannelMessage | DirectMessage` union.
/// Use `if (message is ChannelMessage)` / pattern matching (`switch`) to
/// narrow to the variant-specific fields.
sealed class Message {
  const Message({
    required this.id,
    required this.senderId,
    required this.senderName,
    required this.content,
    required this.timestamp,
    this.senderAvatarUrl,
    this.reactions = const [],
    this.contentIsHtml = false,
  });

  final int id;
  final int senderId;
  final String senderName;
  final String? senderAvatarUrl;
  final String content;
  final DateTime timestamp;
  final List<Reaction> reactions;
  final bool contentIsHtml;

  /// Copy with the fields that are safe to mutate post-send. Subclasses
  /// preserve their discriminator-specific fields (channelName/topic or
  /// recipients) so callers don't have to know which variant they hold.
  Message copyWith({
    String? content,
    bool? contentIsHtml,
    String? topic,
    List<Reaction>? reactions,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) || (other is Message && other.id == id);

  @override
  int get hashCode => id.hashCode;
}

/// A message posted to a channel topic. Mirrors TS `ChannelMessage`.
class ChannelMessage extends Message {
  const ChannelMessage({
    required super.id,
    required super.senderId,
    required super.senderName,
    required super.content,
    required super.timestamp,
    required this.channelName,
    required this.topic,
    super.senderAvatarUrl,
    super.reactions,
    super.contentIsHtml,
  });

  final String channelName;
  final String topic;

  @override
  ChannelMessage copyWith({
    String? content,
    bool? contentIsHtml,
    String? topic,
    List<Reaction>? reactions,
  }) {
    return ChannelMessage(
      id: id,
      senderId: senderId,
      senderName: senderName,
      senderAvatarUrl: senderAvatarUrl,
      channelName: channelName,
      topic: topic ?? this.topic,
      content: content ?? this.content,
      contentIsHtml: contentIsHtml ?? this.contentIsHtml,
      timestamp: timestamp,
      reactions: reactions ?? this.reactions,
    );
  }
}

/// A direct (private) message sent to one or more recipients. Mirrors
/// TS `DirectMessage`. `topic` is not meaningful for DMs, so a
/// [copyWith] that passes `topic` is ignored.
class DirectMessage extends Message {
  const DirectMessage({
    required super.id,
    required super.senderId,
    required super.senderName,
    required super.content,
    required super.timestamp,
    required this.recipients,
    super.senderAvatarUrl,
    super.reactions,
    super.contentIsHtml,
  });

  final List<User> recipients;

  @override
  DirectMessage copyWith({
    String? content,
    bool? contentIsHtml,
    String? topic, // ignored — DMs have no topic.
    List<Reaction>? reactions,
  }) {
    return DirectMessage(
      id: id,
      senderId: senderId,
      senderName: senderName,
      senderAvatarUrl: senderAvatarUrl,
      recipients: recipients,
      content: content ?? this.content,
      contentIsHtml: contentIsHtml ?? this.contentIsHtml,
      timestamp: timestamp,
      reactions: reactions ?? this.reactions,
    );
  }
}

enum ConnectionStatus {
  disconnected,
  connecting,
  connected,
  reconnecting,
  error,
}

enum TypingOp { start, stop }

/// Error classification surfaced to consumers. Mirrors TS `ErrorCode`.
/// Stable machine handle; pair with [ErrorEvent.message] for display.
enum ErrorCode {
  unauthorized,
  channelNotSubscribed,
  network,
  rateLimited,
  jwtNotConfigured,
  unknown,
}

@immutable
class TypingUser {
  const TypingUser({required this.userId, required this.fullName});
  final int userId;
  final String fullName;
}

/// Where messages are fetched from and sent to. Mirrors TS
/// `ScopeFilter`: a discriminated union of [ChannelScope] (narrow on a
/// channel + optional topic) and [DmScope] (narrow on a direct-message
/// conversation identified by a sorted user id list).
///
/// Construct with `ScopeFilter.channel(...)` / `ScopeFilter.dm(...)` and
/// branch with `switch (scope)` at the call site when the behavior
/// depends on the variant.
sealed class ScopeFilter {
  const ScopeFilter();

  /// Shortcut factory for a channel+topic scope.
  const factory ScopeFilter.channel(String channel, {String? topic}) =
      ChannelScope;

  /// Shortcut factory for a DM scope. The [userIds] list should include
  /// the viewer's own user id so the narrow resolves identically across
  /// peers. Canonicalization (dedupe + sort ascending) happens lazily
  /// via [DmScope.canonicalUserIds].
  const factory ScopeFilter.dm(List<int> userIds) = DmScope;
}

/// A channel + optional topic narrow. Topic null means "all topics".
@immutable
class ChannelScope extends ScopeFilter {
  const ChannelScope(this.channel, {this.topic});
  final String channel;
  final String? topic;
}

/// A direct-message conversation identified by the full participant set
/// (always including the viewer). The SDK treats two [DmScope]s as
/// equivalent when their [canonicalUserIds] lists are equal.
@immutable
class DmScope extends ScopeFilter {
  const DmScope(this.userIds);

  /// Raw list supplied by the caller. May be unsorted / contain
  /// duplicates — use [canonicalUserIds] for equality checks.
  final List<int> userIds;

  /// Deduped, sorted copy of [userIds]. Mirrors the TS
  /// `canonicalUserIds` helper so both SDKs compute scope equality the
  /// same way.
  List<int> get canonicalUserIds {
    final set = <int>{};
    for (final id in userIds) {
      set.add(id);
    }
    final sorted = set.toList()..sort();
    return sorted;
  }
}

/// A direct-message conversation summary surfaced by
/// `Transport.listDirectMessageConversations`. Mirrors TS
/// `DirectMessageConversation`. Participants always include the viewer so
/// the set uniquely identifies the conversation across peers.
@immutable
class DirectMessageConversation {
  const DirectMessageConversation({
    required this.userIds,
    required this.users,
    this.lastMessageId,
    this.unreadCount = 0,
  });

  /// Canonical (deduped + sorted ascending) participant user ids.
  final List<int> userIds;

  /// Display records for the participants, aligned with [userIds] by
  /// user id. The order is not guaranteed.
  final List<User> users;

  /// Most-recent message id in the conversation, used to sort
  /// conversations by recency. Null when the transport can't report it.
  final int? lastMessageId;

  final int unreadCount;
}

@immutable
class Channel {
  const Channel({
    required this.channelId,
    required this.name,
    this.description = '',
    this.color,
    this.pinToTop = false,
    this.isMuted = false,
    this.unreadCount = 0,
  });

  final int channelId;
  final String name;
  final String description;
  final String? color;
  final bool pinToTop;
  final bool isMuted;
  final int unreadCount;
}

@immutable
class Topic {
  const Topic({
    required this.name,
    required this.maxMessageId,
    this.unreadCount = 0,
    this.isResolved = false,
  });

  final String name;
  final int maxMessageId;
  final int unreadCount;
  final bool isResolved;
}

/// Edit an existing message's content, topic, or both.
///
/// Discriminated by concrete subclass so call sites can't accidentally
/// send an empty PATCH or mis-specify which fields are being edited.
/// Mirrors the TS `EditMessageParams` union.
sealed class EditMessageParams {
  const EditMessageParams({required this.messageId});
  final int messageId;
}

/// Edit only the content body of [messageId].
class EditContentParams extends EditMessageParams {
  const EditContentParams({required super.messageId, required this.content});
  final String content;
}

/// Move [messageId] to a new topic without touching its content.
class EditTopicParams extends EditMessageParams {
  const EditTopicParams({required super.messageId, required this.topic});
  final String topic;
}

/// Edit both the content and the topic of [messageId] in one request.
class EditContentAndTopicParams extends EditMessageParams {
  const EditContentAndTopicParams({
    required super.messageId,
    required this.content,
    required this.topic,
  });
  final String content;
  final String topic;
}

@immutable
class ReactionParams {
  const ReactionParams({required this.messageId, required this.emoji});
  final int messageId;
  final String emoji;
}

/// Params for a new outgoing message. Discriminated by concrete subclass:
/// either a channel message ([ChannelSendParams]) or a direct message
/// ([DirectSendParams]). Mirrors TS `SendMessageParams`.
sealed class SendMessageParams {
  const SendMessageParams({required this.content});
  final String content;
}

/// Post [content] into [channel]/[topic]. Topic is required on the wire
/// because Zulip rejects channel posts without one; callers that don't
/// have a topic in hand should default to `'general chat'`.
class ChannelSendParams extends SendMessageParams {
  const ChannelSendParams({
    required this.channel,
    required this.topic,
    required super.content,
  });
  final String channel;
  final String topic;
}

/// Send [content] as a DM to [recipients] (list of email addresses, to
/// match TS where recipients are addressed by email string).
class DirectSendParams extends SendMessageParams {
  const DirectSendParams({
    required this.recipients,
    required super.content,
  });
  final List<String> recipients;
}

sealed class ZulipEvent {
  const ZulipEvent();
}

class ConnectionEvent extends ZulipEvent {
  const ConnectionEvent(
    this.status, {
    this.attempt,
    this.delayMs,
    this.reason,
  });
  final ConnectionStatus status;
  // Populated when status is [ConnectionStatus.reconnecting]: the current
  // backoff attempt (1-indexed) and the delay in ms before the next retry.
  final int? attempt;
  final int? delayMs;
  final String? reason;
}

class MessageEvent extends ZulipEvent {
  const MessageEvent(this.message);
  final Message message;
}

class MessageUpdateEvent extends ZulipEvent {
  const MessageUpdateEvent({
    required this.messageId,
    this.content,
    this.topic,
    this.editedTimestamp,
  });
  final int messageId;
  final String? content;
  final String? topic;
  final DateTime? editedTimestamp;
}

class MessageDeleteEvent extends ZulipEvent {
  const MessageDeleteEvent(this.messageId);
  final int messageId;
}

class ReactionEvent extends ZulipEvent {
  const ReactionEvent({required this.messageId, required this.reactions});
  final int messageId;
  final List<Reaction> reactions;
}

class ErrorEvent extends ZulipEvent {
  const ErrorEvent({
    required this.code,
    required this.message,
    this.retryAfterMs,
  });
  final ErrorCode code;
  final String message;
  // Populated on rate-limit responses so UI can throttle retries.
  final int? retryAfterMs;
}

class TypingEvent extends ZulipEvent {
  const TypingEvent(this.users);
  final List<TypingUser> users;
}
