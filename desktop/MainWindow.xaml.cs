using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Media;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Windows;
using AudioPartyDesktop.Services;

namespace AudioPartyDesktop;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window
{
    private const string ServerUrl = "https://audioparty.cineclark.studio";

    private readonly SignalingClient _signaling;
    private readonly AudioCaptureService _audioCapture;
    private readonly WebRtcHostService _webRtcHost;
    private readonly SongDetectionService _songDetection;
    private readonly WebRtcListenerService _webRtcListener;

    private string? _currentRoomCode;
    private bool _isHosting;
    private bool _discordSharingEnabled;
    private bool _isIntentionalDisconnect;

    // Listener (join a party) state
    private bool _isListening;
    private bool _listenerRejoining;
    private string? _listenerRoomCode;
    private bool _listenerConnected;

    public MainWindow()
    {
        InitializeComponent();

        var version = Assembly.GetExecutingAssembly().GetName().Version;
        VersionText.Text = version is null ? "" : $"v{version.Major}.{version.Minor}.{version.Build}";

        _signaling = new SignalingClient(ServerUrl);
        _audioCapture = new AudioCaptureService();
        _webRtcHost = new WebRtcHostService(_signaling);
        _songDetection = new SongDetectionService(ServerUrl);
        _webRtcListener = new WebRtcListenerService(_signaling);

        _signaling.Connected += OnSignalingConnected;
        _signaling.Disconnected += OnSignalingDisconnected;
        _signaling.ListenerJoined += OnListenerJoined;
        _signaling.ListenerLeft += OnListenerLeft;
        _signaling.ParticipantCountUpdated += OnParticipantCountUpdated;
        _signaling.HostDisconnected += OnHostDisconnected;
        _signaling.SongUpdated += OnSongUpdated;
        _signaling.HostReconnecting += () => Dispatcher.Invoke(() =>
        {
            if (_isListening) SetListenerStatus("🟡 Host reconnecting...", "#FB923C");
        });
        _signaling.HostResumed += _ => Dispatcher.Invoke(() =>
        {
            if (_isListening && _listenerConnected) SetListenerStatus("🟢 Connected", "#4ADE80");
        });
        _webRtcListener.ConnectionStateChanged += state => Dispatcher.Invoke(() => OnListenerConnectionStateChanged(state));

        _audioCapture.FrameCaptured += _webRtcHost.SendAudioFrame;
        _audioCapture.FrameCaptured += _songDetection.OnFrame;
        _songDetection.StateChanged += state => Dispatcher.Invoke(() => HostSongPanel.Show(state));
        _songDetection.SongIdentified += song =>
        {
            var roomCode = _currentRoomCode;
            if (roomCode is not null) _ = _signaling.SendSongDetectedAsync(roomCode, song);
        };

        RefreshSources();
        _ = _signaling.ConnectAsync();
    }

    private void RefreshSources()
    {
        var previous = SourceComboBox.SelectedItem as AudioSource;
        List<AudioSource> sources;
        try
        {
            sources = AudioSourceCatalog.Enumerate();
        }
        catch (Exception ex)
        {
            DebugLog.Write($"Source enumeration failed: {ex}");
            sources = new List<AudioSource>();
        }

        SourceComboBox.ItemsSource = sources;
        SourceComboBox.SelectedItem = (previous is null ? null : sources.FirstOrDefault(s => s.ProcessId == previous.ProcessId))
                                      ?? sources.FirstOrDefault();
        NoSourcesText.Visibility = sources.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void SourceComboBox_DropDownOpened(object sender, EventArgs e)
    {
        // Refresh on open so the list always reflects what is playing right now. Re-binding
        // while the popup is open is safe because the selection is restored by process id.
        RefreshSources();
    }

    private void HelpButton_Click(object sender, RoutedEventArgs e) => new HelpWindow { Owner = this }.ShowDialog();

    private bool _refreshAnimating;

    private void RefreshSourcesButton_Click(object sender, RoutedEventArgs e)
    {
        RefreshSources();

        // The lookup is near-instant, so show a spin and a brief checkmark to confirm it ran.
        if (_refreshAnimating) return;
        _refreshAnimating = true;

        var spin = new System.Windows.Media.Animation.DoubleAnimation(0, 360, TimeSpan.FromMilliseconds(600))
        {
            EasingFunction = new System.Windows.Media.Animation.CubicEase { EasingMode = System.Windows.Media.Animation.EasingMode.EaseInOut },
            FillBehavior = System.Windows.Media.Animation.FillBehavior.Stop
        };
        spin.Completed += async (_, _) =>
        {
            RefreshIcon.Text = "✓";
            RefreshIcon.Foreground = (Brush)FindResource("Success");
            await Task.Delay(900);
            RefreshIcon.Text = "↻";
            RefreshIcon.ClearValue(System.Windows.Controls.TextBlock.ForegroundProperty);
            _refreshAnimating = false;
        };
        RefreshRotation.BeginAnimation(RotateTransform.AngleProperty, spin);
    }

    private void OnSignalingConnected()
    {
        Dispatcher.Invoke(() =>
        {
            HostButton.IsEnabled = true;
            JoinButton.IsEnabled = true;
            _ = RefreshRelayStatusAsync();

            // Socket dropped mid-party and came back: rejoin the same room under the new socket id.
            if (_isListening && _listenerRejoining) _ = RejoinAsync();
        });
    }

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(8) };

