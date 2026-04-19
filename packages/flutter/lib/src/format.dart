import 'package:flutter/material.dart';

class AvatarColor {
  const AvatarColor({required this.start, required this.end});

  final Color start;
  final Color end;

  Color get solid => start;

  LinearGradient get gradient => LinearGradient(
        colors: [start, end],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      );
}

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

const int _avatarHueCount = 12;
const double _avatarHueStep = 360 / _avatarHueCount;
const double _avatarHueOffset = 40;
const double _avatarSaturation = 0.68;
const double _avatarLightnessStart = 0.55;
const double _avatarLightnessEnd = 0.42;

int _hashName(String name) {
  if (name.isEmpty) return 0;
  var hash = 0;
  for (final c in name.codeUnits) {
    hash = (hash * 31 + c) & 0x7FFFFFFF;
  }
  return hash;
}

AvatarColor avatarGradient(String name) {
  final bucket = _hashName(name) % _avatarHueCount;
  final h1 = (bucket * _avatarHueStep) % 360;
  final h2 = (h1 + _avatarHueOffset) % 360;
  final start = HSLColor.fromAHSL(1, h1, _avatarSaturation, _avatarLightnessStart).toColor();
  final end = HSLColor.fromAHSL(1, h2, _avatarSaturation, _avatarLightnessEnd).toColor();
  return AvatarColor(start: start, end: end);
}

Color avatarColor(String name) => avatarGradient(name).solid;
