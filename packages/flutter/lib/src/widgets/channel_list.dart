import 'package:flutter/material.dart';

import '../theme.dart';
import '../transport.dart';
import '../types.dart';

/// Plug-and-play Flutter widget that renders the subscribed-channels list
/// for a connected transport. Mirrors the upcoming `<zulip-channel-list>`
/// Web Component: tap a row to get a `onChannelSelected` callback.
///
/// The provided [Transport] is **not** closed when the widget disposes —
/// callers that share a transport with e.g. [ZulipChat] own its lifetime.
class ZulipChannelList extends StatefulWidget {
  const ZulipChannelList({
    super.key,
    required this.transport,
    this.theme = ZulipTheme.light,
    this.onChannelSelected,
    this.selectedChannel,
  });

  final Transport transport;
  final ZulipTheme theme;
  final void Function(Channel channel)? onChannelSelected;

  /// Name of the currently-selected channel; highlighted in the list.
  final String? selectedChannel;

  @override
  State<ZulipChannelList> createState() => _ZulipChannelListState();
}

class _ZulipChannelListState extends State<ZulipChannelList> {
  List<Channel> _channels = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ZulipChannelList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.transport != widget.transport) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.transport.listChannels();
      if (!mounted) return;
      setState(() {
        _channels = result;
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
    if (_channels.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'No subscribed channels',
          style: TextStyle(color: t.muted, fontSize: 13),
        ),
      );
    }
    return Material(
      color: t.surface,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: _channels.length,
        itemBuilder: (context, i) {
          final c = _channels[i];
          final selected = widget.selectedChannel == c.name;
          return _ChannelRow(
            channel: c,
            theme: t,
            selected: selected,
            onTap: () => widget.onChannelSelected?.call(c),
          );
        },
      ),
    );
  }
}

class _ChannelRow extends StatelessWidget {
  const _ChannelRow({
    required this.channel,
    required this.theme,
    required this.selected,
    required this.onTap,
  });

  final Channel channel;
  final ZulipTheme theme;
  final bool selected;
  final VoidCallback onTap;

  Color _dotColor() {
    final hex = channel.color;
    if (hex == null || !hex.startsWith('#') || hex.length != 7) {
      return theme.primary;
    }
    try {
      return Color(int.parse(hex.substring(1), radix: 16) | 0xFF000000);
    } catch (_) {
      return theme.primary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final nameStyle = TextStyle(
      color: channel.isMuted ? theme.muted : theme.text,
      fontSize: 14,
      fontWeight: channel.pinToTop ? FontWeight.w600 : FontWeight.w500,
    );
    return Material(
      color: selected ? theme.background : Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: _dotColor(),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 10),
              if (channel.pinToTop)
                Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Icon(
                    Icons.push_pin,
                    size: 12,
                    color: theme.muted,
                  ),
                ),
              Expanded(
                child: Text(
                  '#${channel.name}',
                  style: nameStyle,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (channel.unreadCount > 0)
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
                    channel.unreadCount > 99
                        ? '99+'
                        : channel.unreadCount.toString(),
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
