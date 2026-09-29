namespace NodeBox;

/// <summary>
/// NodeBox main window.
///
/// Layout (web-side, index.html):
///   Left panel  – Monaco code editor (JavaScript)
///   Right panel – Direct2D canvas  (zero-copy shared buffer → WebGL)
///   Bottom strip– console / error output
///
/// The user writes JS.  The page's thin shim exposes a global `nb` object
/// whose methods call through the WebView2 sync bridge into DrawingApi,
/// which queues Direct2D commands.  When the user clicks Run, the page
/// calls nb.run() which triggers a single-frame render onto the surface.
/// </summary>
[System.Runtime.InteropServices.Marshalling.GeneratedComClass]
public partial class MainWindow : AOTrinoWindow
{
    private NodeBoxSurface? _surface;
    private DrawingApi?     _api;

    public MainWindow()
        : base("NodeBox")
    {
    }

    protected override void ControllerCreated()
    {
        // Surface must be created before base.ControllerCreated() so its
        // startup scripts are registered before the page navigates.
        _surface = new NodeBoxSurface(this);
        _api     = new DrawingApi(_surface);

        base.ControllerCreated();
    }

    protected override void RegisterHostObjects()
    {
        if (_api != null)
            AddHostObject("nb", _api);
    }

    protected override void Dispose(bool disposing)
    {
        Interlocked.Exchange(ref _surface, null)?.Dispose();
        base.Dispose(disposing);
    }
}
