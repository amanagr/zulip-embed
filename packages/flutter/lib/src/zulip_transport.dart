import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'transport.dart';
import 'types.dart';

/// Talks to a real Zulip server over the REST API.
///
/// Uses `/api/v1/register` to create an event queue, then long-polls
/// `/api/v1/events` and folds incoming `message` events into the
/// [ZulipEventListener]. Messages are sent via `/api/v1/messages`.
///
/// Credentials never leave the client; the constructor stores `email` +
/// `apiKey` and attaches them as HTTP Basic auth on every request.
class ZulipTransport implements Transport {
  ZulipTransport({
    required Uri serverUrl,
    required this.email,
    required this.apiKey,
    http.Client? httpClient,
  })  : serverUrl = _normalize(serverUrl),
        _http = httpClient ?? http.Client(),
        _ownsHttp = httpClient == null;

  final Uri serverUrl;
  final String email;
  final String apiKey;
  final http.Client _http;
  final bool _ownsHttp;

  int? _userId;
  String? _queueId;
  int _lastEventId = -1;
  bool _closed = false;

  // Per-message reaction state. Zulip's reaction events are per-user
  // add/remove ops; we fold them into bucketed lists so consumers get
  // the full reaction set on every event, matching the TS transport.
  final Map<int, Map<String, Set<int>>> _reactionState = {};

  static Uri _normalize(Uri url) {
    // Reject anything that isn't http/https — file://, chrome-extension://,
    // relative URIs, and so on should never reach the Zulip REST calls,
    // which otherwise would leak HTTP Basic credentials to arbitrary
    // destinations.
    final scheme = url.scheme.toLowerCase();
    if (scheme != 'https' && scheme != 'http') {
      throw ArgumentError.value(
        url,
        'serverUrl',
        'Zulip server URL must use http or https (got $scheme)',
      );
    }
    if (scheme == 'http' &&
        url.host != 'localhost' &&
        url.host != '127.0.0.1' &&
        !url.host.endsWith('.localhost')) {
      // Production credentials should never travel in the clear. We log
      // instead of throwing so local-development against a plain-http
      // Zulip still works.
      // ignore: avoid_print
      print(
        '[zulip_embed] server URL uses http://; API credentials will travel '
        'in the clear. Use https:// in production.',
      );
    }
    final raw = url.toString();
    final trimmed = raw.endsWith('/') ? raw.substring(0, raw.length - 1) : raw;
    return Uri.parse(trimmed);
  }

  @override
  int? get currentUserId => _userId;

  Map<String, String> get _authHeaders {
    final token = base64.encode(utf8.encode('$email:$apiKey'));
    return {'Authorization': 'Basic $token'};
  }

  @override
  Future<void> connect({
    required ScopeFilter scope,
    required ZulipEventListener onEvent,
  }) async {
    onEvent(const ConnectionEvent(ConnectionStatus.connecting));
    try {
      final me = await _getJson('/api/v1/users/me');
      _userId = (me['user_id'] as num).toInt();

      // Operator is 'stream' (not 'channel') for compatibility with Zulip
      // < 9, which doesn't know the 'channel' alias. Every supported
      // server accepts the legacy operator, so we hardcode it and avoid
      // version sniffing. Callers of this SDK only ever see 'channel'.
      final narrow = <List<String>>[
        ['stream', scope.channel],
        if (scope.topic != null) ['topic', scope.topic!],
      ];
      final register = await _postForm('/api/v1/register', {
        'event_types': jsonEncode([
          'message',
          'update_message',
          'delete_message',
          'reaction',
        ]),
        'narrow': jsonEncode(narrow),
        'apply_markdown': 'false',
        'client_gravatar': 'true',
      });
      _queueId = register['queue_id'] as String;
      _lastEventId = (register['last_event_id'] as num).toInt();
      onEvent(const ConnectionEvent(ConnectionStatus.connected));
      unawaited(_pollLoop(onEvent));
    } catch (e) {
      onEvent(ErrorEvent(e.toString()));
      onEvent(const ConnectionEvent(ConnectionStatus.error));
      rethrow;
    }
  }

