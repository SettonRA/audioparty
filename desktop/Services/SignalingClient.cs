using System;
using System.Text.Json;
using System.Threading.Tasks;
using SocketIOClient;

namespace AudioPartyDesktop.Services;

/// <summary>
/// Wraps the Socket.IO connection to the AudioParty signaling server.
/// Mirrors the same events used by the web client (client/js/host.js) and
/// the Node server (server/index.js) so no server changes are required.
/// </summary>
public class SignalingClient : IDisposable
{
    private readonly SocketIO _socket;
    private TaskCompletionSource<JoinRoomResult>? _pendingJoin;

    public string? CurrentRoomCode { get; private set; }

    public event Action? Connected;
    public event Action? Disconnected;
    public event Action<string, int>? ListenerJoined; // listenerId, participantCount
    public event Action<string, int>? ListenerLeft;    // listenerId, participantCount
    public event Action<int>? ParticipantCountUpdated;
    public event Action<string, string>? OfferReceived;        // sender, offer SDP JSON
    public event Action<string, string>? AnswerReceived;       // sender, answer SDP JSON
    public event Action<string, string>? IceCandidateReceived; // sender, candidate JSON
    public event Action<string?>? HostDisconnected; // reason
    public event Action<JsonElement>? SongUpdated;   // song object detected by the host
    public event Action? HostReconnecting;
    public event Action<string>? HostResumed;        // new host socket id

    public SignalingClient(string serverUrl)
    {
        var options = new SocketIOOptions
        {
            Reconnection = true
        };
        _socket = new SocketIO(new Uri(serverUrl), options, null);

        _socket.OnConnected += (_, _) => Connected?.Invoke();
        _socket.OnDisconnected += (_, _) => Disconnected?.Invoke();

        _socket.On("listener-joined", response =>
        {
            var data = Payload<ListenerJoinedPayload>(response);
            ListenerJoined?.Invoke(data.listenerId, data.participantCount);
            return Task.CompletedTask;
        });

        _socket.On("listener-left", response =>
        {
            var data = Payload<ListenerLeftPayload>(response);
            ListenerLeft?.Invoke(data.listenerId, data.participantCount);
            return Task.CompletedTask;
        });

        _socket.On("participant-count-updated", response =>
        {
            var data = Payload<ParticipantCountPayload>(response);
            ParticipantCountUpdated?.Invoke(data.participantCount);
            return Task.CompletedTask;
        });

        _socket.On("offer", response =>
        {
            var data = Payload<OfferPayload>(response);
            OfferReceived?.Invoke(data.sender, data.offer.GetRawText());
            return Task.CompletedTask;
        });

        _socket.On("answer", response =>
        {
            var data = Payload<AnswerPayload>(response);
            AnswerReceived?.Invoke(data.sender, data.answer.GetRawText());
            return Task.CompletedTask;
        });

        _socket.On("ice-candidate", response =>
        {
            var data = Payload<IceCandidatePayload>(response);
            IceCandidateReceived?.Invoke(data.sender, data.candidate.GetRawText());
            return Task.CompletedTask;
        });

        _socket.On("join-room-response", response =>
        {
            var data = Payload<JoinRoomPayload>(response);
            var result = new JoinRoomResult(data.success, data.error, data.roomId, data.hostId, data.participantCount);
            if (data.success) CurrentRoomCode = data.roomId;
            _pendingJoin?.TrySetResult(result);
            return Task.CompletedTask;
        });

        _socket.On("song-update", response =>
        {
            var data = Payload<SongUpdatePayload>(response);
            if (data.song.ValueKind == JsonValueKind.Object) SongUpdated?.Invoke(data.song.Clone());
            return Task.CompletedTask;
        });

        _socket.On("host-reconnecting", _ =>
        {
            HostReconnecting?.Invoke();
            return Task.CompletedTask;
        });

        _socket.On("host-resumed", response =>
        {
            var data = Payload<HostResumedPayload>(response);
            HostResumed?.Invoke(data.hostId);
            return Task.CompletedTask;
        });

        _socket.On("host-disconnected", response =>
        {
            string? reason = null;
            try
            {
                var data = Payload<HostDisconnectedPayload>(response);
                reason = data?.reason;
            }
            catch { /* payload may be empty */ }
            HostDisconnected?.Invoke(reason);
            return Task.CompletedTask;
        });
    }

    private static T Payload<T>(IEventContext response) where T : class =>
        response.GetValue<T>(0) ?? throw new InvalidOperationException($"Server sent an empty {typeof(T).Name} payload");

