using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Concentus;
using Concentus.Enums;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;

namespace AudioPartyDesktop.Services;

/// <summary>
/// Manages one RTCPeerConnection per listener and feeds them Opus-encoded audio
/// frames captured from <see cref="AudioCaptureService"/>. Signaling (offer/answer/
/// ICE) flows through <see cref="SignalingClient"/> using the same events the web
/// client and Node server already use.
/// </summary>
public class WebRtcHostService : IDisposable
{
    private readonly SignalingClient _signaling;
    private readonly IOpusEncoder _opusEncoder;
    private readonly byte[] _encodeBuffer = new byte[4000];
    private readonly AudioFormat _opusFormat;
    private readonly Dictionary<string, RTCPeerConnection> _peerConnections = new();
    private readonly int _samplesPerChannelPerFrame;

    public WebRtcHostService(SignalingClient signaling, int sampleRate = 48000)
    {
        _signaling = signaling;
        // SIPSorcery's built-in AudioEncoder downmixes to mono, so encode stereo with
        // Concentus directly and advertise stereo in the SDP so browsers decode it as such.
        _opusEncoder = OpusCodecFactory.CreateEncoder(sampleRate, 2, OpusApplication.OPUS_APPLICATION_AUDIO);
        _opusEncoder.Bitrate = 128_000;
        _opusEncoder.Complexity = 8;
        _opusFormat = new AudioFormat(AudioCodecsEnum.OPUS, 111, 48000, 2, "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1");
        _samplesPerChannelPerFrame = sampleRate / 1000 * 20; // 20ms frames

        DebugLog.Write($"Opus format selected: FormatID={_opusFormat.FormatID}, ClockRate={_opusFormat.ClockRate}, " +
                       $"RtpClockRate={_opusFormat.RtpClockRate}, Channels={_opusFormat.ChannelCount}, " +
                       $"Params={_opusFormat.Parameters}, samplesPerChannelPerFrame={_samplesPerChannelPerFrame}");

        _signaling.AnswerReceived += OnAnswerReceived;
        _signaling.IceCandidateReceived += OnIceCandidateReceived;
    }

    private List<RTCIceServer> _iceServers = new() { new RTCIceServer { urls = "stun:stun.l.google.com:19302" } };

    /// <summary>Loads STUN/TURN servers from the AudioParty server before listeners connect.</summary>
    public async Task LoadIceServersAsync(string serverUrl) => _iceServers = await IceServerProvider.LoadAsync(serverUrl);

    private int _encodedFramesLogged;

    /// <summary>Called by AudioCaptureService.FrameCaptured for every 20ms PCM frame.</summary>
    public void SendAudioFrame(short[] interleavedPcm)
    {
        if (_peerConnections.Count == 0) return;

        int encodedLength = _opusEncoder.Encode(interleavedPcm, _samplesPerChannelPerFrame, _encodeBuffer, _encodeBuffer.Length);
        var encoded = new byte[encodedLength];
        Buffer.BlockCopy(_encodeBuffer, 0, encoded, 0, encodedLength);

        if (_encodedFramesLogged < 10)
        {
            DebugLog.Write($"EncodeAudio: input samples={interleavedPcm.Length}, encoded bytes={encoded.Length}, peers={_peerConnections.Count}");
            _encodedFramesLogged++;
        }

        foreach (var pc in _peerConnections.Values)
        {
            if (pc.connectionState == RTCPeerConnectionState.connected)
            {
                pc.SendAudio((uint)_samplesPerChannelPerFrame, encoded);
            }
        }
    }

    public async Task CreatePeerConnectionForListenerAsync(string listenerId)
    {
        var config = new RTCConfiguration
        {
            iceServers = _iceServers
        };

        var pc = new RTCPeerConnection(config);
        _peerConnections[listenerId] = pc;

        var audioTrack = new MediaStreamTrack(_opusFormat, MediaStreamStatusEnum.SendOnly);
        pc.addTrack(audioTrack);

        pc.onicecandidate += candidate =>
        {
            if (candidate is not null)
            {
                DebugLog.Write($"[{listenerId}] local ICE candidate: {candidate.candidate}");
                _ = _signaling.SendIceCandidateAsync(listenerId, candidate.toJSON());
            }
        };

        pc.oniceconnectionstatechange += state => DebugLog.Write($"[{listenerId}] ICE connection state: {state}");
        pc.onicegatheringstatechange += state => DebugLog.Write($"[{listenerId}] ICE gathering state: {state}");

        pc.onconnectionstatechange += state =>
        {
            DebugLog.Write($"[{listenerId}] connection state: {state}");
            if (state is RTCPeerConnectionState.closed or RTCPeerConnectionState.failed or RTCPeerConnectionState.disconnected)
            {
                RemovePeerConnection(listenerId);
            }
        };

        var offer = pc.createOffer(new RTCOfferOptions());
        await pc.setLocalDescription(offer);
        DebugLog.Write($"[{listenerId}] offer SDP:{Environment.NewLine}{offer.sdp}");

        await _signaling.SendOfferAsync(listenerId, offer.toJSON());
    }

    private void OnAnswerReceived(string senderId, string answerJson)
    {
        if (!_peerConnections.TryGetValue(senderId, out var pc)) return;

        if (RTCSessionDescriptionInit.TryParse(answerJson, out var answerInit))
        {
            var result = pc.setRemoteDescription(answerInit);
            DebugLog.Write($"[{senderId}] answer applied: {result}{Environment.NewLine}{answerInit.sdp}");
        }
        else
        {
            DebugLog.Write($"[{senderId}] could not parse answer: {answerJson}");
        }
    }

    private void OnIceCandidateReceived(string senderId, string candidateJson)
    {
        if (!_peerConnections.TryGetValue(senderId, out var pc)) return;

        if (RTCIceCandidateInit.TryParse(candidateJson, out var candidateInit))
        {
            DebugLog.Write($"[{senderId}] remote ICE candidate: {candidateInit.candidate}");
            pc.addIceCandidate(candidateInit);
        }
        else
        {
            DebugLog.Write($"[{senderId}] could not parse remote candidate: {candidateJson}");
        }
    }

    public void RemovePeerConnection(string listenerId)
    {
        if (_peerConnections.TryGetValue(listenerId, out var pc))
        {
            pc.close();
            _peerConnections.Remove(listenerId);
        }
    }

    public void CloseAll()
    {
        foreach (var pc in _peerConnections.Values)
        {
            pc.close();
        }
        _peerConnections.Clear();
    }

    public void Dispose()
    {
        _signaling.AnswerReceived -= OnAnswerReceived;
        _signaling.IceCandidateReceived -= OnIceCandidateReceived;
        CloseAll();
    }
}
