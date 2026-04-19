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
class Message {
  const Message({
    required this.id,
    required this.senderId,
    required this.senderName,
    required this.channel,
    required this.topic,
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
  final String channel;
  final String topic;
  final String content;
  final DateTime timestamp;
  final List<Reaction> reactions;
  final bool contentIsHtml;

  Message copyWith({
    String? content,
    bool? contentIsHtml,
    String? topic,
    List<Reaction>? reactions,
  }) {
    return Message(
      id: id,
      senderId: senderId,
      senderName: senderName,
      senderAvatarUrl: senderAvatarUrl,
      channel: channel,
      topic: topic ?? this.topic,
      content: content ?? this.content,
      contentIsHtml: contentIsHtml ?? this.contentIsHtml,
      timestamp: timestamp,
      reactions: reactions ?? this.reactions,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) || (other is Message && other.id == id);

  @override
  int get hashCode => id.hashCode;
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

enum ConnectionStatus { disconnected, connecting, connected, error }

@immutable
class ScopeFilter {
  const ScopeFilter({required this.channel, this.topic});
  final String channel;
  final String? topic;
}

@immutable
class SendMessageParams {
  const SendMessageParams({
    required this.channel,
    required this.content,
    this.topic,
  });
  final String channel;
  final String? topic;
  final String content;
}

sealed class ZulipEvent {
  const ZulipEvent();
}

class ConnectionEvent extends ZulipEvent {
  const ConnectionEvent(this.status);
  final ConnectionStatus status;
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
  const ErrorEvent(this.message);
  final String message;
}
