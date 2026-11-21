using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using NAudio.Wave;

namespace AudioPartyDesktop.Services;

/// <summary>
/// Captures the audio of a single process (and its child processes) using the
/// Windows 10 2004+ "process loopback" API: ActivateAudioInterfaceAsync on the
/// virtual device VAD\Process_Loopback. NAudio has no wrapper for this, so the
/// minimal COM interop lives here. Exposes the NAudio <see cref="IWaveIn"/>
/// shape so it drops into the same pipeline as <see cref="WasapiLoopbackCapture"/>.
/// </summary>
public sealed class ProcessLoopbackCapture : IWaveIn
{
    private readonly uint _processId;
    private readonly bool _includeProcessTree;

    private IAudioClient? _audioClient;
    private IAudioCaptureClient? _captureClient;
    private EventWaitHandle? _bufferReady;
    private Thread? _thread;
    private volatile bool _stopRequested;

    public WaveFormat WaveFormat { get; set; } = new WaveFormat(48000, 16, 2);

    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    public ProcessLoopbackCapture(int processId, bool includeProcessTree = true)
    {
        _processId = (uint)processId;
        _includeProcessTree = includeProcessTree;
    }

    public void StartRecording()
    {
        if (_thread != null) return;

        // Activation + capture must live on an explicit MTA thread: when the caller is
        // an STA thread (WPF UI) the activated object is not queryable for IAudioClient.
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _stopRequested = false;
        _thread = new Thread(() => CaptureThread(ready)) { IsBackground = true, Name = "ProcessLoopbackCapture" };
        _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();

        try
        {
            ready.Task.GetAwaiter().GetResult();
        }
        catch
        {
            _thread.Join(2000);
            _thread = null;
            throw;
        }
    }

    private void CaptureThread(TaskCompletionSource ready)
    {
        try
        {
            _audioClient = ActivateAsync().GetAwaiter().GetResult();

            var formatPtr = WaveFormat.MarshalToPtr(WaveFormat);
            try
            {
                const uint loopback = 0x00020000, eventCallback = 0x00040000;
                Check(_audioClient.Initialize(0 /* shared */, loopback | eventCallback, 0, 0, formatPtr, IntPtr.Zero),
                    "IAudioClient.Initialize");
            }
            finally
            {
                Marshal.FreeHGlobal(formatPtr);
            }

            _bufferReady = new EventWaitHandle(false, EventResetMode.AutoReset);
            Check(_audioClient.SetEventHandle(_bufferReady.SafeWaitHandle.DangerousGetHandle()), "IAudioClient.SetEventHandle");

            var captureGuid = typeof(IAudioCaptureClient).GUID;
            Check(_audioClient.GetService(ref captureGuid, out var captureObj), "IAudioClient.GetService");
            _captureClient = (IAudioCaptureClient)captureObj;

            Check(_audioClient.Start(), "IAudioClient.Start");
        }
        catch (Exception ex)
        {
            ReleaseCom();
            ready.TrySetException(ex);
            return;
        }

        ready.TrySetResult();
        CaptureLoop();
    }

    public void StopRecording()
    {
        _stopRequested = true;
        var thread = _thread;
        _thread = null;
        if (thread != null && thread != Thread.CurrentThread) thread.Join(2000);

        try { _audioClient?.Stop(); } catch { /* best effort during shutdown */ }

        ReleaseCom();
    }

    private void CaptureLoop()
    {
        Exception? error = null;
        try
        {
            int frameBytes = WaveFormat.BlockAlign;
            while (!_stopRequested)
            {
                if (!_bufferReady!.WaitOne(200)) continue;

                while (!_stopRequested)
                {
                    Check(_captureClient!.GetNextPacketSize(out var packetFrames), "GetNextPacketSize");
                    if (packetFrames == 0) break;

                    Check(_captureClient.GetBuffer(out var data, out var frames, out var flags, out _, out _), "GetBuffer");
                    int bytes = (int)frames * frameBytes;
                    var buffer = new byte[bytes];
                    const uint silent = 0x2; // AUDCLNT_BUFFERFLAGS_SILENT
                    if ((flags & silent) == 0 && bytes > 0) Marshal.Copy(data, buffer, 0, bytes);
                    Check(_captureClient.ReleaseBuffer(frames), "ReleaseBuffer");

                    if (bytes > 0) DataAvailable?.Invoke(this, new WaveInEventArgs(buffer, bytes));
                }
            }
        }
        catch (Exception ex)
        {
            error = ex;
            DebugLog.Write($"ProcessLoopbackCapture loop failed: {ex}");
        }
        finally
        {
            RecordingStopped?.Invoke(this, new StoppedEventArgs(error));
        }
    }

