import 'package:flutter_test/flutter_test.dart';
import 'package:zulip_embed/zulip_embed.dart';

void main() {
  group('formatTime', () {
    test('same-day timestamp formats as HH:mm', () {
      final now = DateTime(2026, 4, 19, 15, 0);
      final t = DateTime(2026, 4, 19, 9, 30);
      expect(formatTime(t, now: now), '09:30');
    });

    test('different-day timestamp includes month/day', () {
      final now = DateTime(2026, 4, 19, 15, 0);
      final t = DateTime(2026, 4, 18, 9, 30);
      expect(formatTime(t, now: now), '4/18 09:30');
    });

    test('pads single-digit hour and minute', () {
      final now = DateTime(2026, 4, 19, 15, 0);
      final t = DateTime(2026, 4, 19, 1, 5);
      expect(formatTime(t, now: now), '01:05');
    });
  });

  group('initialsFor', () {
    test('returns placeholder for empty name', () {
      expect(initialsFor(''), '?');
      expect(initialsFor('   '), '?');
    });

    test('single word returns one initial', () {
      expect(initialsFor('Alice'), 'A');
      expect(initialsFor('alice'), 'A');
    });

    test('two words returns first + last initial', () {
      expect(initialsFor('Alice Example'), 'AE');
      expect(initialsFor('Jane Q Public'), 'JP');
    });
  });

  group('avatarColor', () {
    test('returns a stable color for the same name', () {
      expect(avatarColor('Alice'), avatarColor('Alice'));
    });

    test('returns fallback color for empty name without throwing', () {
      expect(() => avatarColor(''), returnsNormally);
    });
  });

  group('avatarGradient', () {
    test('is deterministic for the same name', () {
      final a = avatarGradient('Alice');
      final b = avatarGradient('Alice');
      expect(a.start, b.start);
      expect(a.end, b.end);
    });

    test('different names produce different gradients for most inputs', () {
      final a = avatarGradient('Alice');
      final b = avatarGradient('Iago');
      expect(a.start == b.start && a.end == b.end, isFalse);
    });

    test('gradient start and end differ (offset hues)', () {
      final g = avatarGradient('Hamlet');
      expect(g.start, isNot(g.end));
    });

    test('exposes a LinearGradient with two stops', () {
      final g = avatarGradient('Ophelia');
      expect(g.gradient.colors.length, 2);
    });

    test('solid getter mirrors the legacy avatarColor start hue', () {
      final g = avatarGradient('Alice');
      expect(g.solid, g.start);
      expect(avatarColor('Alice'), g.start);
    });
  });
}
