using System;
using System.Collections.Generic;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Concentus;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;

namespace AudioPartyDesktop.Services;

public enum ListenerConnectionState { Connecting, Connected, Lost }

/// <summary>
/// Listener side of a party: answers the host's WebRTC offer, receives the Opus RTP stream,
/// decodes it with Concentus and plays it on the default output device through NAudio.
/// Counterpart of <see cref="WebRtcHostService"/> and of client/js/listener.js.
/// </summary>
public sealed class WebRtcListenerService : IDisposable
{
    private const int SampleRate = 48000;
    private const int Channels = 2;
    private const int MaxFrameSamples = 5760; // 120 ms, the largest Opus frame

    private readonly SignalingClient _signaling;
    private readonly object _lock = new();
    private readonly List<string> _pendingCandidates = new();

    private List<RTCIceServer> _iceServers = new() { new RTCIceServer { urls = "stun:stun.l.google.com:19302" } };
    private RTCPeerConnection? _pc;
    private string? _hostId;
    private bool _remoteDescriptionSet;

    private IOpusDecoder? _decoder;
    private readonly short[] _pcm = new short[MaxFrameSamples * Channels];
    private BufferedWaveProvider? _buffer;
    private VolumeSampleProvider? _volume;
    private WaveOut? _output;
    private float _volumeLevel = 1f;
    private ushort _lastSequence;
    private bool _haveSequence;
    private int _lastFrameSamples = 960;
    private long _packetsReceived;

    public event Action<ListenerConnectionState>? ConnectionStateChanged;

    public WebRtcListenerService(SignalingClient signaling)
    {
        _signaling = signaling;
        _signaling.OfferReceived += OnOfferReceived;
        _signaling.IceCandidateReceived += OnIceCandidateReceived;
        _signaling.HostResumed += OnHostResumed;
    }

    public async Task LoadIceServersAsync(string serverUrl) => _iceServers = await IceServerProvider.LoadAsync(serverUrl);

    /// <summary>Playback volume, 0.0 – 1.0.</summary>
    public float Volume
    {
        get => _volumeLevel;
        set
        {
            _volumeLevel = Math.Clamp(value, 0f, 1f);
            if (_volume != null) _volume.Volume = _volumeLevel;
        }
    }

    private void OnHostResumed(string newHostId) => _hostId = newHostId;

    private async void OnOfferReceived(string senderId, string offerJson)
    {
        try
        {
            DebugLog.Write($"[listener] offer received from {senderId}");
            ConnectionStateChanged?.Invoke(ListenerConnectionState.Connecting);

            // A new offer always means a fresh negotiation (first join, or the host rebuilt its side).
            CloseConnection();
            _hostId = senderId;

            var pc = new RTCPeerConnection(new RTCConfiguration { iceServers = _iceServers });
            var format = new AudioFormat(AudioCodecsEnum.OPUS, 111, SampleRate, Channels, "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1");
            pc.addTrack(new MediaStreamTrack(format, MediaStreamStatusEnum.RecvOnly));

            pc.OnRtpPacketReceived += OnRtpPacketReceived;
            pc.onicecandidate += candidate =>
            {
                if (candidate is not null && _hostId is not null)
                {
                    _ = _signaling.SendIceCandidateAsync(_hostId, candidate.toJSON());
                }
            };
            pc.oniceconnectionstatechange += state => DebugLog.Write($"[listener] ICE connection state: {state}");
            pc.onconnectionstatechange += state =>
            {
                DebugLog.Write($"[listener] connection state: {state}");
                switch (state)
                {
                    case RTCPeerConnectionState.connected:
                        ConnectionStateChanged?.Invoke(ListenerConnectionState.Connected);
                        break;
                    case RTCPeerConnectionState.failed:
                    case RTCPeerConnectionState.disconnected:
                        ConnectionStateChanged?.Invoke(ListenerConnectionState.Lost);
                        break;
                }
            };

            StartPlayback();
            lock (_lock) _pc = pc;

            if (!RTCSessionDescriptionInit.TryParse(offerJson, out var offer))
                throw new InvalidOperationException("Could not parse the host's offer");

            var result = pc.setRemoteDescription(offer);
            if (result != SetDescriptionResultEnum.OK)
                throw new InvalidOperationException($"Host offer rejected: {result}");

            // Candidates can arrive while the offer is being processed; apply the ones queued so far.
            List<string> queued;
            lock (_lock)
            {
                _remoteDescriptionSet = true;
                queued = new List<string>(_pendingCandidates);
                _pendingCandidates.Clear();
            }
            foreach (var json in queued) AddCandidate(pc, json);

            var answer = pc.createAnswer(null);
            await pc.setLocalDescription(answer);
            await _signaling.SendAnswerAsync(senderId, answer.toJSON());
            DebugLog.Write("[listener] answer sent");
        }
        catch (Exception ex)
        {
            DebugLog.Write($"[listener] failed to handle offer: {ex}");
            ConnectionStateChanged?.Invoke(ListenerConnectionState.Lost);
        }
    }

