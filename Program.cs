namespace NodeBox;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        using var app = new AOTrinoApplication();
        using var window = new MainWindow();
        window.ResizeClient(1280, 800);
        window.Center();
        window.Show();
        app.Run();
    }
}
