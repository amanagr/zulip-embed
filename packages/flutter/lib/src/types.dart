import 'package:flutter/foundation.dart';

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
  });

  final int id;
  final int senderId;
  final String senderName;
  final String? senderAvatarUrl;
  final String channel;
  final String topic;
  final String content;
  final DateTime timestamp;

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

class ErrorEvent extends ZulipEvent {
  const ErrorEvent(this.message);
  final String message;
}
