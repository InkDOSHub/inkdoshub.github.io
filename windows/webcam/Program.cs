// InkTerminal Webcam para Windows.
//
// Mostra a página Guest do app Webcam (https://inkterminal.github.io/apps/webcam/) num WebView2 e
// entrega a imagem que chega do iPhone a uma câmera virtual do Windows (softcam, DirectShow), que o
// Zoom, o Teams, o Meet e os outros apps enxergam como "InkTerminal Webcam". Sem o OBS.
//
// Como a imagem passa: a página desenha cada quadro num canvas do tamanho da câmera e copia os pixels
// (RGBA) para um buffer compartilhado com este programa (CoreWebView2SharedBuffer). Aí avisa com
// postMessage("frame"); este programa converte para BGR, manda para a câmera e responde "ok".
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace InkTerminalWebcam
{
    static class Program
    {
        public const string Clsid = "{4E1C6B1A-2B7E-4F0A-9C55-6A1D3B8E7F21}"; // o mesmo de softcam.cpp (patch do workflow)
        public static readonly string Pasta = AppDomain.CurrentDomain.BaseDirectory;
        public static readonly string Dll = Path.Combine(Pasta, "softcam.dll");

        [STAThread]
        static int Main(string[] args)
        {
            if (args.Length > 0 && (args[0] == "--registrar" || args[0] == "--remover"))
                return Softcam.Registrar(args[0] == "--registrar") ? 0 : 1;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (!File.Exists(Dll))
            {
                MessageBox.Show("softcam.dll is missing. Extract the whole ZIP to a folder and open the app from there.", "InkTerminal Webcam");
                return 1;
            }
            if (!Softcam.Registrada())
            {
                var r = MessageBox.Show("To create the \"InkTerminal Webcam\" camera, Windows will ask for administrator permission once.\n\nIf you move this folder later, the app asks again.",
                    "InkTerminal Webcam", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
                if (r != DialogResult.OK) return 1;
                try
                {
                    var p = Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--registrar") { Verb = "runas", UseShellExecute = true });
                    p.WaitForExit();
                }
                catch (Exception) { }
                if (!Softcam.Registrada())
                {
                    MessageBox.Show("The camera was not created (permission denied?). Open the app again to retry.", "InkTerminal Webcam");
                    return 1;
                }
            }
            Application.Run(new Janela());
            return 0;
        }
    }

    /* softcam.dll: registro da câmera (uma vez, como administrador) e envio dos quadros. */
    static class Softcam
    {
        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibrary(string path);
        [DllImport("kernel32", CharSet = CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr mod, string name);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DllRegister();

        [DllImport("softcam.dll", CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr scCreateCamera(int width, int height, float framerate);
        [DllImport("softcam.dll", CallingConvention = CallingConvention.Cdecl)] public static extern void scDeleteCamera(IntPtr camera);
        [DllImport("softcam.dll", CallingConvention = CallingConvention.Cdecl)] public static extern void scSendFrame(IntPtr camera, IntPtr image);

        public static bool Registrada()
        {
            try
            {
                using (var k = Registry.ClassesRoot.OpenSubKey(@"CLSID\" + Program.Clsid + @"\InprocServer32"))
                {
                    var v = k == null ? null : k.GetValue("") as string;
                    return v != null && string.Equals(Path.GetFullPath(v), Path.GetFullPath(Program.Dll), StringComparison.OrdinalIgnoreCase);
                }
            }
            catch (Exception) { return false; }
        }

        public static bool Registrar(bool registrar)
        {
            var h = LoadLibrary(Program.Dll);
            if (h == IntPtr.Zero) return false;
            var f = GetProcAddress(h, registrar ? "DllRegisterServer" : "DllUnregisterServer");
            if (f == IntPtr.Zero) return false;
            var fn = (DllRegister)Marshal.GetDelegateForFunctionPointer(f, typeof(DllRegister));
            return fn() >= 0;
        }
    }

    class Qualidade
    {
        public string Nome; public int W, H, Fps;
        public Qualidade(string n, int w, int h, int fps) { Nome = n; W = w; H = h; Fps = fps; }
        public override string ToString() { return Nome; }
    }

    class Janela : Form
    {
        const string Pagina = "https://inkterminal.github.io/apps/webcam/?app=1";
        static readonly Qualidade[] Qualidades =
        {
            new Qualidade("1080p 60 fps (recommended)", 1920, 1080, 60),
            new Qualidade("1080p 30 fps", 1920, 1080, 30),
            new Qualidade("720p 60 fps", 1280, 720, 60),
            new Qualidade("720p 30 fps", 1280, 720, 30),
            new Qualidade("4K 30 fps (heavy, for recording)", 3840, 2160, 30),
        };

        readonly WebView2 web = new WebView2();
        readonly ComboBox qualidade = new ComboBox();
        readonly Label estado = new Label();
        CoreWebView2SharedBuffer buffer;
        IntPtr camera = IntPtr.Zero;
        byte[] bgr;
        Qualidade atual;
        readonly AutoResetEvent temQuadro = new AutoResetEvent(false);
        readonly object trava = new object();
        Thread envio;
        volatile bool rodando = true;

        public Janela()
        {
            Text = "InkTerminal Webcam";
            ClientSize = new Size(960, 640);
            MinimumSize = new Size(520, 420);
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            var barra = new Panel { Dock = DockStyle.Top, Height = 44, Padding = new Padding(10, 9, 10, 6) };
            var rotulo = new Label { Text = "Quality:", AutoSize = true, Dock = DockStyle.Left, Padding = new Padding(0, 5, 6, 0) };
            qualidade.DropDownStyle = ComboBoxStyle.DropDownList;
            qualidade.Width = 260;
            qualidade.Dock = DockStyle.Left;
            qualidade.Items.AddRange(Qualidades);
            estado.Dock = DockStyle.Fill;
            estado.TextAlign = ContentAlignment.MiddleLeft;
            estado.Padding = new Padding(12, 0, 0, 0);
            barra.Controls.Add(estado);
            barra.Controls.Add(qualidade);
            barra.Controls.Add(rotulo);
            web.Dock = DockStyle.Fill;
            Controls.Add(web);
            Controls.Add(barra);

            int salvo = 0;
            try { salvo = (int)(Registry.CurrentUser.CreateSubKey(@"Software\InkTerminal Webcam").GetValue("qualidade", 0)); } catch (Exception) { }
            qualidade.SelectedIndex = salvo >= 0 && salvo < Qualidades.Length ? salvo : 0;
            qualidade.SelectedIndexChanged += delegate
            {
                try { Registry.CurrentUser.CreateSubKey(@"Software\InkTerminal Webcam").SetValue("qualidade", qualidade.SelectedIndex); } catch (Exception) { }
                AbrirCamera();
            };

            envio = new Thread(Enviar) { IsBackground = true, Name = "envio" };
            envio.Start();
            Load += async delegate
            {
                try
                {
                    var dados = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InkTerminal Webcam");
                    // sem isso o Chromium desacelera a página quando a janela fica escondida ou minimizada, e a câmera congela
                    var opcoes = new CoreWebView2EnvironmentOptions("--disable-features=CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required");
                    var env = await CoreWebView2Environment.CreateAsync(null, dados, opcoes);
                    await web.EnsureCoreWebView2Async(env);
                }
                catch (Exception e)
                {
                    MessageBox.Show("WebView2 could not start. Install the Microsoft Edge WebView2 Runtime and open the app again.\n\n" + e.Message, "InkTerminal Webcam");
                    Close();
                    return;
                }
                web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.WebMessageReceived += Mensagem;
                web.CoreWebView2.NavigationCompleted += delegate { AbrirCamera(); };
                web.CoreWebView2.Navigate(Pagina);
            };
            FormClosing += delegate
            {
                rodando = false;
                temQuadro.Set();
                lock (trava) { if (camera != IntPtr.Zero) Softcam.scDeleteCamera(camera); camera = IntPtr.Zero; }
            };
        }

        /* Cria a câmera no tamanho escolhido e manda o buffer para a página. */
        void AbrirCamera()
        {
            var q = (Qualidade)qualidade.SelectedItem;
            if (web.CoreWebView2 == null || q == null) return;
            lock (trava)
            {
                if (camera != IntPtr.Zero && atual != null && (atual.W != q.W || atual.H != q.H))
                {
                    Softcam.scDeleteCamera(camera);
                    camera = IntPtr.Zero;
                }
                if (camera == IntPtr.Zero) camera = Softcam.scCreateCamera(q.W, q.H, 0);
                if (camera == IntPtr.Zero)
                {
                    estado.Text = "Could not create the camera. Is another copy of this app open?";
                    return;
                }
                if (buffer == null || atual == null || atual.W != q.W || atual.H != q.H)
                {
                    if (buffer != null) buffer.Dispose();
                    buffer = web.CoreWebView2.Environment.CreateSharedBuffer((ulong)q.W * (ulong)q.H * 4);
                    bgr = new byte[q.W * q.H * 3];
                }
                atual = q;
            }
            web.CoreWebView2.PostSharedBufferToScript(buffer, CoreWebView2SharedBufferAccess.ReadWrite,
                "{\"w\":" + q.W + ",\"h\":" + q.H + ",\"fps\":" + q.Fps + "}");
            estado.Text = "Camera \"InkTerminal Webcam\" ready (" + q.W + "×" + q.H + "). Choose it in Zoom. On the iPhone, pick " + (q.H >= 2160 ? "4K" : q.H + "p") + " " + q.Fps + " fps.";
        }

        void Mensagem(object s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string m;
            try { m = e.TryGetWebMessageAsString(); } catch (Exception) { return; }
            if (m == "frame") temQuadro.Set();
        }

        /* Linha de envio: converte RGBA (da página) para BGR e manda para a câmera. */
        void Enviar()
        {
            while (rodando)
            {
                temQuadro.WaitOne();
                if (!rodando) break;
                lock (trava)
                {
                    if (camera != IntPtr.Zero && buffer != null && bgr != null)
                    {
                        int n = atual.W * atual.H;
                        unsafe
                        {
                            byte* src = (byte*)buffer.Buffer.ToPointer();
                            fixed (byte* dst0 = bgr)
                            {
                                byte* dst = dst0;
                                for (int i = 0; i < n; i++, src += 4, dst += 3)
                                {
                                    dst[0] = src[2];
                                    dst[1] = src[1];
                                    dst[2] = src[0];
                                }
                                Softcam.scSendFrame(camera, (IntPtr)dst0);
                            }
                        }
                    }
                }
                try { BeginInvoke((Action)delegate { if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsString("ok"); }); } catch (Exception) { }
            }
        }
    }
}
