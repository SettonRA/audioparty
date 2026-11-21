using System;
using System.IO;

namespace AudioPartyDesktop.Services;

/// <summary>
/// Minimal file-based logger. WPF (WinExe) apps don't reliably surface Console.WriteLine
/// output, so diagnostics go to %LocalAppData%\AudioParty\audioparty-debug.log. That location
/// is writable whether the app is installed, run from a USB stick or from a read-only folder.
/// The previous log is kept as audioparty-debug.old.log so the file can't grow without bound.
/// </summary>
public static class DebugLog
{
    private const long MaxBytes = 2 * 1024 * 1024;

    private static readonly object Lock = new();
    private static readonly string LogPath = ResolvePath();

    public static string Path => LogPath;

    private static string ResolvePath()
    {
        try
        {
            var dir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AudioParty");
            Directory.CreateDirectory(dir);
            var path = System.IO.Path.Combine(dir, "audioparty-debug.log");

            if (File.Exists(path) && new FileInfo(path).Length > MaxBytes)
            {
                File.Move(path, System.IO.Path.Combine(dir, "audioparty-debug.old.log"), overwrite: true);
            }
            return path;
        }
        catch
        {
            return System.IO.Path.Combine(System.IO.Path.GetTempPath(), "audioparty-debug.log");
        }
    }

    public static void Write(string message)
    {
        try
        {
            lock (Lock)
            {
                File.AppendAllText(LogPath, $"[{DateTime.Now:HH:mm:ss.fff}] {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // Logging must never crash the app.
        }
    }
}
