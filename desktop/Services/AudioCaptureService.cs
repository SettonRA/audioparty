using System;
using System.Collections.Generic;
using NAudio.Wave;

namespace AudioPartyDesktop.Services;

/// <summary>
/// Captures the audio of a single application (Windows Process Loopback API, see
/// <see cref="ProcessLoopbackCapture"/>) and delivers it as 20 ms frames of interleaved
/// 16-bit stereo PCM at 48 kHz, the format the Opus encoder and the song detector expect.
/// Per-app capture is the reason for moving off Electron, since Chromium has no equivalent API.
/// </summary>
public class AudioCaptureService : IDisposable
{
    private const int SampleRate = 48000;
    private const int Channels = 2;
    private const int FrameMilliseconds = 20;
    private const int SamplesPerFrame = SampleRate * FrameMilliseconds / 1000 * Channels; // interleaved
    private const int BytesPerFrame = SamplesPerFrame * sizeof(short);

    private readonly object _lock = new();
    private byte[] _pending = new byte[BytesPerFrame * 8];
    private int _pendingBytes;

    private ProcessLoopbackCapture? _capture;

    /// <summary>Raised for every complete 20 ms frame of interleaved 16-bit PCM samples.</summary>
    public event Action<short[]>? FrameCaptured;

    public void Start(AudioSource source)
    {
        if (_capture != null) return;

        DebugLog.Write($"Starting capture: '{source.DisplayName}' (PID {source.ProcessId})");

        lock (_lock) _pendingBytes = 0;

        var capture = new ProcessLoopbackCapture(source.ProcessId);
        capture.DataAvailable += OnDataAvailable;
        _capture = capture;

        try
        {
            capture.StartRecording();
        }
        catch
        {
            Stop();
            throw;
        }
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        List<short[]>? frames = null;

        lock (_lock)
        {
            if (_pendingBytes + e.BytesRecorded > _pending.Length)
            {
                Array.Resize(ref _pending, Math.Max(_pending.Length * 2, _pendingBytes + e.BytesRecorded));
            }

            Buffer.BlockCopy(e.Buffer, 0, _pending, _pendingBytes, e.BytesRecorded);
            _pendingBytes += e.BytesRecorded;

            int offset = 0;
            while (_pendingBytes - offset >= BytesPerFrame)
            {
                var frame = new short[SamplesPerFrame];
                Buffer.BlockCopy(_pending, offset, frame, 0, BytesPerFrame);
                (frames ??= new List<short[]>()).Add(frame);
                offset += BytesPerFrame;
            }

            if (offset > 0)
            {
                _pendingBytes -= offset;
                Buffer.BlockCopy(_pending, offset, _pending, 0, _pendingBytes);
            }
        }

        if (frames is null) return;
        foreach (var frame in frames) FrameCaptured?.Invoke(frame);
    }

    public void Stop()
    {
        var capture = _capture;
        _capture = null;

        if (capture != null)
        {
            capture.DataAvailable -= OnDataAvailable;
            try { capture.StopRecording(); } catch { /* already stopped */ }
            capture.Dispose();
        }

        lock (_lock) _pendingBytes = 0;
    }

    public void Dispose() => Stop();
}
