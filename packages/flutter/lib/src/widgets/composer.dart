import 'dart:async';

import 'package:flutter/material.dart';

import '../theme.dart';
import '../types.dart';

/// Refresh a still-typing ping every 8s while the composer is active.
const _typingRefresh = Duration(seconds: 8);

/// Emit `stop` once 5s have passed since the last keystroke.
const _typingIdle = Duration(seconds: 5);

/// Text input + send button for composing a new message.
class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.theme,
    required this.onSend,
    this.enabled = true,
    this.hintText = 'Message…',
    this.onTyping,
  });

  final ZulipTheme theme;
  final Future<void> Function(String text) onSend;
  final bool enabled;
  final String hintText;

  /// Optional typing-ping hook. Called with [TypingOp.start] when the user
  /// becomes active (and again every 8s to refresh), [TypingOp.stop] when
  /// they go idle, send, or the composer tears down.
  final void Function(TypingOp op)? onTyping;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _controller = TextEditingController();
  final _focus = FocusNode();
  bool _sending = false;
  bool _typingActive = false;
  Timer? _typingRefreshTimer;
  Timer? _typingIdleTimer;
  String _lastText = '';

  bool get _canSend =>
      widget.enabled && !_sending && _controller.text.trim().isNotEmpty;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onTextChanged);
  }

  void _onTextChanged() {
    setState(() {});
    final text = _controller.text;
    if (text == _lastText) return;
    _lastText = text;
    if (text.isEmpty) {
      _stopTyping();
    } else {
      _pingTyping();
    }
  }

  void _pingTyping() {
    if (widget.onTyping == null || !widget.enabled) return;
    if (!_typingActive) {
      _typingActive = true;
      widget.onTyping!(TypingOp.start);
      _typingRefreshTimer?.cancel();
      _typingRefreshTimer = Timer.periodic(_typingRefresh, (_) {
        widget.onTyping?.call(TypingOp.start);
      });
    }
    _typingIdleTimer?.cancel();
    _typingIdleTimer = Timer(_typingIdle, _stopTyping);
  }

  void _stopTyping() {
    _typingIdleTimer?.cancel();
    _typingIdleTimer = null;
    _typingRefreshTimer?.cancel();
    _typingRefreshTimer = null;
    if (!_typingActive) return;
    _typingActive = false;
    widget.onTyping?.call(TypingOp.stop);
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending || !widget.enabled) return;
    _stopTyping();
    setState(() => _sending = true);
    _controller.clear();
    _lastText = '';
    try {
      await widget.onSend(text);
    } finally {
      if (mounted) {
        setState(() => _sending = false);
        _focus.requestFocus();
      }
    }
  }

  @override
  void dispose() {
    _stopTyping();
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.theme;
    return Container(
      decoration: BoxDecoration(
        color: t.surface,
        border: Border(top: BorderSide(color: t.border)),
      ),
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
      child: SafeArea(
        top: false,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _controller,
                focusNode: _focus,
                enabled: widget.enabled,
                style: TextStyle(color: t.text, fontSize: 14),
                minLines: 1,
                maxLines: 4,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                decoration: InputDecoration(
                  hintText: widget.hintText,
                  hintStyle: TextStyle(color: t.muted),
                  filled: true,
                  fillColor: t.background,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: t.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: t.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: t.primary, width: 1.5),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Material(
              color: _canSend ? t.primary : t.primary.withValues(alpha: 0.4),
              shape: const CircleBorder(),
              child: InkWell(
                onTap: _canSend ? _send : null,
                customBorder: const CircleBorder(),
                child: SizedBox(
                  width: 40,
                  height: 40,
                  child: _sending
                      ? Padding(
                          padding: const EdgeInsets.all(10),
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: t.onPrimary,
                          ),
                        )
                      : Icon(Icons.send, color: t.onPrimary, size: 18),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
