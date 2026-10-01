using System.Runtime.InteropServices.Marshalling;

namespace NodeBox;

// ── Windows shell COM interfaces for the modern file-picker dialog (Vista+) ──────────────
//
// Declared here because neither DirectN nor AOTrino wraps them — DirectN covers the
// Direct* family of APIs, not the shell dialog layer.  The pattern follows
// AOTrino.Samples.FileExplorer/FileDragSource.cs: when an interface or function is
// absent from the library, declare it locally with [GeneratedComInterface] /
// [LibraryImport] (the AOT-safe, source-generated alternatives to [ComImport] /
// [DllImport]) rather than reaching for the old runtime-marshalling APIs.
//
// CoCreateInstance with CLSID_FileOpenDialog or CLSID_FileSaveDialog returns the
// modern Explorer-style picker (the same one every app on Windows has used since
// Vista), not the old comdlg32 dialog.  We query for IFileDialog in both cases, which
// gives us all the methods we need via the common base interface.

/// <summary>Shell item returned by IFileDialog.GetResult.</summary>
[GeneratedComInterface]
[Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
internal partial interface IShellItem
{
    [PreserveSig] int BindToHandler(nint pbc, in Guid bhid, in Guid riid, out nint ppv);
    [PreserveSig] int GetParent(out nint ppsi);
    /// <param name="sigdnName">0x80058000 = SIGDN_FILESYSPATH → absolute filesystem path.</param>
    [PreserveSig] int GetDisplayName(int sigdnName, out nint ppszName);
    [PreserveSig] int GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    [PreserveSig] int Compare(nint psi, uint hint, out int piOrder);
}

/// <summary>Base of IFileDialog; provides the modal Show call.</summary>
[GeneratedComInterface]
[Guid("B4DB1657-70D7-485E-8E3E-6FCB5A5C1802")]
internal partial interface IModalWindow
{
    /// <returns>S_OK on confirm, HRESULT_FROM_WIN32(ERROR_CANCELLED) on cancel.</returns>
    [PreserveSig] int Show(nint hwndOwner);
}

/// <summary>
/// Common interface for the open and save picker dialogs.
/// Methods are declared in vtable order; every slot must be present so offsets stay correct.
/// </summary>
[GeneratedComInterface]
[Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
internal partial interface IFileDialog : IModalWindow
{
    // Slots 4-26 of the COM vtable (0-2 = IUnknown, 3 = IModalWindow.Show).
    [PreserveSig] int SetFileTypes(uint cFileTypes, nint rgFilterSpec);   // COMDLG_FILTERSPEC[]
    [PreserveSig] int SetFileTypeIndex(uint iFileType);
    [PreserveSig] int GetFileTypeIndex(out uint piFileType);
    [PreserveSig] int Advise(nint pfde, out uint pdwCookie);
    [PreserveSig] int Unadvise(uint dwCookie);
    [PreserveSig] int SetOptions(uint fos);                                // FILEOPENDIALOGOPTIONS
    [PreserveSig] int GetOptions(out uint pfos);
    [PreserveSig] int SetDefaultFolder(nint psi);
    [PreserveSig] int SetFolder(nint psi);
    [PreserveSig] int GetFolder(out nint ppsi);
    [PreserveSig] int GetCurrentSelection(out nint ppsi);
    [PreserveSig] int SetFileName(nint pszName);                           // LPCWSTR — pass via fixed char*
    [PreserveSig] int GetFileName(out nint pszName);
    [PreserveSig] int SetTitle(nint pszTitle);                             // LPCWSTR
    [PreserveSig] int SetOkButtonLabel(nint pszText);
    [PreserveSig] int SetFileNameLabel(nint pszLabel);
    [PreserveSig] int GetResult(out nint ppsi);                            // → IShellItem*
    [PreserveSig] int AddPlace(nint psi, int fdap);
    [PreserveSig] int SetDefaultExtension(nint pszDefaultExtension);       // LPCWSTR
    [PreserveSig] int Close(int hr);
    [PreserveSig] int SetClientGuid(in Guid guid);
    [PreserveSig] int ClearClientData();
    [PreserveSig] int SetFilter(nint pFilter);
}

// ────────────────────────────────────────────────────────────────────────────────────────

/// <summary>
/// JS-callable host object exposed as chrome.webview.hostObjects.sync.file.
/// Provides native file open / save / reveal-in-Explorer to the web layer.
///
/// Only public members are reachable from the page.  The window handle is used
/// to parent the native dialog so it is modal to the app, not the desktop.
/// </summary>
[System.Runtime.InteropServices.Marshalling.GeneratedComClass]
[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicMethods | DynamicallyAccessedMemberTypes.PublicProperties)]
public partial class FileApi(MainWindow window) : DispatchObject
{
    // ── COM class and interface identifiers ───────────────────────────────

    // CLSID_FileOpenDialog / CLSID_FileSaveDialog: the two shell picker classes.
    private static readonly Guid CLSID_FileOpenDialog = new("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7");
    private static readonly Guid CLSID_FileSaveDialog = new("C0B4E2F3-BA21-4773-8DBA-335EC946EB8B");

    // IID_IFileDialog: we query both classes for this common base interface.
    private static readonly Guid IID_IFileDialog = new("42F85136-DB7E-439C-85F1-E4075D135FC8");

    // IID_IShellItem: the result object returned by IFileDialog.GetResult.
    private static readonly Guid IID_IShellItem = new("43826D1E-E718-42EE-BC55-A1E261C37BFE");

    // ── FILEOPENDIALOGOPTIONS flags ───────────────────────────────────────

    private const uint FOS_OVERWRITEPROMPT = 0x00000002; // prompt before overwriting (save)
    private const uint FOS_FORCEFILESYSTEM = 0x00000040; // only file-system items
    private const uint FOS_PATHMUSTEXIST = 0x00000800; // folder must exist
    private const uint FOS_FILEMUSTEXIST = 0x00001000; // file must exist (open)

    // ── Win32 COM helpers — [LibraryImport] (AOT-safe, source-generated) ─
    // Pattern: same as FileDragSource.cs which uses [LibraryImport("SHELL32")] for
    // SHParseDisplayName because DirectN does not expose it.

    private const uint CLSCTX_INPROC_SERVER = 1;
    private const int S_OK = 0;
    // SIGDN_FILESYSPATH: GetDisplayName mode that returns the absolute filesystem path.
    private const int SIGDN_FILESYSPATH = unchecked((int)0x80058000);

    [LibraryImport("ole32", EntryPoint = "CoCreateInstance")]
    private static unsafe partial int CoCreateInstance(
        in Guid rclsid, nint pUnkOuter, uint dwClsContext, in Guid riid, out nint ppv);

    // Frees LPWSTR buffers handed back by shell methods like IShellItem.GetDisplayName.
    [LibraryImport("ole32", EntryPoint = "CoTaskMemFree")]
    private static partial void CoTaskMemFree(nint pv);

    // ── Public bridge methods ─────────────────────────────────────────────

    /// <summary>
    /// Shows a native Open File dialog limited to .js files.
    /// Returns JSON <c>{"path":"…","content":"…"}</c>, <c>{"path":"…","content":"…","error":"…"}</c>
    /// if the read failed, or <c>{}</c> if the user cancelled.
    /// </summary>
    public string openFile()
    {
        var path = RunDialog(openMode: true, suggestedName: null);
        if (path == null)
            return "{}";

        try
        {
            var content = File.ReadAllText(path, System.Text.Encoding.UTF8);
            return JsonSerializer.Serialize(
                new FileOpenResult(path, content),
                NodeBoxJsonContext.Default.FileOpenResult);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(
                new FileOpenResult(path, string.Empty, ex.Message),
                NodeBoxJsonContext.Default.FileOpenResult);
        }
    }

    /// <summary>
    /// Saves <paramref name="content"/> to <paramref name="path"/>.
    /// If <paramref name="path"/> is empty, shows a Save-As dialog.
    /// Returns the path where the file was written, "error:…" on failure, or "" on cancel.
    /// </summary>
    public string saveFile(string path, string content)
    {
        if (string.IsNullOrEmpty(path))
        {
            path = RunDialog(openMode: false, suggestedName: "sketch.js") ?? string.Empty;
            if (string.IsNullOrEmpty(path))
                return string.Empty;
        }

        try
        {
            File.WriteAllText(path, content, System.Text.Encoding.UTF8);
            return path;
        }
        catch (Exception ex)
        {
            return "error:" + ex.Message;
        }
    }

    /// <summary>Opens the parent folder in Explorer with the item highlighted.</summary>
    public bool revealInExplorer(string path)
    {
        if (string.IsNullOrEmpty(path) || (!File.Exists(path) && !Directory.Exists(path)))
            return false;

        // "/select," is what makes Explorer open the parent folder and highlight the item,
        // instead of just opening it — the same pattern used by the FileExplorer sample.
        Process.Start(new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = $"/select,\"{path}\"",
            UseShellExecute = true,
        });
        return true;
    }

    // ── Shell dialog helper ───────────────────────────────────────────────

    private static unsafe void ConfigureFilter(IFileDialog dialog)
    {
        // COMDLG_FILTERSPEC is a pair of LPCWSTR pointers { pszName, pszSpec }.
        // Pin the string literals and pass the array as a pointer — no heap allocation needed.
        fixed (char* pName1 = "JavaScript scripts", pSpec1 = "*.js",
                     pName2 = "All files", pSpec2 = "*.*")
        {
            var specs = stackalloc nint[4] { (nint)pName1, (nint)pSpec1, (nint)pName2, (nint)pSpec2 };
            dialog.SetFileTypes(2, (nint)specs);
        }
        dialog.SetFileTypeIndex(1); // pre-select "JavaScript scripts"
    }

    private unsafe string? RunDialog(bool openMode, string? suggestedName)
    {
        var clsid = openMode ? CLSID_FileOpenDialog : CLSID_FileSaveDialog;

        // CoCreateInstance with IID_IFileDialog works for both classes: the CLSID decides
        // which picker (open vs. save); the IID picks the common base interface we need.
        if (CoCreateInstance(clsid, 0, CLSCTX_INPROC_SERVER, IID_IFileDialog, out var ptr) != S_OK
            || ptr == 0)
            return null;

        // Wrap the raw COM pointer with the source-generated [GeneratedComInterface] marshaller.
        // ConvertToManaged adopts the reference; the GC releases it when the wrapper is collected.
        var dialog = ComInterfaceMarshaller<IFileDialog>.ConvertToManaged((void*)ptr)!;

        ConfigureFilter(dialog);
        dialog.SetOptions(openMode
            ? FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST
            : FOS_FORCEFILESYSTEM | FOS_OVERWRITEPROMPT | FOS_PATHMUSTEXIST);

        // Pin string literals on the stack — no heap allocation, no manual free.
        fixed (char* pExt = "js")
        {
            dialog.SetDefaultExtension((nint)pExt);

            if (!openMode && !string.IsNullOrEmpty(suggestedName))
            {
                fixed (char* pName = suggestedName)
                    dialog.SetFileName((nint)pName);
            }
        }

        // Show the dialog modal to our window; S_OK = confirmed, anything else = cancelled.
        if (dialog.Show((nint)window.Handle) != S_OK)
            return null;

        // GetResult hands back an IShellItem*.
        if (dialog.GetResult(out var itemPtr) != S_OK || itemPtr == 0)
            return null;

        var item = ComInterfaceMarshaller<IShellItem>.ConvertToManaged((void*)itemPtr)!;

        // SIGDN_FILESYSPATH → CoTaskMem-allocated LPWSTR with the absolute path.
        if (item.GetDisplayName(SIGDN_FILESYSPATH, out var namePtr) != S_OK || namePtr == 0)
            return null;

        var path = Marshal.PtrToStringUni(namePtr);
        CoTaskMemFree(namePtr);
        return path;
    }
}