    private void OnIceCandidateReceived(string senderId, string candidateJson)
    {
        RTCPeerConnection? pc;
        lock (_lock)
        {
            pc = _pc;
            if (pc is null || !_remoteDescriptionSet)
            {
                _pendingCandidates.Add(candidateJson);
                return;
            }
        }
        AddCandidate(pc, candidateJson);
    }

    private static void AddCandidate(RTCPeerConnection pc, string candidateJson)
    {
        if (RTCIceCandidateInit.TryParse(candidateJson, out var init))
        {
            DebugLog.Write($"[listener] remote ICE candidate: {init.candidate}");
            pc.addIceCandidate(init);
        }
    }

    private void OnRtpPacketReceived(IPEndPoint remote, SDPMediaTypesEnum media, RTPPacket packet)
    {
        if (media != SDPMediaTypesEnum.audio || _decoder is null || _buffer is null) return;

        try
        {
            ushort sequence = packet.Header.SequenceNumber;
            if (_haveSequence)
            {
                short gap = (short)(sequence - _lastSequence);
                if (gap <= 0) return; // duplicate or late packet

                // Conceal a short run of lost packets instead of leaving a hole in the audio.
                for (int i = 1; i < gap && i <= 3; i++)
                {
                    int concealed = _decoder.Decode(ReadOnlySpan<byte>.Empty, _pcm, _lastFrameSamples, false);
                    WriteToBuffer(concealed);
                }
            }
            _lastSequence = sequence;
            _haveSequence = true;

            var payload = packet.Payload;
            if (payload is null || payload.Length == 0) return;

            int samples = _decoder.Decode(payload, _pcm, MaxFrameSamples, false);
            if (samples > 0) _lastFrameSamples = samples;
            WriteToBuffer(samples);

            if (++_packetsReceived == 1) DebugLog.Write($"[listener] first RTP packet: {payload.Length} bytes -> {samples} samples/channel");
        }
        catch (Exception ex)
        {
            DebugLog.Write($"[listener] decode failed: {ex.Message}");
        }
    }

    private void WriteToBuffer(int samplesPerChannel)
    {
        if (samplesPerChannel <= 0) return;
        var bytes = MemoryMarshal.AsBytes(_pcm.AsSpan(0, samplesPerChannel * Channels));
        _buffer!.AddSamples(bytes.ToArray(), 0, bytes.Length);
    }

    private void StartPlayback()
    {
        StopPlayback();

        _decoder = OpusCodecFactory.CreateDecoder(SampleRate, Channels);
        _buffer = new BufferedWaveProvider(new WaveFormat(SampleRate, 16, Channels), TimeSpan.FromMilliseconds(500))
        {
            DiscardOnBufferOverflow = true,
            ReadFully = true // play silence rather than stall while waiting for packets
        };
        _volume = new VolumeSampleProvider(_buffer.ToSampleProvider()) { Volume = _volumeLevel };

        _output = new WaveOut { BufferMilliseconds = 60, NumberOfBuffers = 2 }; // ~120 ms total latency
        _output.Init(_volume.ToWaveProvider16());
        _output.Play();

        _haveSequence = false;
        _packetsReceived = 0;
    }

    private void StopPlayback()
    {
        _output?.Stop();
        _output?.Dispose();
        _output = null;
        _volume = null;
        _buffer = null;
        _decoder = null;
    }

    private void CloseConnection()
    {
        RTCPeerConnection? pc;
        lock (_lock)
        {
            pc = _pc;
            _pc = null;
            _remoteDescriptionSet = false;
            _pendingCandidates.Clear();
        }

        if (pc != null)
        {
            pc.OnRtpPacketReceived -= OnRtpPacketReceived;
            pc.close();
        }
    }

    /// <summary>Tears down the connection and stops playback (leaving the party).</summary>
    public void Stop()
    {
        CloseConnection();
        StopPlayback();
        _hostId = null;
    }

    public void Dispose()
    {
        _signaling.OfferReceived -= OnOfferReceived;
        _signaling.IceCandidateReceived -= OnIceCandidateReceived;
        _signaling.HostResumed -= OnHostResumed;
        Stop();
    }
}
