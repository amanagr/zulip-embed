import 'dart:async';
import 'dart:convert';
import 'dart:io' show SocketException;

import 'package:http/http.dart' as http;

import 'transport.dart';
import 'types.dart';

/// Read-only transport that serves a pre-fetched JSON snapshot.
///
/// Mirror of the TypeScript `SnapshotTransport`: the CI-baked snapshot
/// file (produced by `scripts/fetch-announce-snapshot.mjs`) contains a
/// frozen window of messages that the SDK can display without any
/// credentials in the client. Useful for public read-only embeds where
/// shipping an API key to every visitor would be a security risk.
///
/// Snapshots are a fixed window — there is no pagination and no write
/// path. `sendMessage`, `addReaction`, and `removeReaction` all reject.
class SnapshotTransport extends Transport {
  SnapshotTransport({
    required String url,
    Map<String, dynamic>? inlineData,
    http.Client? httpClient,
  })  : _url = inlineData == null ? _validateUrl(url) : url,
        _inline = inlineData,
        _http = httpClient ?? http.Client(),
        _ownsHttp = httpClient == null;

  final String _url;
  final Map<String, dynamic>? _inline;
  final http.Client _http;
  final bool _ownsHttp;

  List<Message> _messages = const [];
  // Full parse of the snapshot, kept for lookups that ignore the active
  // scope filter (e.g. [fetchMessage], used by ZulipAnnouncement).
  List<Message> _allMessages = const [];

  @override
  int? get currentUserId => null;

  @override
  Future<User> getCurrentUser() {
    // Snapshots are anonymous reads — there is no logged-in viewer.
    // Mirrors the TS rejection text so cross-SDK diagnostics match.
    return Future.error(
      StateError('Snapshot transport has no logged-in viewer'),
    );
  }

  @override
  Future<void> connect({
    required ScopeFilter scope,
    required ZulipEventListener onEvent,
  }) async {
    try {
      final file = _inline ?? await _fetchSnapshot();
      _allMessages = List.unmodifiable(_parseMessages(file));
      _messages = _allMessages
          .where((m) => _inScope(m, scope))
          .toList(growable: false);
      onEvent(const ConnectionEvent(ConnectionStatus.connected));
    } catch (e) {
      onEvent(ErrorEvent(code: _classifyError(e), message: e.toString()));
      onEvent(const ConnectionEvent(ConnectionStatus.error));
      rethrow;
    }
  }

  @override
  Future<void> close() async {
    if (_ownsHttp) _http.close();
  }

  @override
  Future<List<Message>> getMessages({
    required ScopeFilter scope,
    int limit = 50,
  }) async {
    // Fixed window — no backlog; return everything up to `limit` from the
    // tail so consumers see the most recent messages first.
    final count = limit >= _messages.length ? _messages.length : limit;
    return List.unmodifiable(
      _messages.sublist(_messages.length - count),
    );
  }

  @override
  Future<Message> sendMessage(SendMessageParams params) {
    return Future.error(StateError('Snapshot transport is read-only'));
  }

  @override
  Future<void> editMessage(EditMessageParams params) {
    return Future.error(StateError('Snapshot transport is read-only'));
  }

  @override
  Future<void> deleteMessage(int messageId) {
    return Future.error(StateError('Snapshot transport is read-only'));
  }

  @override
  Future<void> addReaction(ReactionParams params) {
    return Future.error(StateError('Snapshot transport is read-only'));
  }

  @override
  Future<void> removeReaction(ReactionParams params) {
    return Future.error(StateError('Snapshot transport is read-only'));
  }

  @override
  Future<List<DirectMessageConversation>>
      listDirectMessageConversations() async {
    // Scan the full parse (not just the scope-filtered slice) so a
    // consumer that opens a snapshot against a channel scope can still
    // list the DM threads inside it.
    final buckets = <String, _SnapDmBucket>{};
    for (final m in _allMessages) {
      if (m is! DirectMessage) continue;
      final users = <int, User>{
        m.senderId: User(
          id: m.senderId,
          fullName: m.senderName,
          email: '',
        ),
      };
      for (final r in m.recipients) {
        users[r.id] = r;
      }
      final ids = users.keys.toList()..sort();
      final key = ids.join(',');
      final bucket = buckets.putIfAbsent(
        key,
        () => _SnapDmBucket(
          userIds: ids,
          users: users.values.toList(),
          lastMessageId: m.id,
        ),
      );
      if (m.id > bucket.lastMessageId) bucket.lastMessageId = m.id;
    }
    final conversations = [
      for (final b in buckets.values)
        DirectMessageConversation(
          userIds: b.userIds,
          users: b.users,
          lastMessageId: b.lastMessageId,
        ),
    ];
    conversations.sort(
      (a, b) => (b.lastMessageId ?? 0).compareTo(a.lastMessageId ?? 0),
    );
    return List.unmodifiable(conversations);
  }

  @override
  Future<Message?> fetchMessage(int messageId) async {
    for (final m in _allMessages) {
      if (m.id == messageId) return m;
    }
    return null;
  }