    private async Task<IAudioClient> ActivateAsync()
    {
        // AUDIOCLIENT_ACTIVATION_PARAMS { int type; uint pid; int mode; }
        var paramsPtr = Marshal.AllocHGlobal(12);
        // PROPVARIANT (VT_BLOB): vt @0, cbSize @8, pBlobData @8+4 aligned to pointer size.
        var propVariant = Marshal.AllocHGlobal(24);
        try
        {
            Marshal.WriteInt32(paramsPtr, 0, 1); // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
            Marshal.WriteInt32(paramsPtr, 4, (int)_processId);
            Marshal.WriteInt32(paramsPtr, 8, _includeProcessTree ? 0 : 1); // INCLUDE / EXCLUDE target tree

            for (int i = 0; i < 24; i += 8) Marshal.WriteInt64(propVariant, i, 0);
            Marshal.WriteInt16(propVariant, 0, 65); // VT_BLOB
            Marshal.WriteInt32(propVariant, 8, 12);
            Marshal.WriteIntPtr(propVariant, IntPtr.Size == 8 ? 16 : 12, paramsPtr);

            var handler = new ActivationHandler();
            var iid = typeof(IAudioClient).GUID;
            ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, propVariant, handler, out _);

            var result = await handler.Completion.Task.ConfigureAwait(false);
            return (IAudioClient)result;
        }
        finally
        {
            Marshal.FreeHGlobal(propVariant);
            Marshal.FreeHGlobal(paramsPtr);
        }
    }

    private static void Check(int hr, string what)
    {
        if (hr < 0) throw new InvalidOperationException($"{what} failed (HRESULT 0x{hr:X8})", Marshal.GetExceptionForHR(hr));
    }

    private void ReleaseCom()
    {
        if (_captureClient != null) { Marshal.ReleaseComObject(_captureClient); _captureClient = null; }
        if (_audioClient != null) { Marshal.ReleaseComObject(_audioClient); _audioClient = null; }
        _bufferReady?.Dispose();
        _bufferReady = null;
    }

    public void Dispose() => StopRecording();

    // ---- COM interop -------------------------------------------------------

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    private static extern void ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        ref Guid riid,
        IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation activationOperation);

    [ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAgileObject { }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceCompletionHandler
    {
        [PreserveSig] int ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig] int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    // Implemented in managed code but must be agile: it is called back from a COM worker thread.
    private sealed class ActivationHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public TaskCompletionSource<object> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
        {
            try
            {
                int hr = activateOperation.GetActivateResult(out var activateResult, out var iface);
                if (hr < 0) Completion.TrySetException(new InvalidOperationException($"GetActivateResult failed (0x{hr:X8})"));
                else if (activateResult < 0) Completion.TrySetException(new InvalidOperationException(
                    $"Process loopback activation failed (0x{activateResult:X8}); requires Windows 10 2004+ and a valid process id"));
                else Completion.TrySetResult(iface);
            }
            catch (Exception ex)
            {
                Completion.TrySetException(ex);
            }
            return 0;
        }
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr format, IntPtr audioSessionGuid);
        [PreserveSig] int GetBufferSize(out uint bufferFrameCount);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint currentPadding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr deviceFormat);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr eventHandle);
        [PreserveSig] int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint numFramesToRead, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint numFramesRead);
        [PreserveSig] int GetNextPacketSize(out uint numFramesInNextPacket);
    }
}
