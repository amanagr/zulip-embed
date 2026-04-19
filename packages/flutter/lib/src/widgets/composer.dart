import 'package:flutter/material.dart';

import '../theme.dart';

/// Text input + send button for composing a new message.
class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.theme,
    required this.onSend,
    this.enabled = true,
    this.hintText = 'Message…',
  });

  final ZulipTheme theme;
  final Future<void> Function(String text) onSend;
  final bool enabled;
  final String hintText;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _controller = TextEditingController();
  final _focus = FocusNode();
  bool _sending = false;

  bool get _canSend =>
      widget.enabled && !_sending && _controller.text.trim().isNotEmpty;

  @override
  void initState() {
    super.initState();
    _controller.addListener(() => setState(() {}));
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending || !widget.enabled) return;
    setState(() => _sending = true);
    _controller.clear();
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