  Future<void> _pollLoop(ZulipEventListener onEvent) async {
    while (!_closed && _queueId != null) {
      try {
        final uri = _endpoint('/api/v1/events', {
          'queue_id': _queueId!,
          'last_event_id': '$_lastEventId',
        });
        final resp = await _http.get(uri, headers: _authHeaders);
        if (_closed) return;
        if (resp.statusCode != 200) {
          onEvent(ErrorEvent('events HTTP ${resp.statusCode}'));
          await Future<void>.delayed(const Duration(seconds: 2));
          continue;
        }
        final body = jsonDecode(resp.body) as Map<String, dynamic>;
        final events = (body['events'] as List?) ?? const [];
        for (final raw in events) {
          final evt = raw as Map<String, dynamic>;
          _lastEventId = (evt['id'] as num).toInt();
          _dispatchEvent(evt, onEvent);
        }
      } catch (e) {
        if (_closed) return;
        onEvent(ErrorEvent(e.toString()));
        await Future<void>.delayed(const Duration(seconds: 2));
      }
    }
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _queueId = null;
    if (_ownsHttp) _http.close();
  }

  @override
  Future<List<Message>> getMessages({
    required ScopeFilter scope,
    int limit = 50,
  }) async {
    // See buildNarrow comment in connect(): wire operator is 'stream' for
    // Zulip < 9 compat.
    final narrow = <List<String>>[
      ['stream', scope.channel],
      if (scope.topic != null) ['topic', scope.topic!],
    ];
    final uri = _endpoint('/api/v1/messages', {
      'anchor': 'newest',
      'num_before': '$limit',
      'num_after': '0',
      'narrow': jsonEncode(narrow),
      'apply_markdown': 'false',
      'client_gravatar': 'true',
    });
    final resp = await _http.get(uri, headers: _authHeaders);
    if (resp.statusCode >= 400) {
      throw Exception('messages HTTP ${resp.statusCode}: ${resp.body}');
    }
    final body = jsonDecode(resp.body) as Map<String, dynamic>;
    final raw = (body['messages'] as List).cast<Map<String, dynamic>>();
    final parsed = <Message>[];
    for (final m in raw) {
      final message = _parseMessage(m);
      // Prime reaction state so reaction events dispatched afterwards
      // compose with the initial server-reported bucket contents.
      _rememberReactions(
        message.id,
        (m['reactions'] as List?) ?? const [],
      );
      parsed.add(message);
    }
    return List.unmodifiable(parsed);
  }

  @override
  Future<Message> sendMessage(SendMessageParams params) async {
    // Wire type is 'stream' for Zulip < 9 compatibility — /messages still
    // accepts the legacy value on every supported server.
    final body = await _postForm('/api/v1/messages', {
      'type': 'stream',
      'to': params.channel,
      'topic': params.topic ?? 'general chat',
      'content': params.content,
    });
    final id = (body['id'] as num).toInt();
    return Message(
      id: id,
      senderId: _userId ?? 0,
      senderName: 'You',
      channel: params.channel,
      topic: params.topic ?? 'general chat',
      content: params.content,
      timestamp: DateTime.now(),
    );
  }