    private void SetStatus(string text, string? colorHex = null, string? tooltip = null)
    {
        var brush = colorHex is null
            ? (Brush)FindResource("TextPrimary")
            : new SolidColorBrush((Color)ColorConverter.ConvertFromString(colorHex));

        StatusText.Text = text;
        StatusText.ToolTip = tooltip;
        StatusText.Foreground = brush;

        // The hosting screen shows the same status inline in the room-code bar.
        HostRelayText.Text = text;
        HostRelayText.ToolTip = tooltip;
        HostRelayText.Foreground = brush;
    }

    /// <summary>Same TURN relay check the browser host shows (server /api/turn-status).</summary>
    private async Task RefreshRelayStatusAsync()
    {
        try
        {
            using var doc = JsonDocument.Parse(await Http.GetStringAsync($"{ServerUrl}/api/turn-status"));
            var root = doc.RootElement;
            bool available = root.TryGetProperty("available", out var a) && a.GetBoolean();
            string message = root.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "";

            if (available)
            {
                string server = root.TryGetProperty("server", out var sv) ? sv.GetString() ?? "" : "";
                SetStatus("🟢 Relay: Online", "#4ADE80", $"TURN server ({server}) is reachable");
            }
            else
            {
                SetStatus("🔴 Relay: Offline", "#F87171", message);
            }
        }
        catch (Exception ex)
        {
            SetStatus("⚠️ Relay: Error", "#FB923C", $"Failed to check TURN server status: {ex.Message}");
        }
    }