    private static T Payload<T>(SocketIOClient.Common.Messages.IDataMessage response) where T : class =>
        response.GetValue<T>(0) ?? throw new InvalidOperationException($"Server sent an empty {typeof(T).Name} payload");

    public Task ConnectAsync() => _socket.ConnectAsync();

    /// <summary>
    /// Disconnects from the server, which causes it to see this client's socket
    /// close and immediately clean up the room (mirrors what a full page reload
    /// does in the web client, and what the socket 'disconnect' handler in
    /// server/index.js relies on for host-initiated room teardown).
    /// </summary>
    public Task DisconnectAsync()
    {
        CurrentRoomCode = null;
        return _socket.DisconnectAsync();
    }

    public async Task<string> CreateRoomAsync()
    {
        var tcs = new TaskCompletionSource<string>();

        await _socket.EmitAsync("create-room", response =>
        {
            var data = Payload<CreateRoomResponse>(response);
            if (data.success)
            {
                CurrentRoomCode = data.roomId;
                tcs.SetResult(data.roomId);
            }
            else
            {
                tcs.SetException(new InvalidOperationException("Failed to create room"));
            }
            return Task.CompletedTask;
        });

        return await tcs.Task;
    }

    /// <summary>Joins an existing room as a listener. Resolves with the server's join-room-response.</summary>
    public async Task<JoinRoomResult> JoinRoomAsync(string roomCode)
    {
        var tcs = new TaskCompletionSource<JoinRoomResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingJoin = tcs;
        await _socket.EmitAsync("join-room", new object[] { roomCode });

        var finished = await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(10)));
        if (finished != tcs.Task) return new JoinRoomResult(false, "The server did not respond", null, null, 0);
        return await tcs.Task;
    }

    public Task SendAnswerAsync(string targetId, string answerJson) =>
        _socket.EmitAsync("answer", new object[] { new { target = targetId, answer = JsonSerializer.Deserialize<JsonElement>(answerJson) } });

    /// <summary>
    /// Sends a WebRTC offer to a listener. <paramref name="offerJson"/> must already be a
    /// JSON-serialized RTCSessionDescriptionInit-shaped object (type/sdp).
    /// </summary>
    public Task SendOfferAsync(string targetId, string offerJson) =>
        _socket.EmitAsync("offer", new object[] { new { target = targetId, offer = JsonSerializer.Deserialize<JsonElement>(offerJson) } });

    public Task SendIceCandidateAsync(string targetId, string candidateJson) =>
        _socket.EmitAsync("ice-candidate", new object[] { new { target = targetId, candidate = JsonSerializer.Deserialize<JsonElement>(candidateJson) } });

    public Task EnableDiscordSharingAsync(string roomId) =>
        _socket.EmitAsync("enable-discord-sharing", new object[] { new { roomId } });

    public Task SendSongDetectedAsync(string roomId, object song) =>
        _socket.EmitAsync("song-detected", new object[] { new { roomId, song } });

    public void Dispose()
    {
        _socket.Dispose();
    }

    private class JoinRoomPayload
    {
        public bool success { get; set; }
        public string? error { get; set; }
        public string? roomId { get; set; }
        public string? hostId { get; set; }
        public int participantCount { get; set; }
    }

    private class SongUpdatePayload
    {
        public JsonElement song { get; set; }
    }

    private class HostResumedPayload
    {
        public string hostId { get; set; } = string.Empty;
    }

    private class CreateRoomResponse
    {
        public bool success { get; set; }
        public string roomId { get; set; } = string.Empty;
    }

    private class ListenerJoinedPayload
    {
        public string listenerId { get; set; } = string.Empty;
        public int participantCount { get; set; }
    }

    private class ListenerLeftPayload
    {
        public string listenerId { get; set; } = string.Empty;
        public int participantCount { get; set; }
    }

    private class ParticipantCountPayload
    {
        public int participantCount { get; set; }
    }

    private class OfferPayload
    {
        public string sender { get; set; } = string.Empty;
        public JsonElement offer { get; set; }
    }

    private class AnswerPayload
    {
        public string sender { get; set; } = string.Empty;
        public JsonElement answer { get; set; }
    }

    private class IceCandidatePayload
    {
        public string sender { get; set; } = string.Empty;
        public JsonElement candidate { get; set; }
    }

    private class HostDisconnectedPayload
    {
        public string? reason { get; set; }
    }
}


public sealed record JoinRoomResult(bool Success, string? Error, string? RoomId, string? HostId, int ParticipantCount);