  void _dispatchEvent(
    Map<String, dynamic> evt,
    ZulipEventListener onEvent,
  ) {
    switch (evt['type']) {
      case 'message':
        final m = evt['message'] as Map<String, dynamic>;
        final message = _parseMessage(m);
        _rememberReactions(message.id, (m['reactions'] as List?) ?? const []);
        onEvent(MessageEvent(message));
      case 'update_message':
        final id = (evt['message_id'] as num?)?.toInt();
        if (id == null) return;
        // Scope guard: only forward edits for messages we've seen through
        // this queue or a paginated fetch. Matches the TS transport so a
        // compromised server can't mutate UI state for messages the
        // caller never loaded.
        if (!_reactionState.containsKey(id)) return;
        final editedMs = (evt['edit_timestamp'] as num?)?.toInt();
        final rendered = evt['rendered_content'] as String?;
        onEvent(MessageUpdateEvent(
          messageId: id,
          // Absent when the edit only touched topic/channel. Stay null
          // in that case so consumers can distinguish content edits from
          // topic moves.
          content: rendered == null ? null : _stripHtml(rendered),
          topic: evt['subject'] as String?,
          editedTimestamp: editedMs == null
              ? null
              : DateTime.fromMillisecondsSinceEpoch(editedMs * 1000),
        ));
      case 'delete_message':
        final ids = <int>[];
        final single = (evt['message_id'] as num?)?.toInt();
        if (single != null) ids.add(single);
        for (final raw in (evt['message_ids'] as List? ?? const [])) {
          ids.add((raw as num).toInt());
        }
        for (final id in ids) {
          if (!_reactionState.containsKey(id)) continue;
          _reactionState.remove(id);
          onEvent(MessageDeleteEvent(id));
        }
      case 'reaction':
        final id = (evt['message_id'] as num?)?.toInt();
        if (id == null || !_reactionState.containsKey(id)) return;
        final reactions = _applyReactionOp(
          messageId: id,
          op: evt['op'] as String? ?? '',
          emoji: evt['emoji_name'] as String? ?? '',
          userId: (evt['user_id'] as num?)?.toInt() ?? 0,
        );
        onEvent(ReactionEvent(messageId: id, reactions: reactions));
    }
  }

  void _rememberReactions(int messageId, List<dynamic> apiReactions) {
    final buckets = <String, Set<int>>{};
    for (final raw in apiReactions) {
      final r = raw as Map<String, dynamic>;
      final emoji = r['emoji_name'] as String? ?? '';
      final userId = (r['user_id'] as num?)?.toInt();
      if (emoji.isEmpty || userId == null) continue;
      buckets.putIfAbsent(emoji, () => <int>{}).add(userId);
    }
    _reactionState[messageId] = buckets;
  }

  List<Reaction> _applyReactionOp({
    required int messageId,
    required String op,
    required String emoji,
    required int userId,
  }) {
    final buckets = _reactionState.putIfAbsent(messageId, () => {});
    final users = buckets.putIfAbsent(emoji, () => <int>{});
    if (op == 'add') {
      users.add(userId);
    } else if (op == 'remove') {
      users.remove(userId);
      if (users.isEmpty) buckets.remove(emoji);
    }
    return [
      for (final entry in buckets.entries)
        Reaction(emoji: entry.key, userIds: entry.value.toList()),
    ];
  }

  Message _parseMessage(Map<String, dynamic> m) {
    return Message(
      id: (m['id'] as num).toInt(),
      senderId: (m['sender_id'] as num).toInt(),
      senderName: (m['sender_full_name'] as String?) ?? 'Unknown',
      senderAvatarUrl: m['avatar_url'] as String?,
      channel: (m['display_recipient'] as String?) ?? '',
      topic: (m['subject'] as String?) ?? '',
      content: _stripHtml((m['content'] as String?) ?? ''),
      timestamp: DateTime.fromMillisecondsSinceEpoch(
        (m['timestamp'] as num).toInt() * 1000,
      ),
    );
  }

  static final _tagPattern = RegExp(r'<[^>]+>');
  String _stripHtml(String html) => html.replaceAll(_tagPattern, '').trim();

  Uri _endpoint(String path, [Map<String, String>? query]) {
    final base = serverUrl.toString();
    return Uri.parse('$base$path').replace(queryParameters: query);
  }

  Future<Map<String, dynamic>> _getJson(String path) async {
    final resp = await _http.get(_endpoint(path), headers: _authHeaders);
    if (resp.statusCode >= 400) {
      throw Exception('GET $path HTTP ${resp.statusCode}');
    }
    return jsonDecode(resp.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _postForm(
    String path,
    Map<String, String> fields,
  ) async {
    final resp = await _http.post(
      _endpoint(path),
      headers: _authHeaders,
      body: fields,
    );
    if (resp.statusCode >= 400) {
      throw Exception('POST $path HTTP ${resp.statusCode}: ${resp.body}');
    }
    return jsonDecode(resp.body) as Map<String, dynamic>;
  }
}
