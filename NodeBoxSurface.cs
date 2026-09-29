namespace NodeBox;

/// <summary>
/// Owns the Direct2D surface shown in &lt;canvas data-aotrino-surface="canvas"&gt;
/// and renders the most recently submitted NodeBox frame.
///
///   One-shot (plain script):  Submit(frame, animate:false) → render once, stop.
///   Animation (draw() loop):  Submit(frame, animate:true) each frame → the surface
///                             keeps ticking and always draws the latest frame.
///
/// Everything runs on the UI thread (the bridge call and the surface's render loop
/// both do), so no locking is needed; the fields are volatile for safety anyway.
/// </summary>
public sealed class NodeBoxSurface : IDisposable
{
    private readonly Direct2DSurface _d2d;
    // A frame and its string table are swapped in together, atomically.
    private sealed record Frame(byte[] Bytes, string[] Strings);
    private volatile Frame? _frame;
    private volatile bool _running;
    private volatile bool _singleShot;

    public NodeBoxSurface(CompositionWebViewWindow window)
    {
        _d2d = new Direct2DSurface(window, "canvas");
    }

    /// <summary>Error from the most recently rendered frame ("" if none).</summary>
    public string LastError { get; private set; } = string.Empty;

    public void Submit(byte[] frame, string[] strings, bool animate)
    {
        _frame = new Frame(frame, strings);

        if (animate)
        {
            _singleShot = false;
            if (!_running)
            {
                _running = true;
                _d2d.StartAnimation(DrawFrame);
            }
        }
        else
        {
            // (Re)start so exactly one fresh frame is rendered, then stop.
            _singleShot = true;
            _running = true;
            _d2d.StartAnimation(DrawFrame);
        }
    }

    public void Stop()
    {
        _running = false;
        _singleShot = false;
        _d2d.StopAnimation();
    }

    private void DrawFrame(IComObject<ID2D1RenderTarget> rt, int w, int h, float t)
    {
        var frame = _frame;
        if (frame == null)
            return;

        try
        {
            var error = FrameRenderer.Render(rt, frame.Bytes, frame.Strings);
            if (error != null && error != LastError)
                AOTrinoApplication.Current?.TraceWarning($"NodeBox render error: {error}");
            LastError = error ?? string.Empty;
        }
        catch (Exception ex)
        {
            // FrameRenderer shouldn't throw, but never let an exception skip EndDraw.
            LastError = $"{ex.GetType().Name}: {ex.Message}";
        }
        finally
        {
            if (_singleShot)
            {
                _singleShot = false;
                _running = false;
                _d2d.StopAnimation();
            }
        }
    }

    public void Dispose() => _d2d.Dispose();
}
