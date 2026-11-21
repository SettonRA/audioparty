using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace AudioPartyDesktop.Services;

/// <summary>An application that can be shared (the process tree rooted at <see cref="ProcessId"/>).</summary>
public sealed record AudioSource(string DisplayName, int ProcessId)
{
    public override string ToString() => DisplayName;
}

/// <summary>Enumerates the apps that are producing audio right now, so the user can pick one to share.</summary>
public static class AudioSourceCatalog
{
    public static List<AudioSource> Enumerate()
    {
        using var enumerator = new MMDeviceEnumerator();
        var devices = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active).ToList();

        // One entry per top-level process with an *active* audio session on any output device.
        var apps = new Dictionary<int, AudioSource>();
        var selfPid = Environment.ProcessId;

        foreach (var device in devices)
        {
            try
            {
                var sessions = device.AudioSessionManager.Sessions;
                for (int i = 0; i < sessions.Count; i++)
                {
                    var session = sessions[i];
                    if (session.IsSystemSoundsSession) continue;
                    if (session.State != AudioSessionState.AudioSessionStateActive) continue;

                    int pid = (int)session.GetProcessID;
                    if (pid <= 0 || pid == selfPid) continue;

                    int rootPid = ResolveRootProcess(pid);
                    if (apps.ContainsKey(rootPid)) continue;

                    apps[rootPid] = new AudioSource(DescribeProcess(rootPid), rootPid);
                }
            }
            catch (Exception ex)
            {
                DebugLog.Write($"Session enumeration failed for '{device.FriendlyName}': {ex.Message}");
            }
        }

        // Two separate instances of the same app would look identical; tell them apart by PID.
        var duplicateNames = apps.Values.GroupBy(a => a.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);

        return apps.Values
            .Select(a => duplicateNames.Contains(a.DisplayName) ? a with { DisplayName = $"{a.DisplayName} (PID {a.ProcessId})" } : a)
            .OrderBy(a => a.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string DescribeProcess(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return p.ProcessName;
        }
        catch
        {
            return $"Process {pid}";
        }
    }

    /// <summary>
    /// Browsers and Electron apps play audio from a child process (e.g. Chrome's audio
    /// service). Walk up while the parent runs the same executable so we capture the
    /// whole app via the process-tree mode instead of just the helper.
    /// </summary>
    private static int ResolveRootProcess(int pid)
    {
        try
        {
            var parents = SnapshotParents();
            string? name = ProcessName(pid);
            int current = pid;
            for (int depth = 0; depth < 8; depth++)
            {
                if (!parents.TryGetValue(current, out int parent) || parent <= 0) break;
                if (!string.Equals(ProcessName(parent), name, StringComparison.OrdinalIgnoreCase)) break;
                current = parent;
            }
            return current;
        }
        catch
        {
            return pid;
        }
    }

    private static string? ProcessName(int pid)
    {
        try { using var p = Process.GetProcessById(pid); return p.ProcessName; }
        catch { return null; }
    }

    private static Dictionary<int, int> SnapshotParents()
    {
        var map = new Dictionary<int, int>();
        var snapshot = CreateToolhelp32Snapshot(0x2 /* TH32CS_SNAPPROCESS */, 0);
        if (snapshot == IntPtr.Zero || snapshot == new IntPtr(-1)) return map;

        try
        {
            var entry = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32>() };
            if (!Process32First(snapshot, ref entry)) return map;
            do
            {
                map[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
            } while (Process32Next(snapshot, ref entry));
        }
        finally
        {
            CloseHandle(snapshot);
        }
        return map;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public UIntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32First(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32Next(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
}
