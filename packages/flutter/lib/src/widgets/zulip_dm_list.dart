import 'package:flutter/material.dart';

import '../format.dart' show avatarColor, initialsFor;
import '../theme.dart';
import '../transport.dart';
import '../types.dart';

/// Plug-and-play Flutter widget that renders recent direct-message
/// conversations surfaced by `Transport.listDirectMessageConversations`.
/// Mirror of the `<zulip-dm-list>` Web Component: tap a row to get an
/// `onDmSelected` callback with the canonical [DirectMessageConversation].
///
/// The provided [Transport] is **not** closed when the widget disposes —
/// callers that share a transport with e.g. [ZulipChat] own its lifetime.
class ZulipDmList extends StatefulWidget {
  const ZulipDmList({
    super.key,
    required this.transport,
    this.theme = ZulipTheme.light,
    this.onDmSelected,
    this.selectedUserIds,
  });

  final Transport transport;
  final ZulipTheme theme;
  final void Function(DirectMessageConversation conversation)? onDmSelected;

  /// Canonical user-id list of the currently-selected conversation —
  /// highlights the matching row. Compared via [DmScope]-style canonical
  /// equality (sorted, deduped) so callers don't need to pre-sort.
  final List<int>? selectedUserIds;

  @override
  State<ZulipDmList> createState() => _ZulipDmListState();
}

class _ZulipDmListState extends State<ZulipDmList> {
  List<DirectMessageConversation> _conversations = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ZulipDmList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.transport != widget.transport) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.transport.listDirectMessageConversations();
      if (!mounted) return;
      setState(() {
        _conversations = result;
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

  List<int> _canonical(List<int> ids) {
    final set = <int>{...ids};
    final sorted = set.toList()..sort();
    return sorted;
  }

  bool _matches(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
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
    if (_conversations.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'No direct messages',
          style: TextStyle(color: t.muted, fontSize: 13),
        ),
      );
    }
    final selected =
        widget.selectedUserIds == null ? null : _canonical(widget.selectedUserIds!);
    final viewerId = widget.transport.currentUserId;
    return Material(
      color: t.surface,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: _conversations.length,
        itemBuilder: (context, i) {
          final c = _conversations[i];
          final canonicalIds = c.userIds;
          final highlight = selected != null && _matches(selected, canonicalIds);
          return _DmRow(
            conversation: c,
            theme: t,
            viewerId: viewerId,
            selected: highlight,
            onTap: () => widget.onDmSelected?.call(c),
          );
        },
      ),
    );
  }
}

class _DmRow extends StatelessWidget {
  const _DmRow({
    required this.conversation,
    required this.theme,
    required this.viewerId,
    required this.selected,
    required this.onTap,
  });

  final DirectMessageConversation conversation;
  final ZulipTheme theme;
  final int? viewerId;
  final bool selected;
  final VoidCallback onTap;

  /// Build the display label. Strip the viewer from the participant set
  /// so a 1:1 DM reads as "Alice Anderson" rather than "Alice Anderson,
  /// You", and group DMs surface the peer names in a deterministic
  /// order. Falls back to "Direct" when no peer data is available.
  String _label() {
    final others = [
      for (final u in conversation.users)
        if (viewerId == null || u.id != viewerId) u,
    ];
    if (others.isEmpty) return 'Direct';
    if (others.length == 1) return others.first.fullName;
    final sorted = [...others]
      ..sort((a, b) => a.fullName.compareTo(b.fullName));
    if (sorted.length <= 3) {
      return [for (final u in sorted) u.fullName].join(', ');
    }
    return '${sorted[0].fullName}, ${sorted[1].fullName} +${sorted.length - 2}';
  }

  @override
  Widget build(BuildContext context) {
    final label = _label();
    final initials = initialsFor(label);
    return Material(
      color: selected ? theme.background : Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: avatarColor(label),
                  shape: BoxShape.circle,
                ),
                child: Text(
                  initials,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (conversation.unreadCount > 0)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: theme.primary,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    conversation.unreadCount > 99
                        ? '99+'
                        : conversation.unreadCount.toString(),
                    style: TextStyle(
                      color: theme.onPrimary,
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
  }
}
