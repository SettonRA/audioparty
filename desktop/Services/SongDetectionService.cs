using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace AudioPartyDesktop.Services;

public enum SongStatus { Listening, Detecting, Success, NotFound, Error }

public sealed record SongState(SongStatus Status, string? Title = null, string? Artist = null, string? Album = null, string? Message = null);

/// <summary>
/// Desktop equivalent of client/js/song-detection.js. Taps the same 20 ms PCM frames that
/// are sent to listeners, records a 10 s sample when needed, and has the AudioParty server
/// (ACRCloud) identify it. Triggers match the browser: shortly after start, after a
/// silence gap between songs, and a 60 s fallback.
/// </summary>
public sealed class SongDetectionService : IDisposable
{
    private const double SilenceThreshold = 0.01;
    private static readonly TimeSpan MinSilence = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan MinDetectionInterval = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan FallbackCheckEvery = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan FallbackMinAge = TimeSpan.FromSeconds(45);
    private const int CaptureSeconds = 10;
    private const int SampleRate = 16000; // mono 16 kHz is plenty for fingerprinting and keeps the upload small

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };

    private readonly string _serverUrl;
    private readonly object _lock = new();
    private readonly List<short> _sample = new();

    private Timer? _fallbackTimer;
    private bool _active;
    private bool _capturing;
    private bool _sending;
    private bool _wasSilent;
    private DateTime _silenceStart;
    private DateTime _lastDetection = DateTime.MinValue;
    private bool _hasSong;
    private int _generation; // invalidates timers/requests from a previous party

    /// <summary>UI state changes (detecting / song found / not found / error).</summary>
    public event Action<SongState>? StateChanged;

    /// <summary>Raised with the server's song object so the caller can broadcast it to the room.</summary>
    public event Action<JsonElement>? SongIdentified;

    public SongDetectionService(string serverUrl) => _serverUrl = serverUrl.TrimEnd('/');

    public void Start()
    {
        lock (_lock)
        {
            _generation++;
            _active = true;
            _capturing = false;
            _sending = false;
            _wasSilent = false;
            _hasSong = false;
            _lastDetection = DateTime.MinValue;
            _sample.Clear();

            _fallbackTimer?.Dispose();
            _fallbackTimer = new Timer(_ => FallbackTick(), null, FallbackCheckEvery, FallbackCheckEvery);
        }

        StateChanged?.Invoke(new SongState(SongStatus.Listening));
        ScheduleDetection(TimeSpan.FromSeconds(5)); // let the audio stabilize first
    }

    public void Stop()
    {
        lock (_lock)
        {
            _generation++;
            _active = false;
            _capturing = false;
            _sample.Clear();
            _fallbackTimer?.Dispose();
            _fallbackTimer = null;
        }
    }

    /// <summary>Feed every captured 20 ms frame (interleaved 16-bit stereo at 48 kHz).</summary>
    public void OnFrame(short[] frame)
    {
        if (!_active) return;

        double sumSquares = 0;
        for (int i = 0; i < frame.Length; i++)
        {
            double f = frame[i] / 32768.0;
            sumSquares += f * f;
        }
        bool silent = Math.Sqrt(sumSquares / frame.Length) < SilenceThreshold;
        var now = DateTime.UtcNow;
        bool scheduleAfterSilence = false;
        short[]? finished = null;

        lock (_lock)
        {
            if (!_active) return;

            if (silent && !_wasSilent)
            {
                _silenceStart = now;
                _wasSilent = true;
            }
            else if (!silent && _wasSilent)
            {
                _wasSilent = false;
                scheduleAfterSilence = now - _silenceStart >= MinSilence && now - _lastDetection >= MinDetectionInterval;
            }

            if (_capturing)
            {
                // Stereo 48 kHz -> mono 16 kHz: average each group of 3 stereo pairs.
                for (int i = 0; i + 5 < frame.Length; i += 6)
                {
                    int sum = frame[i] + frame[i + 1] + frame[i + 2] + frame[i + 3] + frame[i + 4] + frame[i + 5];
                    _sample.Add((short)(sum / 6));
                }

                if (_sample.Count >= CaptureSeconds * SampleRate)
                {
                    finished = _sample.ToArray();
                    _sample.Clear();
                    _capturing = false;
                    _sending = true;
                }
            }
        }

        if (scheduleAfterSilence) ScheduleDetection(TimeSpan.FromSeconds(3)); // let the next song start
        if (finished != null)
        {
            int generation = _generation;
            _ = Task.Run(() => IdentifyAsync(finished, generation));
        }
    }

    private void FallbackTick()
    {
        bool due;
        lock (_lock) due = _active && DateTime.UtcNow - _lastDetection > FallbackMinAge;
        if (due)
        {
            DebugLog.Write("Song detection: fallback trigger");
            BeginCapture();
        }
    }

    private void ScheduleDetection(TimeSpan delay)
    {
        int generation = _generation;
        _ = Task.Delay(delay).ContinueWith(_ =>
        {
            if (generation == _generation) BeginCapture();
        });
    }

    private void BeginCapture()
    {
        bool showDetecting;
        lock (_lock)
        {
            if (!_active || _capturing || _sending) return;
            _sample.Clear();
            _capturing = true;
            showDetecting = !_hasSong;
        }

        DebugLog.Write("Song detection: capturing sample");
        if (showDetecting) StateChanged?.Invoke(new SongState(SongStatus.Detecting));
    }

    private async Task IdentifyAsync(short[] samples, int generation)
    {
        try
        {
            if (Rms(samples) < SilenceThreshold)
            {
                DebugLog.Write("Song detection: sample was silent, skipping lookup");
                if (generation == _generation && !_hasSong) StateChanged?.Invoke(new SongState(SongStatus.Listening));
                return;
            }

            var payload = JsonSerializer.Serialize(new { audioData = Convert.ToBase64String(ToWav(samples)) });
            using var content = new StringContent(payload, Encoding.UTF8, "application/json");
            using var response = await Http.PostAsync($"{_serverUrl}/api/identify-song", content);
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var root = doc.RootElement;

            if (generation != _generation) return;

            if (root.TryGetProperty("success", out var ok) && ok.GetBoolean() && root.TryGetProperty("song", out var song))
            {
                string Str(string name) => song.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
                lock (_lock)
                {
                    _hasSong = true;
                    _lastDetection = DateTime.UtcNow;
                }

                DebugLog.Write($"Song detected: {Str("title")} - {Str("artist")}");
                var album = Str("album");
                StateChanged?.Invoke(new SongState(SongStatus.Success, Str("title"), Str("artist"), album.Length > 0 ? album : null));
                SongIdentified?.Invoke(song.Clone());
            }
            else
            {
                DebugLog.Write($"Song detection: no match ({root})");
                if (!_hasSong)
                {
                    var message = root.TryGetProperty("message", out var m) ? m.GetString() : null;
                    StateChanged?.Invoke(new SongState(SongStatus.NotFound, Message: message));
                }
            }
        }
        catch (Exception ex)
        {
            DebugLog.Write($"Song detection failed: {ex.Message}");
            if (generation == _generation && !_hasSong)
            {
                StateChanged?.Invoke(new SongState(SongStatus.Error, Message: "Detection failed"));
            }
        }
        finally
        {
            lock (_lock) _sending = false;
        }
    }

    private static double Rms(short[] samples)
    {
        double sum = 0;
        foreach (var s in samples)
        {
            double f = s / 32768.0;
            sum += f * f;
        }
        return Math.Sqrt(sum / Math.Max(1, samples.Length));
    }

    /// <summary>16-bit PCM mono WAV container around the samples.</summary>
    private static byte[] ToWav(short[] samples)
    {
        int dataBytes = samples.Length * 2;
        using var ms = new MemoryStream(44 + dataBytes);
        using var w = new BinaryWriter(ms);
        w.Write(Encoding.ASCII.GetBytes("RIFF"));
        w.Write(36 + dataBytes);
        w.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
        w.Write(16);
        w.Write((short)1);          // PCM
        w.Write((short)1);          // mono
        w.Write(SampleRate);
        w.Write(SampleRate * 2);    // byte rate
        w.Write((short)2);          // block align
        w.Write((short)16);         // bits per sample
        w.Write(Encoding.ASCII.GetBytes("data"));
        w.Write(dataBytes);
        foreach (var s in samples) w.Write(s);
        return ms.ToArray();
    }

    public void Dispose() => Stop();
}
