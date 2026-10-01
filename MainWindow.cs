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
///
/// AOTrino features in use:
///   • AcceptsFileDrops / OnFilesDropped  — drag a .js sketch from Explorer
///   • FileApi host object ("file")       — native Open / Save / Reveal dialogs
///   • window.__aotrino.setWindowTitle    — title bar reflects current sketch name
/// </summary>
[System.Runtime.InteropServices.Marshalling.GeneratedComClass]
public partial class MainWindow : AOTrinoWindow
{
    private NodeBoxSurface? _surface;
    private DrawingApi? _api;
    private FileApi? _fileApi;

    public MainWindow()
        : base("NodeBox")
    {
    }

    protected override void ControllerCreated()
    {
        // Surface must be created before base.ControllerCreated() so its
        // startup scripts are registered before the page navigates.
        _surface = new NodeBoxSurface(this);
        _api = new DrawingApi(_surface);
        _fileApi = new FileApi(this);

        base.ControllerCreated();
    }

    protected override void RegisterHostObjects()
    {
        if (_api != null)
            AddHostObject("nb", _api);

        // Exposes native file open/save/reveal-in-Explorer to the page as
        // chrome.webview.hostObjects.sync.file.*
        if (_fileApi != null)
            AddHostObject("file", _fileApi);
    }

    // ── File drag-and-drop ───────────────────────────────────────────────

    // Accept Explorer drops so the user can drag a .js sketch file onto the window.
    protected override bool AcceptsFileDrops => true;

    // While the file is in the air, show a copy cursor only when dragging a .js file;
    // anything else is ignored (cursor shows a deny icon instead).
    protected override DROPEFFECT GetFileDropEffect(DROPEFFECT allowedEffects)
    {
        // We do not have access to the dragged-file list at this point, so we accept
        // optimistically; OnFilesDropped validates the extension and does nothing for
        // non-.js files.  This matches how most apps behave on drag-over.
        return base.GetFileDropEffect(allowedEffects);
    }

    protected override void OnFilesDropped(FileDropEventArgs e)
    {
        base.OnFilesDropped(e);

        // Pick the first .js file in the drop — NodeBox works on one sketch at a time.
        var js = e.Paths.FirstOrDefault(
            p => p.EndsWith(".js", StringComparison.OrdinalIgnoreCase) && File.Exists(p));

        if (js == null)
            return;

        string content;
        try
        {
            content = File.ReadAllText(js, System.Text.Encoding.UTF8);
        }
        catch (Exception ex)
        {
            ExecuteScript($"window.__nb_dropError && window.__nb_dropError({JsonSerializer.Serialize(ex.Message, NodeBoxJsonContext.Default.String)});");
            return;
        }

        // Pass the file to the page so Monaco can display it and auto-run it.
        // Both values are JSON-encoded so any character in the path or content is safe.
        var contentJson = JsonSerializer.Serialize(content, NodeBoxJsonContext.Default.String);
        var pathJson = JsonSerializer.Serialize(js, NodeBoxJsonContext.Default.String);
        ExecuteScript($"window.onSketchDropped && window.onSketchDropped({contentJson}, {pathJson});");
    }

    protected override void Dispose(bool disposing)
    {
        Interlocked.Exchange(ref _surface, null)?.Dispose();
        base.Dispose(disposing);
    }
}