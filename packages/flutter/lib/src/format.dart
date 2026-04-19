import 'package:flutter/material.dart';

String formatTime(DateTime timestamp, {DateTime? now}) {
  final reference = now ?? DateTime.now();
  final sameDay = reference.year == timestamp.year &&
      reference.month == timestamp.month &&
      reference.day == timestamp.day;
  final h = timestamp.hour.toString().padLeft(2, '0');
  final m = timestamp.minute.toString().padLeft(2, '0');
  if (sameDay) return '$h:$m';
  return '${timestamp.month}/${timestamp.day} $h:$m';
}

String initialsFor(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first.characters.first.toUpperCase();
  return (parts.first.characters.first + parts.last.characters.first)
      .toUpperCase();
}

const List<Color> _avatarPalette = [
  Color(0xFFEF4444),
  Color(0xFFF97316),
  Color(0xFFEAB308),
  Color(0xFF22C55E),
  Color(0xFF14B8A6),
  Color(0xFF3B82F6),
  Color(0xFF8B5CF6),
  Color(0xFFEC4899),
];

Color avatarColor(String name) {
  if (name.isEmpty) return _avatarPalette.first;
  var hash = 0;
  for (final c in name.codeUnits) {
    hash = (hash * 31 + c) & 0x7FFFFFFF;
  }
  return _avatarPalette[hash % _avatarPalette.length];
}