  Future<Map<String, dynamic>> _fetchSnapshot() async {
    final resp = await _http.get(Uri.parse(_url));
    if (resp.statusCode >= 400) {
      throw Exception(
        'Failed to load snapshot from $_url: HTTP ${resp.statusCode}',
      );
    }
    final decoded = jsonDecode(resp.body);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Snapshot root must be a JSON object');
    }
    return decoded;
  }

  static String _validateUrl(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) {
      throw ArgumentError.value(raw, 'url', 'snapshot url is empty');
    }
    // Protocol-relative URLs (//host/path) inherit the page scheme and
    // silently point off-origin. Reject the same way TS does.
    if (trimmed.startsWith('//')) {
      throw ArgumentError.value(
        raw,
        'url',
        'snapshot url may not be protocol-relative',
      );
    }
    // Relative paths stay as-is — the http client will resolve them
    // against the base URL the caller configured (if any).
    final schemeMatch = RegExp(r'^[a-zA-Z][a-zA-Z0-9+.-]*:').firstMatch(trimmed);
    if (schemeMatch == null) return trimmed;
    final parsed = Uri.tryParse(trimmed);
    if (parsed == null) {
      throw ArgumentError.value(raw, 'url', 'invalid snapshot url');
    }
    final scheme = parsed.scheme.toLowerCase();
    if (scheme != 'http' && scheme != 'https') {
      throw ArgumentError.value(
        raw,
        'url',
        'snapshot url must use http or https (got $scheme)',
      );
    }
    return parsed.toString();
  }
}

/// Accumulator for DM conversation bucketing. Mirror of the per-transport
/// `_DmBucket` helpers elsewhere; kept private so the snapshot module
/// stays self-contained.
class _SnapDmBucket {
  _SnapDmBucket({
    required this.userIds,
    required this.users,
    required this.lastMessageId,
  });
  final List<int> userIds;
  final List<User> users;
  int lastMessageId;
}

ErrorCode _classifyError(Object e) {
  if (e is SocketException) return ErrorCode.network;
  if (e is http.ClientException) return ErrorCode.network;
  return ErrorCode.unknown;
}

bool _inScope(Message message, ScopeFilter scope) {
  return switch (scope) {
    ChannelScope(:final channel, :final topic) =>
      message is ChannelMessage &&
          message.channelName == channel &&
          (topic == null || message.topic == topic),
    DmScope(:final userIds) => message is DirectMessage &&
        _dmParticipantsMatch(message, userIds),
  };
}

bool _dmParticipantsMatch(DirectMessage m, List<int> userIds) {
  final expected = {...userIds};
  final actual = <int>{m.senderId};
  for (final r in m.recipients) {
    actual.add(r.id);
  }
  if (actual.length != expected.length) return false;
  for (final id in expected) {
    if (!actual.contains(id)) return false;
  }
  return true;
}

// Validate every field that flows into the UI so a malformed snapshot
// can't smuggle a non-string content into the renderer. Matches the zod
// check the TS SnapshotTransport does.
List<Message> _parseMessages(Map<String, dynamic> root) {
  final version = root['version'];
  if (version != 1) {
    throw FormatException('Unsupported snapshot version: $version');
  }
  final raw = root['messages'];
  if (raw is! List) {
    throw const FormatException('Snapshot `messages` must be a list');
  }
  final out = <Message>[];
  for (final entry in raw) {
    if (entry is! Map<String, dynamic>) {
      throw const FormatException('Each snapshot message must be an object');
    }
    out.add(_parseMessage(entry));
  }
  return out;
}

Message _parseMessage(Map<String, dynamic> m) {
  final reactions = <Reaction>[];
  final rawReactions = m['reactions'];
  if (rawReactions is List) {
    for (final r in rawReactions) {
      if (r is! Map<String, dynamic>) continue;
      final emoji = r['emoji'] as String?;
      final userIds = r['userIds'];
      if (emoji == null || userIds is! List) continue;
      reactions.add(
        Reaction(
          emoji: emoji,
          userIds: userIds
              .whereType<num>()
              .map((n) => n.toInt())
              .toList(growable: false),
        ),
      );
    }
  }
  final id = (m['id'] as num).toInt();
  final senderId = (m['senderId'] as num).toInt();
  final senderName = m['senderFullName'] as String? ?? 'Unknown';
  final senderAvatarUrl = m['avatarUrl'] as String?;
  final content = m['content'] as String? ?? '';
  final contentIsHtml = m['contentIsHtml'] as bool? ?? false;
  final timestamp = DateTime.fromMillisecondsSinceEpoch(
    (m['timestamp'] as num).toInt(),
  );

  // Discriminated on `type`. Default to "channel" when absent so older
  // snapshot files written before v0.2 still parse.
  final type = m['type'] as String? ?? 'channel';
  if (type == 'direct') {
    final rawRecipients = m['recipients'];
    final recipients = <User>[];
    if (rawRecipients is List) {
      for (final r in rawRecipients) {
        if (r is! Map<String, dynamic>) continue;
        final uid = (r['userId'] as num?)?.toInt();
        if (uid == null) continue;
        recipients.add(
          User(
            id: uid,
            fullName: r['fullName'] as String? ?? '',
            email: r['email'] as String? ?? '',
            avatarUrl: r['avatarUrl'] as String?,
          ),
        );
      }
    }
    return DirectMessage(
      id: id,
      senderId: senderId,
      senderName: senderName,
      senderAvatarUrl: senderAvatarUrl,
      recipients: recipients,
      content: content,
      contentIsHtml: contentIsHtml,
      timestamp: timestamp,
      reactions: reactions,
    );
  }
  return ChannelMessage(
    id: id,
    senderId: senderId,
    senderName: senderName,
    senderAvatarUrl: senderAvatarUrl,
    channelName: m['channelName'] as String? ?? '',
    topic: m['topic'] as String? ?? '',
    content: content,
    contentIsHtml: contentIsHtml,
    timestamp: timestamp,
    reactions: reactions,
  );
}
