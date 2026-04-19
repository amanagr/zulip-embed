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

enum TypingOp { start, stop }

@immutable
class TypingUser {
  const TypingUser({required this.userId, required this.fullName});
  final int userId;
  final String fullName;
}

@immutable
class ScopeFilter {
  const ScopeFilter({required this.channel, this.topic});
  final String channel;
  final String? topic;
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

@immutable
class EditMessageParams {
  const EditMessageParams({required this.messageId, this.content, this.topic});
  final int messageId;
  final String? content;
  final String? topic;
}

@immutable
class ReactionParams {
  const ReactionParams({required this.messageId, required this.emoji});
  final int messageId;
  final String emoji;
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

class TypingEvent extends ZulipEvent {
  const TypingEvent(this.users);
  final List<TypingUser> users;
}
