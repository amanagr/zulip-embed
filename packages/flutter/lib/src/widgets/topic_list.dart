import 'package:flutter/material.dart';

import '../theme.dart';
import '../transport.dart';
import '../types.dart';

/// Plug-and-play Flutter widget that renders the topics inside [channel]
/// for a connected transport. Mirrors the upcoming `<zulip-topic-list>`
/// Web Component. Tap a row to get an `onTopicSelected` callback.
class ZulipTopicList extends StatefulWidget {
  const ZulipTopicList({
    super.key,
    required this.transport,
    required this.channel,
    this.theme = ZulipTheme.light,
    this.onTopicSelected,
    this.selectedTopic,
  });

  final Transport transport;
  final String channel;
  final ZulipTheme theme;
  final void Function(Topic topic)? onTopicSelected;
  final String? selectedTopic;

  @override
  State<ZulipTopicList> createState() => _ZulipTopicListState();
}

class _ZulipTopicListState extends State<ZulipTopicList> {
  List<Topic> _topics = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ZulipTopicList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.channel != widget.channel ||
        oldWidget.transport != widget.transport) {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.transport.listTopics(widget.channel);
      if (!mounted) return;
      setState(() {
        _topics = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.theme;
    if (_loading) {
      return Center(child: CircularProgressIndicator(color: t.primary));
    }
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(_error!, style: TextStyle(color: t.muted, fontSize: 12)),
      );
    }
    if (_topics.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'No topics in #${widget.channel}',
          style: TextStyle(color: t.muted, fontSize: 13),
        ),
      );
    }
    return Material(
      color: t.surface,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: _topics.length,
        itemBuilder: (context, i) {
          final topic = _topics[i];
          final selected = widget.selectedTopic == topic.name;
          return Material(
            color: selected ? t.background : Colors.transparent,
            child: InkWell(
              onTap: () => widget.onTopicSelected?.call(topic),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
                child: Row(
                  children: [
                    if (topic.isResolved)
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: Icon(
                          Icons.check_circle,
                          size: 14,
                          color: t.muted,
                        ),
                      ),
                    Expanded(
                      child: Text(
                        topic.name,
                        style: TextStyle(
                          color: topic.isResolved ? t.muted : t.text,
                          fontSize: 13,
                          decoration: topic.isResolved
                              ? TextDecoration.lineThrough
                              : TextDecoration.none,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (topic.unreadCount > 0)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: t.primary,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          topic.unreadCount > 99
                              ? '99+'
                              : topic.unreadCount.toString(),
                          style: TextStyle(
                            color: t.onPrimary,
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
