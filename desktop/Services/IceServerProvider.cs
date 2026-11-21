using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using SIPSorcery.Net;

namespace AudioPartyDesktop.Services;

/// <summary>
/// Loads STUN/TURN servers from the AudioParty server (same endpoint the web client uses).
/// Without TURN, peers that can't reach each other directly fail to connect.
/// </summary>
public static class IceServerProvider
{
    private static List<RTCIceServer> Fallback() => new() { new RTCIceServer { urls = "stun:stun.l.google.com:19302" } };

    public static async Task<List<RTCIceServer>> LoadAsync(string serverUrl)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            var json = await http.GetStringAsync($"{serverUrl.TrimEnd('/')}/api/ice-servers");
            using var doc = JsonDocument.Parse(json);

            var servers = new List<RTCIceServer>();
            foreach (var entry in doc.RootElement.GetProperty("iceServers").EnumerateArray())
            {
                var server = new RTCIceServer { urls = entry.GetProperty("urls").GetString() };
                if (entry.TryGetProperty("username", out var user) && entry.TryGetProperty("credential", out var cred))
                {
                    server.username = user.GetString();
                    server.credential = cred.GetString();
                    server.credentialType = RTCIceCredentialType.password;
                }
                servers.Add(server);
            }

            if (servers.Count == 0) return Fallback();
            DebugLog.Write($"Loaded {servers.Count} ICE servers ({servers.Count(s => s.urls.StartsWith("turn"))} TURN)");
            return servers;
        }
        catch (Exception ex)
        {
            DebugLog.Write($"Failed to load ICE servers, using STUN only: {ex.Message}");
            return Fallback();
        }
    }
}
