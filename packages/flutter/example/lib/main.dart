import 'package:flutter/material.dart';
import 'package:zulip_embed/zulip_embed.dart';

void main() {
  runApp(const ExampleApp());
}

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Zulip Embed · Flutter example',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF6172F3),
      ),
      home: const HomeScreen(),
    );
  }
}

class _Config {
  const _Config({
    required this.useDemo,
    required this.serverUrl,
    required this.email,
    required this.apiKey,
    required this.channel,
    required this.topic,
  });

  final bool useDemo;
  final String serverUrl;
  final String email;
  final String apiKey;
  final String channel;
  final String topic;

  _Config copyWith({
    bool? useDemo,
    String? serverUrl,
    String? email,
    String? apiKey,
    String? channel,
    String? topic,
  }) {
    return _Config(
      useDemo: useDemo ?? this.useDemo,
      serverUrl: serverUrl ?? this.serverUrl,
      email: email ?? this.email,
      apiKey: apiKey ?? this.apiKey,
      channel: channel ?? this.channel,
      topic: topic ?? this.topic,
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _darkTheme = false;
  _Config _config = const _Config(
    useDemo: true,
    serverUrl: '',
    email: '',
    apiKey: '',
    channel: 'general',
    topic: 'welcome',
  );
  Transport? _transport;
  int _instanceKey = 0;

  @override
  void initState() {
    super.initState();
    _rebuildTransport();
  }

  void _rebuildTransport() {
    _transport?.close();
    _transport = _config.useDemo
        ? DemoTransport()
        : ZulipTransport(
            serverUrl: Uri.parse(_config.serverUrl),
            email: _config.email,
            apiKey: _config.apiKey,
          );
    _instanceKey++;
  }

  Future<void> _openSettings() async {
    final result = await showModalBottomSheet<_Config>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => _SettingsSheet(initial: _config),
    );
    if (result != null) {
      setState(() {
        _config = result;
        _rebuildTransport();
      });
    }
  }

  @override
  void dispose() {
    _transport?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = _darkTheme ? ZulipTheme.dark : ZulipTheme.light;
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        title: const Text('Zulip Embed · Flutter'),
        actions: [
          IconButton(
            tooltip: _darkTheme ? 'Light theme' : 'Dark theme',
            icon: Icon(_darkTheme ? Icons.light_mode : Icons.dark_mode),
            onPressed: () => setState(() => _darkTheme = !_darkTheme),
          ),
          IconButton(
            tooltip: 'Connection settings',
            icon: const Icon(Icons.settings),
            onPressed: _openSettings,
          ),
        ],
      ),
      body: ZulipChat(
        key: ValueKey(_instanceKey),
        transport: _transport!,
        channel: _config.channel,
        topic: _config.topic.isEmpty ? null : _config.topic,
        theme: theme,
      ),
    );
  }
}

class _SettingsSheet extends StatefulWidget {
  const _SettingsSheet({required this.initial});
  final _Config initial;

  @override
  State<_SettingsSheet> createState() => _SettingsSheetState();
}

class _SettingsSheetState extends State<_SettingsSheet> {
  late bool _useDemo = widget.initial.useDemo;
  late final _serverCtrl = TextEditingController(text: widget.initial.serverUrl);
  late final _emailCtrl = TextEditingController(text: widget.initial.email);
  late final _apiKeyCtrl = TextEditingController(text: widget.initial.apiKey);
  late final _channelCtrl = TextEditingController(text: widget.initial.channel);
  late final _topicCtrl = TextEditingController(text: widget.initial.topic);

  @override
  void dispose() {
    _serverCtrl.dispose();
    _emailCtrl.dispose();
    _apiKeyCtrl.dispose();
    _channelCtrl.dispose();
    _topicCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Connection',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: true, label: Text('Demo (offline)')),
              ButtonSegment(value: false, label: Text('Live Zulip server')),
            ],
            selected: {_useDemo},
            onSelectionChanged: (s) => setState(() => _useDemo = s.first),
          ),
          const SizedBox(height: 16),
          if (!_useDemo) ...[
            TextField(
              controller: _serverCtrl,
              decoration: const InputDecoration(
                labelText: 'Server URL',
                hintText: 'https://chat.example.com',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _emailCtrl,
              decoration: const InputDecoration(labelText: 'Email'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _apiKeyCtrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'API key'),
            ),
            const SizedBox(height: 16),
          ],
          TextField(
            controller: _channelCtrl,
            decoration: const InputDecoration(labelText: 'Channel'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _topicCtrl,
            decoration: const InputDecoration(labelText: 'Topic (optional)'),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () {
              Navigator.pop(
                context,
                _Config(
                  useDemo: _useDemo,
                  serverUrl: _serverCtrl.text.trim(),
                  email: _emailCtrl.text.trim(),
                  apiKey: _apiKeyCtrl.text.trim(),
                  channel: _channelCtrl.text.trim(),
                  topic: _topicCtrl.text.trim(),
                ),
              );
            },
            child: const Text('Apply'),
          ),
        ],
      ),
    );
  }
}
