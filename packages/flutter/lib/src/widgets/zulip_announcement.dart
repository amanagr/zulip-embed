import 'package:flutter/material.dart';

import '../theme.dart';
import '../transport.dart';
import '../types.dart';

/// Plug-and-play banner that surfaces a single pinned announcement message.
/// Mirrors the `<zulip-announcement>` Web Component: give it a [Transport]
/// and a [messageId] and it fetches + renders the message content, with
/// an optional dismiss affordance.
///
/// The widget does NOT close [transport] when it disposes — callers that
/// share a transport with [ZulipChat] own its lifetime.
///
/// HTML content is stripped to plain text before display (mirroring the
/// rest of the Flutter SDK, which doesn't ship an HTML renderer). If you
/// need rich formatting in an announcement, ingest the message via the
/// raw transport and build your own renderer on top of the HTML.
class ZulipAnnouncement extends StatefulWidget {
  const ZulipAnnouncement({
    super.key,
    required this.transport,
    required this.messageId,
    this.theme = ZulipTheme.light,
    this.dismissible = false,
    this.onDismissed,
  });

  final Transport transport;
  final int messageId;
  final ZulipTheme theme;
  final bool dismissible;
  final VoidCallback? onDismissed;

  @override
  State<ZulipAnnouncement> createState() => _ZulipAnnouncementState();
}

class _ZulipAnnouncementState extends State<ZulipAnnouncement> {
  Message? _message;
  bool _loading = true;
  String? _error;
  bool _dismissed = false;
  int _loadToken = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ZulipAnnouncement oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.messageId != widget.messageId ||
        oldWidget.transport != widget.transport) {
      _dismissed = false;
      _load();
    }
  }

  Future<void> _load() async {
    final token = ++_loadToken;
    setState(() {
      _loading = true;
      _error = null;
      _message = null;
    });
    try {
      final msg = await widget.transport.fetchMessage(widget.messageId);
      if (!mounted || token != _loadToken) return;
      if (msg == null) {
        setState(() {
          _loading = false;
          _error = 'Message ${widget.messageId} is not visible to the '
              'current viewer.';
        });
        return;
      }
      setState(() {
        _loading = false;
        _message = msg;
      });
    } catch (e) {
      if (!mounted || token != _loadToken) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  void _dismiss() {
    setState(() => _dismissed = true);
    widget.onDismissed?.call();
  }

  @override
  Widget build(BuildContext context) {
    if (_dismissed) return const SizedBox.shrink();
    final t = widget.theme;
    return Container(
      decoration: BoxDecoration(
        color: t.surface,
        border: Border.all(color: t.border),
        borderRadius: BorderRadius.circular(12),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            margin: const EdgeInsets.only(top: 2),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: t.primary,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              'ANNOUNCEMENT',
              style: TextStyle(
                color: t.onPrimary,
                fontSize: 10,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.4,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _buildBody(t),
          ),
          if (widget.dismissible) ...[
            const SizedBox(width: 8),
            InkResponse(
              onTap: _dismiss,
              radius: 18,
              child: Icon(Icons.close, size: 18, color: t.muted),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBody(ZulipTheme t) {
    if (_loading) {
      return Text(
        'Loading announcement…',
        style: TextStyle(color: t.muted, fontSize: 13),
      );
    }
    if (_error != null) {
      return Text(
        _error!,
        style: TextStyle(color: t.muted, fontSize: 13),
      );
    }
    final msg = _message;
    if (msg == null) return const SizedBox.shrink();
    final body = msg.contentIsHtml ? _stripHtml(msg.content) : msg.content;
    return Text(
      body,
      style: TextStyle(color: t.text, fontSize: 14, height: 1.5),
    );
  }
}

final _tagPattern = RegExp(r'<[^>]+>');

String _stripHtml(String html) {
  return html
      .replaceAll(_tagPattern, '')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .trim();
}
