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
  });

  final List<Message> messages;
  final ZulipTheme theme;
  final int? currentUserId;
  final bool isLoading;

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
  });

  final Message message;
  final ZulipTheme theme;
  final bool isSelf;
  final bool showHeader;
  final DateTime now;

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
                Container(
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
                    style: TextStyle(color: textColor, fontSize: 14, height: 1.35),
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
