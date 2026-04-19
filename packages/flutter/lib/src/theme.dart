import 'package:flutter/material.dart';

/// Palette used by [ZulipChat] and its child widgets. Swap in [dark] or
/// construct your own to match the host app.
@immutable
class ZulipTheme {
  const ZulipTheme({
    required this.background,
    required this.surface,
    required this.primary,
    required this.onPrimary,
    required this.text,
    required this.muted,
    required this.border,
    required this.ownBubble,
    required this.otherBubble,
    required this.ownText,
    required this.otherText,
  });

  final Color background;
  final Color surface;
  final Color primary;
  final Color onPrimary;
  final Color text;
  final Color muted;
  final Color border;
  final Color ownBubble;
  final Color otherBubble;
  final Color ownText;
  final Color otherText;

  static const ZulipTheme light = ZulipTheme(
    background: Color(0xFFF8FAFC),
    surface: Color(0xFFFFFFFF),
    primary: Color(0xFF6172F3),
    onPrimary: Color(0xFFFFFFFF),
    text: Color(0xFF111827),
    muted: Color(0xFF6B7280),
    border: Color(0xFFE5E7EB),
    ownBubble: Color(0xFF6172F3),
    otherBubble: Color(0xFFF3F4F6),
    ownText: Color(0xFFFFFFFF),
    otherText: Color(0xFF111827),
  );

  static const ZulipTheme dark = ZulipTheme(
    background: Color(0xFF0F172A),
    surface: Color(0xFF1E293B),
    primary: Color(0xFF818CF8),
    onPrimary: Color(0xFF0F172A),
    text: Color(0xFFE2E8F0),
    muted: Color(0xFF94A3B8),
    border: Color(0xFF334155),
    ownBubble: Color(0xFF818CF8),
    otherBubble: Color(0xFF334155),
    ownText: Color(0xFF0F172A),
    otherText: Color(0xFFE2E8F0),
  );
}
