import 'dart:async';
import 'dart:convert';
import 'dart:io' show SocketException;

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
        _ownsHttp = httpClient == null {
    // Deferred so callers of whenReady / getCurrentUser can await the
    // full user record even when they beat the /users/me round-trip.
    // Settled by _loadCurrentUser() on success or by connect()/close()
    // on failure.
    _currentUserCompleter = Completer<User>();
  }

  final Uri serverUrl;
  final String email;
  final String apiKey;
  final http.Client _http;
  final bool _ownsHttp;

  int? _userId;
  late Completer<User> _currentUserCompleter;
  String? _queueId;
  int _lastEventId = -1;
  bool _closed = false;
  ZulipEventListener? _onEvent;

  // Per-message reaction state. Zulip's reaction events are per-user
  // add/remove ops; we fold them into bucketed lists so consumers get
  // the full reaction set on every event, matching the TS transport.
  final Map<int, Map<String, Set<int>>> _reactionState = {};

  // Typing participants for the current scope, keyed by user id. Zulip
  // emits op=start/stop per user; we maintain the aggregate so UI
  // consumers get the whole list on every change.
  final Map<int, TypingUser> _typingUsers = {};

  // Cached stream_id per channel name. The /typing endpoint requires
  // an id, not a name, and /get_stream_id is cheap but pointless to
  // hit on every keystroke.
  final Map<String, int> _streamIdCache = {};

  // Captured scope from the most recent connect() so typing events can
  // filter to messages the viewer can see.
  ScopeFilter? _scope;

  /// Build Zulip narrow operators from a [ScopeFilter]. Operators are
  /// 'stream' / 'pm-with' (not 'channel' / 'dm') for compatibility with
  /// Zulip < 9, which doesn't know the newer aliases. Every supported
  /// server accepts the legacy operators, so we hardcode them and avoid
  /// version sniffing. Callers of this SDK only ever see 'channel' /
  /// 'direct'. See CLAUDE.md.
  static List<List<String>> _buildNarrow(ScopeFilter scope) {
    return switch (scope) {
      ChannelScope(:final channel, :final topic) => [
          ['stream', channel],
          if (topic != null) ['topic', topic],
        ],
      DmScope(:final userIds) => [
          ['pm-with', ([...userIds]..sort()).join(',')],
        ],
    };
  }

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

  @override
  Future<User> getCurrentUser() => _currentUserCompleter.future;

  Map<String, String> get _authHeaders {
    final token = base64.encode(utf8.encode('$email:$apiKey'));
    return {'Authorization': 'Basic $token'};
  }

  @override
  Future<void> connect({
    required ScopeFilter scope,
    required ZulipEventListener onEvent,
  }) async {
    _onEvent = onEvent;
    onEvent(const ConnectionEvent(ConnectionStatus.connecting));
    try {
      await _loadCurrentUser();

      // Operator is 'stream' / 'pm-with' (not 'channel' / 'dm') for
      // compatibility with Zulip < 9, which doesn't know the newer
      // aliases. Every supported server accepts the legacy operators, so
      // we hardcode them and avoid version sniffing. Callers of this
      // SDK only ever see 'channel' / 'direct'.
      final narrow = _buildNarrow(scope);
      final register = await _postForm('/api/v1/register', {
        'event_types': jsonEncode([
          'message',
          'update_message',
          'delete_message',
          'reaction',
          'typing',
        ]),
        'narrow': jsonEncode(narrow),
        'apply_markdown': 'false',
        'client_gravatar': 'true',
      });
      _scope = scope;
      _queueId = register['queue_id'] as String;
      _lastEventId = (register['last_event_id'] as num).toInt();
      onEvent(const ConnectionEvent(ConnectionStatus.connected));
      unawaited(_pollLoop(onEvent));
    } catch (e) {
      final code = _classifyError(e);
      onEvent(ErrorEvent(code: code, message: e.toString()));
      onEvent(const ConnectionEvent(ConnectionStatus.error));
      if (!_currentUserCompleter.isCompleted) {
        _currentUserCompleter.completeError(e);
      }
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
          onEvent(
            ErrorEvent(
              code: _classifyStatus(resp.statusCode),
              message: 'events HTTP ${resp.statusCode}',
              retryAfterMs: _retryAfterMs(resp),
            ),
          );
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
        onEvent(ErrorEvent(code: _classifyError(e), message: e.toString()));
        await Future<void>.delayed(const Duration(seconds: 2));
      }
    }
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _queueId = null;
    _onEvent = null;
    if (!_currentUserCompleter.isCompleted) {
      _currentUserCompleter.completeError(
        StateError('Transport closed before /users/me completed'),
      );
    }
    if (_ownsHttp) _http.close();
  }

  @override
  Future<List<Message>> getMessages({
    required ScopeFilter scope,
    int limit = 50,
  }) async {
    // See _buildNarrow comment in connect(): wire operators are legacy
    // 'stream' / 'pm-with' for Zulip < 9 compat.
    final narrow = _buildNarrow(scope);
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
    return switch (params) {
      ChannelSendParams(
        :final channel,
        :final topic,
        :final content,
      ) =>
        _sendChannel(channel: channel, topic: topic, content: content),
      DirectSendParams(:final recipients, :final content) =>
        _sendDirect(recipients: recipients, content: content),
    };
  }

  Future<Message> _sendChannel({
    required String channel,
    required String topic,
    required String content,
  }) async {
    // Wire type is 'stream' for Zulip < 9 compatibility — /messages still
    // accepts the legacy value on every supported server.
    final body = await _postForm('/api/v1/messages', {
      'type': 'stream',
      'to': channel,
      'topic': topic,
      'content': content,
    });
    final id = (body['id'] as num).toInt();
    return ChannelMessage(
      id: id,
      senderId: _userId ?? 0,
      senderName: 'You',
      channelName: channel,
      topic: topic,
      content: content,
      timestamp: DateTime.now(),
    );
  }

  Future<Message> _sendDirect({
    required List<String> recipients,
    required String content,
  }) async {
    final body = await _postForm('/api/v1/messages', {
      'type': 'direct',
      'to': jsonEncode(recipients),
      'content': content,
    });
    final id = (body['id'] as num).toInt();
    return DirectMessage(
      id: id,
      senderId: _userId ?? 0,
      senderName: 'You',
      recipients: [
        for (final email in recipients)
          User(id: 0, fullName: email, email: email),
      ],
      content: content,
      timestamp: DateTime.now(),
    );
  }

  @override
  Future<void> addReaction(ReactionParams params) async {
    await _postForm(
      '/api/v1/messages/${params.messageId}/reactions',
      {'emoji_name': params.emoji},
    );
  }

  @override
  Future<void> removeReaction(ReactionParams params) async {
    final resp = await _http.delete(
      _endpoint(
        '/api/v1/messages/${params.messageId}/reactions',
        {'emoji_name': params.emoji},
      ),
      headers: _authHeaders,
    );
    if (resp.statusCode >= 400) {
      throw Exception(
        'DELETE /api/v1/messages/${params.messageId}/reactions '
        'HTTP ${resp.statusCode}: ${resp.body}',
      );
    }
  }

  @override
  Future<void> editMessage(EditMessageParams params) async {
    final body = <String, String>{};
    String? newContent;
    String? newTopic;
    switch (params) {
      case EditContentParams(:final content):
        body['content'] = content;
        newContent = content;
      case EditTopicParams(:final topic):
        body['topic'] = topic;
        newTopic = topic;
      case EditContentAndTopicParams(:final content, :final topic):
        body['content'] = content;
        body['topic'] = topic;
        newContent = content;
        newTopic = topic;
    }
    final resp = await _http.patch(
      _endpoint('/api/v1/messages/${params.messageId}'),
      headers: _authHeaders,
      body: body,
    );
    if (resp.statusCode >= 400) {
      throw Exception(
        'PATCH /api/v1/messages/${params.messageId} HTTP ${resp.statusCode}: '
        '${resp.body}',
      );
    }
    // Optimistic local update — server will broadcast the same event via
    // /events, but firing one now keeps the UI responsive. Handler in
    // ZulipChat is idempotent so double-delivery is harmless.
    if (!_reactionState.containsKey(params.messageId)) return;
    _onEvent?.call(
      MessageUpdateEvent(
        messageId: params.messageId,
        content: newContent,
        topic: newTopic,
      ),
    );
  }

  @override
  Future<void> deleteMessage(int messageId) async {
    final resp = await _http.delete(
      _endpoint('/api/v1/messages/$messageId'),
      headers: _authHeaders,
    );
    if (resp.statusCode >= 400) {
      throw Exception(
        'DELETE /api/v1/messages/$messageId HTTP ${resp.statusCode}: '
        '${resp.body}',
      );
    }
    if (!_reactionState.containsKey(messageId)) return;
    _reactionState.remove(messageId);
    _onEvent?.call(MessageDeleteEvent(messageId));
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
        onEvent(
          MessageUpdateEvent(
            messageId: id,
            // Absent when the edit only touched topic/channel. Stay null
            // in that case so consumers can distinguish content edits from
            // topic moves.
            content: rendered == null ? null : _stripHtml(rendered),
            topic: evt['subject'] as String?,
            editedTimestamp: editedMs == null
                ? null
                : DateTime.fromMillisecondsSinceEpoch(editedMs * 1000),
          ),
        );
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
      case 'typing':
        _dispatchTyping(evt, onEvent);
    }
  }

  void _dispatchTyping(
    Map<String, dynamic> evt,
    ZulipEventListener onEvent,
  ) {
    // Typing events are Zulip direct-message pings on older servers and
    // stream pings on modern ones. We only care about the sender and
    // the start/stop op — the channel/topic are implicit in the scope
    // we registered. Drop events that don't match our current scope so
    // out-of-band pings for other narrows never fire the indicator.
    final scope = _scope;
    if (scope == null) return;
    // Channel-scope filtering: drop typing events that don't match the
    // channel / topic the viewer narrowed to. DM typing events are only
    // surfaced when the active scope is a DM with the same participant
    // set.
    switch (scope) {
      case ChannelScope(:final channel, :final topic):
        final messageType = evt['message_type'] as String?;
        if (messageType != null &&
            messageType != 'stream' &&
            messageType != 'channel') {
          return;
        }
        final streamId = (evt['stream_id'] as num?)?.toInt();
        if (streamId != null) {
          final cached = _streamIdCache[channel];
          if (cached != null && cached != streamId) return;
        }
        final topicStr = evt['topic'] as String?;
        if (topic != null && topicStr != null && topicStr != topic) return;
      case DmScope(:final userIds):
        final messageType = evt['message_type'] as String?;
        if (messageType != null &&
            messageType != 'private' &&
            messageType != 'direct') {
          return;
        }
        // Recipient ids live under `message_to_user_ids` (or the legacy
        // `recipients`). Normalize and compare against our canonical
        // participant set.
        final rawIds = (evt['message_to_user_ids'] as List?) ?? const [];
        final eventIds = {
          for (final raw in rawIds) (raw as num).toInt(),
        }..add((evt['sender']?['user_id'] as num?)?.toInt() ?? -1);
        final expected = {for (final id in userIds) id};
        if (eventIds.length != expected.length) return;
        for (final id in expected) {
          if (!eventIds.contains(id)) return;
        }
    }

    final sender = evt['sender'];
    if (sender is! Map<String, dynamic>) return;
    final userId = (sender['user_id'] as num?)?.toInt();
    if (userId == null || userId == _userId) return;
    final fullName = sender['full_name'] as String? ?? 'Someone';

    final op = evt['op'] as String?;
    if (op == 'start') {
      _typingUsers[userId] = TypingUser(userId: userId, fullName: fullName);
    } else if (op == 'stop') {
      _typingUsers.remove(userId);
    } else {
      return;
    }
    onEvent(TypingEvent(List.unmodifiable(_typingUsers.values)));
  }

  @override
  Future<void> sendTyping({
    required TypingOp op,
    required ScopeFilter scope,
  }) async {
    // Best-effort ping — typing is a nicety, never a blocking call.
    // Swallow every failure, including the /get_stream_id lookup,
    // rather than surfacing transient network hiccups as errors on the
    // composer.
    try {
      switch (scope) {
        case ChannelScope(:final channel, :final topic):
          final streamId = await _resolveStreamId(channel);
          if (streamId == null) return;
          final body = <String, String>{
            'op': op == TypingOp.start ? 'start' : 'stop',
            // Wire value 'stream' for Zulip < 9 compat — see _buildNarrow.
            'type': 'stream',
            'stream_id': '$streamId',
          };
          if (topic != null) body['topic'] = topic;
          await _postForm('/api/v1/typing', body);
        case DmScope(:final userIds):
          final canonical = [...userIds]..sort();
          final body = <String, String>{
            'op': op == TypingOp.start ? 'start' : 'stop',
            'type': 'direct',
            'to': jsonEncode(canonical),
          };
          await _postForm('/api/v1/typing', body);
      }
    } catch (_) {
      // Best-effort: swallow.
    }
  }

  @override
  Future<List<Channel>> listChannels() async {
    final body = await _getJson('/api/v1/users/me/subscriptions');
    final subs = (body['subscriptions'] as List?) ?? const [];
    final channels = <Channel>[];
    for (final raw in subs) {
      final s = raw as Map<String, dynamic>;
      final id = (s['stream_id'] as num?)?.toInt();
      final name = s['name'] as String?;
      if (id == null || name == null) continue;
      channels.add(
        Channel(
          channelId: id,
          name: name,
          description: s['description'] as String? ?? '',
          color: s['color'] as String?,
          pinToTop: (s['pin_to_top'] as bool?) ?? false,
          isMuted: (s['is_muted'] as bool?) ?? false,
        ),
      );
    }
    // Pinned first, then alphabetical — same ordering Zulip's own web
    // app applies so the component output matches user expectations.
    channels.sort((a, b) {
      if (a.pinToTop != b.pinToTop) return a.pinToTop ? -1 : 1;
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    return List.unmodifiable(channels);
  }

  @override
  Future<List<Topic>> listTopics(String channel) async {
    final streamId = await _resolveStreamId(channel);
    if (streamId == null) return const [];
    final body = await _getJson('/api/v1/users/me/$streamId/topics');
    final rows = (body['topics'] as List?) ?? const [];
    const resolvedPrefix = '\u2714 ';
    final topics = <Topic>[];
    for (final raw in rows) {
      final t = raw as Map<String, dynamic>;
      final name = t['name'] as String?;
      final maxId = (t['max_id'] as num?)?.toInt();
      if (name == null || maxId == null) continue;
      final isResolved = name.startsWith(resolvedPrefix);
      topics.add(
        Topic(
          name: isResolved ? name.substring(resolvedPrefix.length) : name,
          maxMessageId: maxId,
          isResolved: isResolved,
        ),
      );
    }
    return List.unmodifiable(topics);
  }

  @override
  Future<List<DirectMessageConversation>>
      listDirectMessageConversations() async {
    // Zulip doesn't expose a dedicated "list DM threads" endpoint; we
    // mine the viewer's recent private messages and bucket by the set of
    // participants. 200 is a reasonable upper bound for the last batch —
    // enough to surface active conversations without paginating.
    try {
      final narrow = [
        ['is', 'private'],
      ];
      final uri = _endpoint('/api/v1/messages', {
        'anchor': 'newest',
        'num_before': '200',
        'num_after': '0',
        'narrow': jsonEncode(narrow),
        'apply_markdown': 'false',
        'client_gravatar': 'true',
      });
      final resp = await _http.get(uri, headers: _authHeaders);
      if (resp.statusCode >= 400) return const [];
      final body = jsonDecode(resp.body) as Map<String, dynamic>;
      final raw = (body['messages'] as List).cast<Map<String, dynamic>>();

      // Key: comma-joined sorted participant id list. Value: bucket
      // accumulating the most recent message seen + participant records.
      final buckets = <String, _DmBucket>{};
      for (final m in raw) {
        final wireType = m['type'] as String?;
        if (wireType != 'private' && wireType != 'direct') continue;
        final messageId = (m['id'] as num).toInt();
        final senderId = (m['sender_id'] as num?)?.toInt() ?? 0;
        final senderName = (m['sender_full_name'] as String?) ?? '';
        final senderEmail = (m['sender_email'] as String?) ?? '';

        final users = <int, User>{};
        // Seed the bucket with the sender — Zulip's display_recipient
        // includes all participants (including the sender), but being
        // defensive avoids an empty bucket if the server ever omits one.
        if (senderId != 0) {
          users[senderId] = User(
            id: senderId,
            fullName: senderName,
            email: senderEmail,
          );
        }
        final displayRecipient = m['display_recipient'];
        if (displayRecipient is List) {
          for (final r in displayRecipient) {
            if (r is! Map<String, dynamic>) continue;
            final uid = (r['id'] as num?)?.toInt();
            if (uid == null) continue;
            users[uid] = User(
              id: uid,
              fullName: (r['full_name'] as String?) ?? '',
              email: (r['email'] as String?) ?? '',
            );
          }
        }
        if (users.isEmpty) continue;
        final ids = users.keys.toList()..sort();
        final key = ids.join(',');
        final bucket = buckets.putIfAbsent(
          key,
          () => _DmBucket(
            userIds: ids,
            users: users.values.toList(),
            lastMessageId: messageId,
          ),
        );
        if (messageId > bucket.lastMessageId) {
          bucket.lastMessageId = messageId;
        }
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
        (a, b) =>
            (b.lastMessageId ?? 0).compareTo(a.lastMessageId ?? 0),
      );
      return List.unmodifiable(conversations);
    } catch (_) {
      return const [];
    }
  }

  @override
  Future<Message?> fetchMessage(int messageId) async {
    // Zulip's single-message endpoint returns the HTML-rendered body so
    // the announcement banner can surface rich content. Failures (401 /
    // 403 / 404) degrade to null — the caller renders "not visible".
    try {
      final uri = _endpoint('/api/v1/messages/$messageId', {
        'apply_markdown': 'true',
      });
      final resp = await _http.get(uri, headers: _authHeaders);
      if (resp.statusCode >= 400) return null;
      final body = jsonDecode(resp.body) as Map<String, dynamic>;
      final raw = body['message'];
      if (raw is! Map<String, dynamic>) return null;
      // _parseMessage runs `_stripHtml` on `content`, which we don't
      // want here — the announcement widget renders HTML itself. Call
      // _parseMessage for the metadata, then overwrite content with the
      // original HTML and flip `contentIsHtml`.
      final msg = _parseMessage(raw);
      final htmlContent = (raw['content'] as String?) ?? '';
      return msg.copyWith(content: htmlContent, contentIsHtml: true);
    } catch (_) {
      return null;
    }
  }

  Future<int?> _resolveStreamId(String channel) async {
    final cached = _streamIdCache[channel];
    if (cached != null) return cached;
    try {
      final uri = _endpoint('/api/v1/get_stream_id', {'stream': channel});
      final resp = await _http.get(uri, headers: _authHeaders);
      if (resp.statusCode >= 400) return null;
      final body = jsonDecode(resp.body) as Map<String, dynamic>;
      final id = (body['stream_id'] as num?)?.toInt();
      if (id != null) _streamIdCache[channel] = id;
      return id;
    } catch (_) {
      return null;
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

  Future<void> _loadCurrentUser() async {
    final me = await _getJson('/api/v1/users/me');
    final id = (me['user_id'] as num).toInt();
    _userId = id;
    final user = User(
      id: id,
      email: me['email'] as String? ?? '',
      fullName: me['full_name'] as String? ?? '',
      avatarUrl: me['avatar_url'] as String?,
    );
    if (!_currentUserCompleter.isCompleted) {
      _currentUserCompleter.complete(user);
    }
  }

  Message _parseMessage(Map<String, dynamic> m) {
    final id = (m['id'] as num).toInt();
    final senderId = (m['sender_id'] as num).toInt();
    final senderName = (m['sender_full_name'] as String?) ?? 'Unknown';
    final senderAvatarUrl = m['avatar_url'] as String?;
    final content = _stripHtml((m['content'] as String?) ?? '');
    final timestamp = DateTime.fromMillisecondsSinceEpoch(
      (m['timestamp'] as num).toInt() * 1000,
    );

    // Zulip <9 emits "stream" on message.type; 9+ may emit "channel".
    // Treat both as ChannelMessage and normalize in the SDK so callers
    // never need to special-case the wire dialect (see CLAUDE.md).
    final wireType = m['type'] as String?;
    if (wireType == 'private' || wireType == 'direct') {
      final rawRecipients = m['display_recipient'];
      final recipients = <User>[];
      if (rawRecipients is List) {
        for (final r in rawRecipients) {
          if (r is! Map<String, dynamic>) continue;
          final uid = (r['id'] as num?)?.toInt();
          if (uid == null) continue;
          recipients.add(
            User(
              id: uid,
              fullName: r['full_name'] as String? ?? '',
              email: r['email'] as String? ?? '',
              avatarUrl: null,
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
        timestamp: timestamp,
      );
    }
    return ChannelMessage(
      id: id,
      senderId: senderId,
      senderName: senderName,
      senderAvatarUrl: senderAvatarUrl,
      channelName: (m['display_recipient'] as String?) ?? '',
      topic: (m['subject'] as String?) ?? '',
      content: content,
      timestamp: timestamp,
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

ErrorCode _classifyError(Object e) {
  if (e is SocketException) return ErrorCode.network;
  if (e is http.ClientException) return ErrorCode.network;
  final message = e.toString();
  if (message.contains('HTTP 401') || message.contains('HTTP 403')) {
    return ErrorCode.unauthorized;
  }
  if (message.contains('HTTP 429')) return ErrorCode.rateLimited;
  return ErrorCode.unknown;
}

ErrorCode _classifyStatus(int status) {
  if (status == 401 || status == 403) return ErrorCode.unauthorized;
  if (status == 429) return ErrorCode.rateLimited;
  if (status >= 500) return ErrorCode.network;
  return ErrorCode.unknown;
}

/// Mutable accumulator used by
/// `ZulipTransport.listDirectMessageConversations` while bucketing recent
/// private messages by participant set. The final record handed back to
/// callers is an immutable [DirectMessageConversation].
class _DmBucket {
  _DmBucket({
    required this.userIds,
    required this.users,
    required this.lastMessageId,
  });
  final List<int> userIds;
  final List<User> users;
  int lastMessageId;
}

int? _retryAfterMs(http.Response resp) {
  // Parse Retry-After: either seconds (RFC 7231) or an HTTP-date. We only
  // honour the seconds form — HTTP-dates on a Zulip rate-limit response
  // are effectively unheard-of and parsing them here isn't worth the
  // surface area.
  final header = resp.headers['retry-after'];
  if (header == null) return null;
  final seconds = int.tryParse(header.trim());
  if (seconds == null) return null;
  return seconds * 1000;
}