    private void OnSignalingDisconnected()
    {
        Dispatcher.Invoke(() =>
        {
            SetStatus("🔴 Disconnected");
            HostButton.IsEnabled = false;
            JoinButton.IsEnabled = false;

            if (_isListening && !_isIntentionalDisconnect)
            {
                // Socket.IO reconnects by itself; OnSignalingConnected rejoins the room.
                _listenerRejoining = true;
                SetListenerStatus("🟡 Reconnecting...", "#FB923C");
            }

            if (_isHosting && !_isIntentionalDisconnect)
            {
                StopHosting();
                MessageBox.Show("Lost connection to the server. The party has ended.", "AudioParty",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                ShowHomePanel();
            }

            _isIntentionalDisconnect = false;
        });
    }

    private async void HostButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            HostButton.IsEnabled = false;

            if (SourceComboBox.SelectedItem is not AudioSource source)
            {
                MessageBox.Show("No app is playing audio right now. Start playing audio in the app you want to share, then press ↻.",
                    "AudioParty", MessageBoxButton.OK, MessageBoxImage.Information);
                HostButton.IsEnabled = true;
                return;
            }

            _ = RefreshRelayStatusAsync();
            await _webRtcHost.LoadIceServersAsync(ServerUrl);
            _audioCapture.Start(source);
            SourceText.Text = source.DisplayName;
            var roomCode = await _signaling.CreateRoomAsync();

            _currentRoomCode = roomCode;
            _isHosting = true;

            RoomCodeText.Text = roomCode;
            ParticipantText.Text = "👥 1/10";
            ShowHostingPanel();
            HostSongPanel.Reset();
            _songDetection.Start();
        }
        catch (Exception ex)
        {
            _audioCapture.Stop();
            MessageBox.Show($"Failed to start hosting: {ex.Message}", "AudioParty",
                MessageBoxButton.OK, MessageBoxImage.Error);
            HostButton.IsEnabled = true;
        }
    }

    private async void OnListenerJoined(string listenerId, int participantCount)
    {
        await Dispatcher.InvokeAsync(() => ParticipantText.Text = $"👥 {participantCount}/10");
        await _webRtcHost.CreatePeerConnectionForListenerAsync(listenerId);
    }

    private void OnListenerLeft(string listenerId, int participantCount)
    {
        Dispatcher.Invoke(() => ParticipantText.Text = $"👥 {participantCount}/10");
        _webRtcHost.RemovePeerConnection(listenerId);
    }

    private void OnParticipantCountUpdated(int participantCount)
    {
        Dispatcher.Invoke(() => ParticipantText.Text = ListenerParticipantText.Text = $"👥 {participantCount}/10");
    }

    private void OnHostDisconnected(string? reason)
    {
        Dispatcher.Invoke(() =>
        {
            if (_isListening)
            {
                StopListening();
                MessageBox.Show(reason ?? "The host ended the party.", "AudioParty",
                    MessageBoxButton.OK, MessageBoxImage.Information);
                ShowHomePanel();
                return;
            }

            if (!_isHosting) return;

            StopHosting();
            MessageBox.Show(reason ?? "Your session was ended by an administrator.", "AudioParty",
                MessageBoxButton.OK, MessageBoxImage.Information);
            ShowHomePanel();
        });
    }

    private void CopyCodeButton_Click(object sender, RoutedEventArgs e)
    {
        if (_currentRoomCode is null) return;
        Clipboard.SetText(_currentRoomCode);
        FlashButtonText(CopyCodeButton, "Copy Code", "✓ Copied!");
    }

    private void CopyLinkButton_Click(object sender, RoutedEventArgs e)
    {
        if (_currentRoomCode is null) return;
        Clipboard.SetText($"{ServerUrl}/{_currentRoomCode}");
        FlashButtonText(CopyLinkButton, "Copy Link", "✓ Copied!");
    }

    private async void DiscordButton_Click(object sender, RoutedEventArgs e)
    {
        if (_discordSharingEnabled || _currentRoomCode is null) return;

        _discordSharingEnabled = true;
        DiscordButton.Content = "✅ Sharing on Discord";
        DiscordButton.IsEnabled = false;

        await _signaling.EnableDiscordSharingAsync(_currentRoomCode);
    }

    private async void EndPartyButton_Click(object sender, RoutedEventArgs e)
    {
        _isIntentionalDisconnect = true;
        StopHosting();
        ShowHomePanel();

        // Disconnecting tells the server (server/index.js 'disconnect' handler) that
        // the host left, so it deletes the room immediately instead of leaving it
        // to linger until the session timeout. Reconnect right after so the app is
        // ready to host another party without a restart.
        SetStatus("⏳ Reconnecting...");
        HostButton.IsEnabled = false;
        await _signaling.DisconnectAsync();
        await _signaling.ConnectAsync();
    }

    private void StopHosting()
    {
        _isHosting = false;
        _songDetection.Stop();
        _audioCapture.Stop();
        _webRtcHost.CloseAll();
        _currentRoomCode = null;
        _discordSharingEnabled = false;
        DiscordButton.Content = "📢 Share on Discord";
        DiscordButton.IsEnabled = true;
    }

    // ---- Joining a party (listener mode) -----------------------------------------------------

    private void JoinCodeBox_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter && JoinButton.IsEnabled) JoinButton_Click(sender, e);
    }

    /// <summary>Accepts a bare room code or a pasted party link (".../ABC123").</summary>
    private static string ParseRoomCode(string input)
    {
        var text = input.Trim().TrimEnd('/');
        int slash = text.LastIndexOf('/');
        if (slash >= 0) text = text[(slash + 1)..];
        return text.Trim().ToUpperInvariant();
    }

    private async void JoinButton_Click(object sender, RoutedEventArgs e)
    {
        var code = ParseRoomCode(JoinCodeBox.Text);
        if (code.Length == 0)
        {
            MessageBox.Show("Enter the room code of the party you want to join.", "AudioParty",
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        try
        {
            JoinButton.IsEnabled = false;
            HostButton.IsEnabled = false;

            await _webRtcListener.LoadIceServersAsync(ServerUrl);
            var result = await _signaling.JoinRoomAsync(code);

            if (!result.Success)
            {
                MessageBox.Show(result.Error ?? "Failed to join the party.", "AudioParty",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                JoinButton.IsEnabled = true;
                HostButton.IsEnabled = true;
                return;
            }

            _isListening = true;
            _listenerRejoining = false;
            _listenerConnected = false;
            _listenerRoomCode = result.RoomId ?? code;

            ListenerRoomCodeText.Text = _listenerRoomCode;
            ListenerParticipantText.Text = $"👥 {result.ParticipantCount}/10";
            ListenerSongPanel.Reset();
            VolumeSlider.Value = 50; // every party starts at a comfortable 50%
            _webRtcListener.Volume = (float)(VolumeSlider.Value / 100.0);
            SetListenerStatus("🟡 Connecting...", "#FB923C");
            ShowListeningPanel();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Failed to join the party: {ex.Message}", "AudioParty",
                MessageBoxButton.OK, MessageBoxImage.Error);
            JoinButton.IsEnabled = true;
            HostButton.IsEnabled = true;
        }
    }

    private async Task RejoinAsync()
    {
        var code = _listenerRoomCode;
        if (code is null) return;

        try
        {
            var result = await _signaling.JoinRoomAsync(code);
            await Dispatcher.InvokeAsync(() =>
            {
                if (!_isListening) return;

                if (result.Success)
                {
                    _listenerRejoining = false;
                    _listenerConnected = false;
                    SetListenerStatus("🟡 Connecting...", "#FB923C");
                    ListenerParticipantText.Text = $"👥 {result.ParticipantCount}/10";
                }
                else
                {
                    StopListening();
                    MessageBox.Show(result.Error ?? "The party is no longer available.", "AudioParty",
                        MessageBoxButton.OK, MessageBoxImage.Information);
                    ShowHomePanel();
                }
            });
        }
        catch (Exception ex)
        {
            DebugLog.Write($"Rejoin failed: {ex.Message}");
        }
    }

    private void OnListenerConnectionStateChanged(ListenerConnectionState state)
    {
        if (!_isListening) return;

        switch (state)
        {
            case ListenerConnectionState.Connected:
                _listenerConnected = true;
                SetListenerStatus("🟢 Connected", "#4ADE80");
                break;
            case ListenerConnectionState.Lost:
                _listenerConnected = false;
                SetListenerStatus("🔴 Connection lost", "#F87171");
                break;
            default:
                _listenerConnected = false;
                SetListenerStatus("🟡 Connecting...", "#FB923C");
                break;
        }
    }

    private void SetListenerStatus(string text, string colorHex)
    {
        ListenerStatusText.Text = text;
        ListenerStatusText.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(colorHex));
    }

    private void OnSongUpdated(JsonElement song)
    {
        string Str(string name) => song.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

        Dispatcher.Invoke(() =>
        {
            if (!_isListening) return; // the host's own panel is driven by its local detection

            var album = Str("album");
            ListenerSongPanel.Show(new SongState(SongStatus.Success, Str("title"), Str("artist"), album.Length > 0 ? album : null));
        });
    }

    private void VolumeSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (VolumeText is null || _webRtcListener is null) return; // fires during InitializeComponent
        VolumeText.Text = $"{(int)e.NewValue}%";
        _webRtcListener.Volume = (float)(e.NewValue / 100.0);
    }

    private async void LeaveButton_Click(object sender, RoutedEventArgs e)
    {
        _isIntentionalDisconnect = true;
        StopListening();
        ShowHomePanel();

        // The server removes a listener when its socket closes (there is no explicit leave event),
        // so reconnect afterwards to be ready to host or join another party.
        SetStatus("⏳ Reconnecting...");
        HostButton.IsEnabled = false;
        JoinButton.IsEnabled = false;
        await _signaling.DisconnectAsync();
        await _signaling.ConnectAsync();
    }

    private void StopListening()
    {
        _isListening = false;
        _listenerRejoining = false;
        _listenerConnected = false;
        _listenerRoomCode = null;
        _webRtcListener.Stop();
    }

    private void ShowHomePanel()
    {
        HomePanel.Visibility = Visibility.Visible;
        HostingPanel.Visibility = Visibility.Collapsed;
        ListeningPanel.Visibility = Visibility.Collapsed;
        StatusPill.Visibility = Visibility.Visible;
        HostButton.IsEnabled = true;
        JoinButton.IsEnabled = true;
        RefreshSources();
    }

    private void ShowHostingPanel()
    {
        HomePanel.Visibility = Visibility.Collapsed;
        HostingPanel.Visibility = Visibility.Visible;
        ListeningPanel.Visibility = Visibility.Collapsed;
        StatusPill.Visibility = Visibility.Collapsed; // relay status moves into the room-code bar
    }

    private void ShowListeningPanel()
    {
        HomePanel.Visibility = Visibility.Collapsed;
        HostingPanel.Visibility = Visibility.Collapsed;
        ListeningPanel.Visibility = Visibility.Visible;
        StatusPill.Visibility = Visibility.Collapsed;
    }

    private static void FlashButtonText(System.Windows.Controls.Button button, string original, string flash)
    {
        button.Content = flash;
        var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        timer.Tick += (s, e) =>
        {
            button.Content = original;
            timer.Stop();
        };
        timer.Start();
    }
}
