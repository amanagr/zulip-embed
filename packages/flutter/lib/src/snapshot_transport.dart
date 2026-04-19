import 'dart:async';
import 'dart:convert';

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
class SnapshotTransport implements Transport {
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

  @override
  int? get currentUserId => null;

  @override
  Future<void> connect({
    required ScopeFilter scope,
    required ZulipEventListener onEvent,
  }) async {
    try {
      final file = _inline ?? await _fetchSnapshot();
      _messages = _parseMessages(file)
          .where((m) => _inScope(m, scope))
          .toList(growable: false);
      onEvent(const ConnectionEvent(ConnectionStatus.connected));
    } catch (e) {
      onEvent(ErrorEvent(e.toString()));
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

  Future<Map<String, dynamic>> _fetchSnapshot() async {
    final resp = await _http.get(Uri.parse(_url));
    if (resp.statusCode >= 400) {
      throw Exception(
        'Failed to load snapshot from $_url: HTTP ${resp.statusCode}',
      );
    }
    final decoded = jsonDecode(resp.body);
    if (decoded is! Map<String, dynamic>) {
      throw FormatException('Snapshot root must be a JSON object');
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

bool _inScope(Message message, ScopeFilter scope) {
  if (message.channel != scope.channel) return false;
  if (scope.topic != null && message.topic != scope.topic) return false;
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
  return Message(
    id: (m['id'] as num).toInt(),
    senderId: (m['senderId'] as num).toInt(),
    senderName: m['senderFullName'] as String? ?? 'Unknown',
    senderAvatarUrl: m['avatarUrl'] as String?,
    channel: m['channelName'] as String? ?? '',
    topic: m['topic'] as String? ?? '',
    content: m['content'] as String? ?? '',
    contentIsHtml: m['contentIsHtml'] as bool? ?? false,
    timestamp: DateTime.fromMillisecondsSinceEpoch(
      (m['timestamp'] as num).toInt(),
    ),
    reactions: reactions,
  );
}
