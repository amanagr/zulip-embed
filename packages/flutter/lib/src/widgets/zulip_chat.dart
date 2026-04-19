import 'dart:async';

import 'package:flutter/material.dart';

import '../client.dart';
import '../theme.dart';
import '../transport.dart';
import '../types.dart';
import 'composer.dart';
import 'message_list.dart';

/// Top-level Flutter widget that renders a Zulip conversation.
///
/// The widget owns its own [ZulipClient] and subscribes to the provided
/// [Transport]. It handles connection lifecycle, message fetching,
/// incremental event updates, and sending new messages.
///
/// The provided [Transport] is **not** closed when the widget disposes —
/// callers that pass a shared transport are responsible for its lifetime.
class ZulipChat extends StatefulWidget {
  /// Channel-scoped constructor — the common entry point. Mirrors the
  /// original 0.7 signature so upgrading callers don't change anything.
  const ZulipChat({
    super.key,
    required this.transport,
    required String this.channel,
    this.topic,
    this.theme = ZulipTheme.light,
    this.title,
    this.onError,
  }) : dmUserIds = null;

  /// DM-scoped constructor. Pass the full participant set (including the
  /// viewer) so the scope resolves identically across peers.
  const ZulipChat.dm({
    super.key,
    required this.transport,
    required List<int> this.dmUserIds,
    this.theme = ZulipTheme.light,
    this.title,
    this.onError,
  })  : channel = null,
        topic = null;

  final Transport transport;
  final String? channel;
  final String? topic;
  final List<int>? dmUserIds;
  final ZulipTheme theme;
  final String? title;
  final void Function(String message)? onError;

  ScopeFilter get _scope {
    final ids = dmUserIds;
    if (ids != null) return ScopeFilter.dm(ids);
    return ScopeFilter.channel(channel!, topic: topic);
  }

  @override
  State<ZulipChat> createState() => _ZulipChatState();
}

class _ZulipChatState extends State<ZulipChat> {
  late ZulipClient _client;
  StreamSubscription<ZulipEvent>? _sub;
  final List<Message> _messages = [];
  List<TypingUser> _typingUsers = const [];
  ConnectionStatus _status = ConnectionStatus.disconnected;
  String? _error;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void didUpdateWidget(covariant ZulipChat oldWidget) {
    super.didUpdateWidget(oldWidget);
    final scopeChanged = oldWidget.channel != widget.channel ||
        oldWidget.topic != widget.topic ||
        !_listsEqual(oldWidget.dmUserIds, widget.dmUserIds) ||
        oldWidget.transport != widget.transport;
    if (scopeChanged) {
      _teardown().then((_) {
        if (mounted) _bootstrap();
      });
    }
  }

