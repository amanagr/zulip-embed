import 'package:flutter/material.dart';

import '../format.dart';
import '../theme.dart';
import '../types.dart';

/// Scrollable list of [Message]s with auto-scroll-to-bottom when new
/// messages arrive. Exposed as a public widget so advanced embedders can
/// build their own shell around it.
class MessageList extends StatefulWidget {
  const MessageList({
    super.key,
    required this.messages,
    required this.theme,
    this.currentUserId,
    this.isLoading = false,
    this.onEdit,
    this.onDelete,
    this.onReactionToggle,
  });

  final List<Message> messages;
  final ZulipTheme theme;
  final int? currentUserId;
  final bool isLoading;
  final void Function(Message message)? onEdit;
  final void Function(Message message)? onDelete;
  final void Function(Message message, String emoji)? onReactionToggle;

  @override
  State<MessageList> createState() => _MessageListState();
}

class _MessageListState extends State<MessageList> {
  final _scrollController = ScrollController();
  int _lastCount = 0;

  @override
  void didUpdateWidget(covariant MessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.messages.length != _lastCount) {
      _lastCount = widget.messages.length;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!_scrollController.hasClients) return;
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      });
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.isLoading) {
      return Center(
        child: CircularProgressIndicator(color: widget.theme.primary),
      );
    }
    if (widget.messages.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'No messages yet. Say hi!',
            style: TextStyle(color: widget.theme.muted),
          ),
        ),
      );
    }
    final now = DateTime.now();
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      itemCount: widget.messages.length,
      itemBuilder: (context, i) {
        final msg = widget.messages[i];
        final isSelf = msg.senderId == widget.currentUserId;
        final prev = i == 0 ? null : widget.messages[i - 1];
        final showHeader = prev == null || prev.senderId != msg.senderId;
        return _MessageBubble(
          message: msg,
          theme: widget.theme,
          isSelf: isSelf,
          showHeader: showHeader,
          now: now,
          viewerId: widget.currentUserId,
          onEdit: isSelf ? widget.onEdit : null,
          onDelete: isSelf ? widget.onDelete : null,
          onReactionToggle: widget.onReactionToggle,
        );
      },
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.message,
    required this.theme,
    required this.isSelf,
    required this.showHeader,
    required this.now,
    this.viewerId,
    this.onEdit,
    this.onDelete,
    this.onReactionToggle,
  });

  final Message message;
  final ZulipTheme theme;
  final bool isSelf;
  final bool showHeader;
  final DateTime now;
  final int? viewerId;
  final void Function(Message message)? onEdit;
  final void Function(Message message)? onDelete;
  final void Function(Message message, String emoji)? onReactionToggle;

  static const _quickEmojis = <String>[
    'thumbs_up',
    'heart',
    'joy',
    'tada',
    'eyes',
    'pray',
  ];

  void _showActions(BuildContext context) {
    final hasReactions = onReactionToggle != null;
    if (onEdit == null && onDelete == null && !hasReactions) return;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: theme.surface,
      builder: (sheetCtx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (hasReactions)
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      for (final emoji in _quickEmojis)
                        InkWell(
                          onTap: () {
                            Navigator.of(sheetCtx).pop();
                            onReactionToggle!(message, emoji);
                          },
                          borderRadius: BorderRadius.circular(20),
                          child: Padding(
                            padding: const EdgeInsets.all(6),
                            child: Text(
                              _emojiGlyph(emoji),
                              style: const TextStyle(fontSize: 22),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              if (onEdit != null)
                ListTile(
                  leading: Icon(Icons.edit, color: theme.text),
                  title: Text(
                    'Edit message',
                    style: TextStyle(color: theme.text),
                  ),
                  onTap: () {
                    Navigator.of(sheetCtx).pop();
                    onEdit!(message);
                  },
                ),
              if (onDelete != null)
                ListTile(
                  leading: const Icon(Icons.delete, color: Color(0xFFEF4444)),
                  title: const Text(
                    'Delete message',
                    style: TextStyle(color: Color(0xFFEF4444)),
                  ),
                  onTap: () {
                    Navigator.of(sheetCtx).pop();
                    onDelete!(message);
                  },
                ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final bubbleColor = isSelf ? theme.ownBubble : theme.otherBubble;
    final textColor = isSelf ? theme.ownText : theme.otherText;
    return Padding(
      padding: EdgeInsets.only(top: showHeader ? 10 : 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment:
            isSelf ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!isSelf) ...[
            SizedBox(
              width: 28,
              child: showHeader ? _Avatar(name: message.senderName) : null,
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment:
                  isSelf ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                if (showHeader)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          message.senderName,
                          style: TextStyle(
                            color: theme.text,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          formatTime(message.timestamp, now: now),
                          style: TextStyle(color: theme.muted, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                GestureDetector(
                  onLongPress:
                      (onEdit != null ||
                          onDelete != null ||
                          onReactionToggle != null)
                      ? () => _showActions(context)
                      : null,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: bubbleColor,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: SelectableText(
                      message.content,
                      style: TextStyle(
                        color: textColor,
                        fontSize: 14,
                        height: 1.35,
                      ),
                    ),
                  ),
                ),
                if (message.reactions.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: _ReactionChips(
                      message: message,
                      theme: theme,
                      viewerId: viewerId,
                      onToggle: onReactionToggle,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _emojiGlyph(String name) {
  // Map a handful of Zulip emoji names to their Unicode glyphs. Unknown
  // names fall back to the name itself so the chip stays meaningful.
  const table = {
    'thumbs_up': '👍',
    'heart': '❤️',
    'joy': '😂',
    'tada': '🎉',
    'eyes': '👀',
    'pray': '🙏',
    'rocket': '🚀',
    'check': '✅',
    'smile': '😄',
  };
  return table[name] ?? ':$name:';
}

class _ReactionChips extends StatelessWidget {
  const _ReactionChips({
    required this.message,
    required this.theme,
    required this.viewerId,
    required this.onToggle,
  });

  final Message message;
  final ZulipTheme theme;
  final int? viewerId;
  final void Function(Message message, String emoji)? onToggle;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: [
        for (final r in message.reactions)
          _ReactionChip(
            emoji: r.emoji,
            count: r.count,
            selfReacted: viewerId != null && r.userIds.contains(viewerId),
            theme: theme,
            onTap: onToggle == null ? null : () => onToggle!(message, r.emoji),
          ),
      ],
    );
  }
}

class _ReactionChip extends StatelessWidget {
  const _ReactionChip({
    required this.emoji,
    required this.count,
    required this.selfReacted,
    required this.theme,
    required this.onTap,
  });

  final String emoji;
  final int count;
  final bool selfReacted;
  final ZulipTheme theme;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final bg = selfReacted ? theme.primary.withValues(alpha: 0.12) : theme.background;
    final border = selfReacted ? theme.primary : theme.border;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: bg,
          border: Border.all(color: border, width: 1),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          '${_emojiGlyph(emoji)} $count',
          style: TextStyle(
            fontSize: 12,
            color: selfReacted ? theme.primary : theme.text,
            fontWeight: selfReacted ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      radius: 14,
      backgroundColor: avatarColor(name),
      child: Text(
        initialsFor(name),
        style: const TextStyle(
          color: Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
