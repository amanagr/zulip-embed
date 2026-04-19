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

  static Uri _normalize(Uri url) {
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
        'event_types': jsonEncode(['message']),
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
          if (evt['type'] == 'message') {
            final m = evt['message'] as Map<String, dynamic>;
            onEvent(MessageEvent(_parseMessage(m)));
          }
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
    final messages = (body['messages'] as List).cast<Map<String, dynamic>>();
    return messages.map(_parseMessage).toList(growable: false);
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