  static bool _listsEqual(List<int>? a, List<int>? b) {
    if (identical(a, b)) return true;
    if (a == null || b == null) return false;
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  Future<void> _bootstrap() async {
    _client = ZulipClient(widget.transport);
    _sub = _client.events.listen(_onEvent);
    if (mounted) {
      setState(() {
        _messages.clear();
        _status = ConnectionStatus.connecting;
        _error = null;
      });
    }
    try {
      await _client.connect(widget._scope);
      final history = await _client.fetchMessages();
      if (!mounted) return;
      setState(() {
        _messages
          ..clear()
          ..addAll(history);
      });
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      setState(() => _error = msg);
      widget.onError?.call(msg);
    }
  }

  Future<void> _teardown() async {
    await _sub?.cancel();
    _sub = null;
    await _client.dispose();
  }

  void _onEvent(ZulipEvent event) {
    if (!mounted) return;
    switch (event) {
      case ConnectionEvent(:final status):
        setState(() => _status = status);
      case MessageEvent(:final message):
        setState(() {
          if (_messages.every((m) => m.id != message.id)) {
            _messages.add(message);
          }
        });
      case MessageUpdateEvent(:final messageId, :final content, :final topic):
        setState(() {
          for (var i = 0; i < _messages.length; i++) {
            if (_messages[i].id != messageId) continue;
            _messages[i] = _messages[i].copyWith(
              content: content,
              contentIsHtml: content != null ? true : null,
              topic: topic,
            );
            break;
          }
        });
      case MessageDeleteEvent(:final messageId):
        setState(() => _messages.removeWhere((m) => m.id == messageId));
      case ReactionEvent(:final messageId, :final reactions):
        setState(() {
          for (var i = 0; i < _messages.length; i++) {
            if (_messages[i].id != messageId) continue;
            _messages[i] = _messages[i].copyWith(reactions: reactions);
            break;
          }
        });
      case TypingEvent(:final users):
        setState(() => _typingUsers = users);
      case ErrorEvent(:final message):
        setState(() => _error = message);
        widget.onError?.call(message);
    }
  }

  void _onTyping(TypingOp op) {
    unawaited(_client.sendTyping(op));
  }

  Future<void> _onSend(String text) async {
    try {
      await _client.sendMessage(text);
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      setState(() => _error = msg);
      widget.onError?.call(msg);
    }
  }

  Future<void> _onEditMessage(Message message) async {
    final controller = TextEditingController(text: message.content);
    final t = widget.theme;
    final updated = await showDialog<String>(
      context: context,
      builder: (dctx) {
        return AlertDialog(
          backgroundColor: t.surface,
          title: Text('Edit message', style: TextStyle(color: t.text)),
          content: TextField(
            controller: controller,
            autofocus: true,
            maxLines: 5,
            minLines: 1,
            style: TextStyle(color: t.text),
            decoration: const InputDecoration(border: OutlineInputBorder()),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dctx).pop(),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.of(dctx).pop(controller.text.trim()),
              child: const Text('Save'),
            ),
          ],
        );
      },
    );
    controller.dispose();
    if (updated == null || updated.isEmpty || updated == message.content) return;
    try {
      await _client.editMessage(messageId: message.id, content: updated);
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      setState(() => _error = msg);
      widget.onError?.call(msg);
    }
  }

  Future<void> _onReactionToggle(Message message, String emoji) async {
    final viewerId = _client.currentUserId;
    final existing = message.reactions.firstWhere(
      (r) => r.emoji == emoji,
      orElse: () => const Reaction(emoji: '', userIds: []),
    );
    final selfReacted =
        viewerId != null && existing.userIds.contains(viewerId);
    try {
      if (selfReacted) {
        await _client.removeReaction(messageId: message.id, emoji: emoji);
      } else {
        await _client.addReaction(messageId: message.id, emoji: emoji);
      }
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      setState(() => _error = msg);
      widget.onError?.call(msg);
    }
  }

  Future<void> _onDeleteMessage(Message message) async {
    final t = widget.theme;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dctx) {
        return AlertDialog(
          backgroundColor: t.surface,
          title: Text('Delete message?', style: TextStyle(color: t.text)),
          content: Text(
            'This cannot be undone.',
            style: TextStyle(color: t.muted),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dctx).pop(false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.of(dctx).pop(true),
              child: const Text(
                'Delete',
                style: TextStyle(color: Color(0xFFEF4444)),
              ),
            ),
          ],
        );
      },
    );
    if (confirmed != true) return;
    try {
      await _client.deleteMessage(message.id);
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      setState(() => _error = msg);
      widget.onError?.call(msg);
    }
  }

  @override
  void dispose() {
    unawaited(_teardown());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.theme;
    final subtitle = widget.topic;
    final String defaultTitle;
    final dmIds = widget.dmUserIds;
    if (dmIds != null) {
      defaultTitle = dmIds.length <= 1 ? 'Direct' : 'Direct (${dmIds.length})';
    } else {
      defaultTitle = '#${widget.channel}';
    }
    return Material(
      color: t.background,
      child: Column(
        children: [
          _ChatHeader(
            theme: t,
            title: widget.title ?? defaultTitle,
            subtitle: subtitle,
            status: _status,
          ),
          if (_error != null)
            _ErrorBanner(
              theme: t,
              message: _error!,
              onDismiss: () => setState(() => _error = null),
            ),
          Expanded(
            child: MessageList(
              messages: _messages,
              theme: t,
              currentUserId: _client.currentUserId,
              isLoading: _status == ConnectionStatus.connecting &&
                  _messages.isEmpty,
              onEdit: _onEditMessage,
              onDelete: _onDeleteMessage,
              onReactionToggle: _onReactionToggle,
            ),
          ),
          if (_typingUsers.isNotEmpty)
            _TypingRow(theme: t, users: _typingUsers),
          Composer(
            theme: t,
            onSend: _onSend,
            enabled: _status == ConnectionStatus.connected,
            onTyping: _onTyping,
          ),
        ],
      ),
    );
  }
}

class _ChatHeader extends StatelessWidget {
  const _ChatHeader({
    required this.theme,
    required this.title,
    required this.subtitle,
    required this.status,
  });

  final ZulipTheme theme;
  final String title;
  final String? subtitle;
  final ConnectionStatus status;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: theme.surface,
        border: Border(bottom: BorderSide(color: theme.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: theme.text,
                    fontWeight: FontWeight.w600,
                    fontSize: 15,
                  ),
                ),
                if (subtitle != null && subtitle!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      subtitle!,
                      style: TextStyle(color: theme.muted, fontSize: 12),
                    ),
                  ),
              ],
            ),
          ),
          _ConnectionDot(theme: theme, status: status),
        ],
      ),
    );
  }
}

class _ConnectionDot extends StatelessWidget {
  const _ConnectionDot({required this.theme, required this.status});

  final ZulipTheme theme;
  final ConnectionStatus status;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (status) {
      ConnectionStatus.connected => (const Color(0xFF22C55E), 'Connected'),
      ConnectionStatus.connecting => (const Color(0xFFF59E0B), 'Connecting…'),
      ConnectionStatus.reconnecting => (
          const Color(0xFFF59E0B),
          'Reconnecting…',
        ),
      ConnectionStatus.error => (const Color(0xFFEF4444), 'Error'),
      ConnectionStatus.disconnected => (theme.muted, 'Offline'),
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(color: theme.muted, fontSize: 11)),
      ],
    );
  }
}

class _TypingRow extends StatelessWidget {
  const _TypingRow({required this.theme, required this.users});

  final ZulipTheme theme;
  final List<TypingUser> users;

  String _label() {
    if (users.isEmpty) return '';
    if (users.length == 1) return '${users[0].fullName} is typing…';
    if (users.length == 2) {
      return '${users[0].fullName} and ${users[1].fullName} are typing…';
    }
    return 'Several people are typing…';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: theme.surface,
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      child: Text(
        _label(),
        style: TextStyle(
          color: theme.muted,
          fontSize: 12,
          fontStyle: FontStyle.italic,
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({
    required this.theme,
    required this.message,
    required this.onDismiss,
  });

  final ZulipTheme theme;
  final String message;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: const Color(0xFFFEE2E2),
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: Color(0xFF991B1B), size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: Color(0xFF991B1B), fontSize: 12),
            ),
          ),
          IconButton(
            iconSize: 16,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 24, minHeight: 24),
            onPressed: onDismiss,
            icon: const Icon(Icons.close, color: Color(0xFF991B1B)),
          ),
        ],
      ),
    );
  }
}
