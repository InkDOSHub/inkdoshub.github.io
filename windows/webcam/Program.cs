// InkDOS Hub Webcam para Windows.
//
// Mostra a página Guest do app Webcam (https://inkdoshub.github.io/apps/webcam/) num WebView2 e
// entrega a imagem que chega do iPhone a uma câmera virtual do Windows (softcam, DirectShow), que o
// Zoom, o Teams, o Meet e os outros apps enxergam como "InkDOS Hub Webcam". Sem o OBS.
//
// Como a imagem passa: a página desenha cada quadro num canvas do tamanho da câmera e copia os pixels
// (RGBA) para um buffer compartilhado com este programa (CoreWebView2SharedBuffer). Aí avisa com
// postMessage("frame"); este programa converte para BGR, manda para a câmera e responde "ok".
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace InkDOSHubWebcam
{
    static class Program
    {
        // Mantém apenas uma instância da câmera virtual por sessão do Windows.
        static Mutex instancia;
        public const string Clsid = "{4E1C6B1A-2B7E-4F0A-9C55-6A1D3B8E7F21}"; // o mesmo de softcam.cpp (patch do workflow)
        public static readonly string Pasta = AppDomain.CurrentDomain.BaseDirectory;
        public static readonly string Dll = Path.Combine(Pasta, "softcam.dll");
        public static readonly string LogPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InkDOS Hub Webcam", "startup.log");

        public static void Log(string message)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
                File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }

        [STAThread]
        static int Main(string[] args)
        {
            Log("Process started. OS=" + Environment.OSVersion + "; 64bit=" + Environment.Is64BitProcess + "; args=" + string.Join(" ", args));
            AppDomain.CurrentDomain.UnhandledException += (s, e) => Log("UNHANDLED: " + e.ExceptionObject);
            Application.ThreadException += (s, e) => Log("THREAD EXCEPTION: " + e.Exception);
            TaskScheduler.UnobservedTaskException += (s, e) => { Log("UNOBSERVED TASK: " + e.Exception); e.SetObserved(); };
            if (args.Length > 0 && (args[0] == "--registrar" || args[0] == "--remover"))
            {
                Log("Registration helper starting.");
                bool ok = Softcam.Registrar(args[0] == "--registrar");
                Log("Registration helper result=" + ok);
                return ok ? 0 : 1;
            }
            bool novaInstancia;
            instancia = new Mutex(true, @"Local\InkDOSHubWebcamSingleInstance", out novaInstancia);
            if (!novaInstancia)
            {
                Log("Another InkDOS Hub Webcam instance is already running; refusing duplicate launch.");
                MessageBox.Show("O InkDOS Hub Webcam já está aberto. Feche a outra janela antes de abrir novamente.", "InkDOS Hub Webcam", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 1;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Log("DLL path=" + Dll + "; exists=" + File.Exists(Dll));
            if (!File.Exists(Dll))
            {
                MessageBox.Show("softcam.dll is missing. Extract the whole ZIP to a folder and open the app from there.", "InkDOS Hub Webcam");
                return 1;
            }
            if (!Softcam.Registrada())
            {
                var r = MessageBox.Show("To create the \"InkDOS Hub Webcam\" camera, Windows will ask for administrator permission once.\n\nIf you move this folder later, the app asks again.",
                    "InkDOS Hub Webcam", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
                if (r != DialogResult.OK) return 1;
                try
                {
                    var p = Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--registrar") { Verb = "runas", UseShellExecute = true });
                    p.WaitForExit();
                }
                catch (Exception) { }
                if (!Softcam.Registrada())
                {
                    MessageBox.Show("The camera was not created (permission denied?). Open the app again to retry.", "InkDOS Hub Webcam");
                    return 1;
                }
            }
            Log("Starting main window.");
            Application.Run(new Janela());
            Log("Main window closed normally.");
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
        const string Pagina = "https://inkdoshub.github.io/apps/webcam/?app=1";
        const string Origem = "https://inkdoshub.github.io/apps/webcam/";

        /* Só a página da Webcam pode abrir aqui: ela recebe o buffer da câmera virtual. */
        static bool Permitida(string uri)
        {
            return uri != null && uri.StartsWith(Origem, StringComparison.Ordinal);
        }
        static readonly Qualidade[] Qualidades =
        {
            // a primeira é a padrão; as outras só aparecem com "Custom resolutions"
            // (bitrate médio = o que o iPhone manda em cada modo)
            new Qualidade("1080p 30 fps · ~8 Mbps · light (recommended)", 1920, 1080, 30),
            new Qualidade("720p 30 fps · ~4 Mbps · lightest", 1280, 720, 30),
            new Qualidade("720p 60 fps · ~6 Mbps · light", 1280, 720, 60),
            new Qualidade("1080p 60 fps · ~15 Mbps · medium", 1920, 1080, 60),
            new Qualidade("4K 30 fps · ~25 Mbps · very heavy", 3840, 2160, 30),
            new Qualidade("4K 60 fps · ~40 Mbps · extreme", 3840, 2160, 60),
        };

        readonly WebView2 web = new WebView2();
        readonly CheckBox personalizadas = new CheckBox();
        readonly CheckBox nativo = new CheckBox();
        ReceptorNativo receptor;
        string codigoNativo;
        readonly Label rotuloBuffer = new Label();
        readonly ComboBox qualidade = new ComboBox();
        readonly Label estado = new Label();
        CoreWebView2SharedBuffer buffer;
        // Obter o ponteiro COM do buffer somente na thread da UI; a thread de envio usa o ponteiro nativo.
        IntPtr bufferPointer = IntPtr.Zero;
        IntPtr camera = IntPtr.Zero;
        byte[] bgr;
        Qualidade atual;
        readonly AutoResetEvent temQuadro = new AutoResetEvent(false);
        readonly object trava = new object();
        Thread envio;
        volatile bool rodando = true;
        // quadros avisados pela página: posição no buffer duplo e formato (BGRX do caminho rápido
        // VideoFrame.copyTo, ou RGBA do canvas)
        // um quadro pronto no buffer: posição, formato e, para "raw", tamanho, giro e modo "inteira"
        sealed class Pedido { public int Slot; public bool Bgrx; public bool Cru; public int Sw, Sh, Giro; public bool Inteira; }
        readonly System.Collections.Concurrent.ConcurrentQueue<Pedido> fila = new System.Collections.Concurrent.ConcurrentQueue<Pedido>();
        const int Slots = 2;

        public Janela()
        {
            Text = "InkDOS Hub Webcam";
            ClientSize = new Size(960, 640);
            MinimumSize = new Size(520, 420);
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            var barra = new Panel { Dock = DockStyle.Top, Height = 44, Padding = new Padding(10, 9, 10, 6) };
            var rotulo = new Label { Text = "Quality:", AutoSize = true, Dock = DockStyle.Left, Padding = new Padding(0, 5, 6, 0) };
            qualidade.DropDownStyle = ComboBoxStyle.DropDownList;
            qualidade.Width = 300;
            qualidade.Dock = DockStyle.Left;
            personalizadas.Text = "Custom resolutions";
            personalizadas.AutoSize = true;
            personalizadas.Dock = DockStyle.Left;
            personalizadas.Padding = new Padding(10, 3, 0, 0);
            nativo.Checked = true; // o app só funciona no modo nativo; a opção saiu da tela
            rotuloBuffer.AutoSize = true;
            rotuloBuffer.Dock = DockStyle.Right;
            rotuloBuffer.Padding = new Padding(8, 5, 0, 0);
            rotuloBuffer.Text = "Buffer: –";
            estado.Dock = DockStyle.Fill;
            estado.TextAlign = ContentAlignment.MiddleLeft;
            estado.Padding = new Padding(12, 0, 0, 0);
            barra.Controls.Add(estado);
            barra.Controls.Add(rotuloBuffer);
            barra.Controls.Add(personalizadas);
            barra.Controls.Add(qualidade);
            barra.Controls.Add(rotulo);
            web.Dock = DockStyle.Fill;
            Controls.Add(web);
            Controls.Add(barra);

            // qualidade salva = posição na lista completa (chave nova: a ordem mudou nesta versão)
            int salvo = 0; bool todas = false;
            try
            {
                using (var chave = Registry.CurrentUser.CreateSubKey(@"Software\InkDOS Hub Webcam"))
                {
                    salvo = Convert.ToInt32(chave.GetValue("qualidade3", 0));
                    todas = Convert.ToInt32(chave.GetValue("personalizadas", 0)) == 1;
                }
            }
            catch (Exception) { }
            if (salvo < 0 || salvo >= Qualidades.Length) salvo = 0;
            if (salvo != 0) todas = true;
            personalizadas.Checked = todas;
            PreencherLista(Qualidades[salvo]);
            qualidade.SelectedIndexChanged += delegate
            {
                if (preenchendo) return;
                Salvar();
                AbrirCamera();
            };
            personalizadas.CheckedChanged += delegate
            {
                var antes = (Qualidade)qualidade.SelectedItem;
                PreencherLista(personalizadas.Checked ? antes : Qualidades[0]);
                Salvar();
                if (qualidade.SelectedItem != antes) AbrirCamera();
            };

            Tamanho();

            envio = new Thread(Enviar) { IsBackground = true, Name = "envio" };
            envio.Start();
            Load += async delegate
            {
                Program.Log("Window Load event.");
                try
                {
                    var dados = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InkDOS Hub Webcam");
                    // sem isso o Chromium desacelera a página quando a janela fica escondida ou minimizada, e a câmera congela
                    var opcoes = new CoreWebView2EnvironmentOptions("--disable-features=CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required");
                    Program.Log("Creating WebView2 environment at " + dados);
                    var env = await CoreWebView2Environment.CreateAsync(null, dados, opcoes);
                    Program.Log("WebView2 environment created; ensuring CoreWebView2.");
                    await web.EnsureCoreWebView2Async(env);
                    Program.Log("CoreWebView2 initialized.");
                }
                catch (Exception e)
                {
                    Program.Log("WEBVIEW START ERROR: " + e);
                    MessageBox.Show("WebView2 could not start. Install the Microsoft Edge WebView2 Runtime and open the app again.\n\n" + e.Message, "InkDOS Hub Webcam");
                    Close();
                    return;
                }
                web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.WebMessageReceived += Mensagem;
                web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e)
                {
                    if (!Permitida(e.Uri)) { Program.Log("Blocked navigation to " + e.Uri); e.Cancel = true; }
                };
                web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e)
                {
                    e.Handled = true;
                };
                web.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
            {
                Program.Log("Navigation completed. success=" + e.IsSuccess + "; webError=" + e.WebErrorStatus);
                AbrirCamera();
            };
                Program.Log("Navigating to " + Endereco());
                web.CoreWebView2.Navigate(Endereco());
            };
            FormClosing += delegate
            {
                rodando = false;
                temQuadro.Set();
                PararNativo();
                lock (trava)
                {
                    if (camera != IntPtr.Zero) Softcam.scDeleteCamera(camera);
                    camera = IntPtr.Zero;
                    bufferPointer = IntPtr.Zero;
                    if (buffer != null) { buffer.Dispose(); buffer = null; }
                }
            };
        }

        /* Cria a câmera no tamanho escolhido e manda o buffer para a página. */
        void AbrirCamera(int tentativa = 0)
        {
            var q = (Qualidade)qualidade.SelectedItem;
            if (web.CoreWebView2 == null || q == null) return;
            Program.Log("AbrirCamera entered. quality=" + q.W + "x" + q.H + "@" + q.Fps);
            lock (trava)
            {
                if (camera != IntPtr.Zero && atual != null && (atual.W != q.W || atual.H != q.H || atual.Fps != q.Fps))
                {
                    Softcam.scDeleteCamera(camera);
                    camera = IntPtr.Zero;
                }
                if (camera == IntPtr.Zero)
                {
                    Program.Log("Calling native scCreateCamera.");
                    // framerate 0: cada quadro vai na hora. Com fps fixo o scSendFrame "dorme" para manter
                    // o ritmo, o que soma atraso (e aqui seguraria a trava). O DirectShow anuncia 60 fps.
                    camera = Softcam.scCreateCamera(q.W, q.H, 0);
                    Program.Log("scCreateCamera returned " + camera);
                }
                if (camera == IntPtr.Zero)
                {
                    estado.Text = "Camera initialization failed; retrying. Check whether another app is using InkDOS Hub Webcam.";
                    Program.Log("CAMERA INIT FAILED quality=" + q.W + "x" + q.H + "@" + q.Fps + " retry=" + tentativa);
                    // A troca de modo pode falhar logo após liberar o dispositivo nativo. Tenta novamente
                    // na thread da UI, sem deixar a página ser informada de uma câmera pronta inexistente.
                    if (tentativa < 3)
                    {
                        Task.Delay(350).ContinueWith(delegate
                        {
                            try
                            {
                                BeginInvoke((Action)delegate
                                {
                                    if (!IsDisposed && qualidade.SelectedItem == q && web.CoreWebView2 != null)
                                        AbrirCamera(tentativa + 1);
                                });
                            }
                            catch (Exception ex) { Program.Log("CAMERA RETRY SCHEDULE ERROR: " + ex.Message); }
                        });
                    }
                    else
                    {
                        estado.Text = "Camera could not be created after retries. Close Zoom/Teams and retry the quality selection.";
                        Program.Log("CAMERA INIT GAVE UP quality=" + q.W + "x" + q.H + "@" + q.Fps);
                    }
                    return;
                }
                if (buffer == null || atual == null || atual.W != q.W || atual.H != q.H)
                {
                    if (buffer != null) buffer.Dispose();
                    buffer = web.CoreWebView2.Environment.CreateSharedBuffer((ulong)q.W * (ulong)q.H * 4 * Slots);
                    // CoreWebView2SharedBuffer.Buffer é COM/UI-thread-bound: capture o ponteiro aqui.
                    bufferPointer = buffer.Buffer;
                    bgr = new byte[q.W * q.H * 3];
                }
                atual = q;
            }
            Program.Log("Posting shared buffer to page.");
            web.CoreWebView2.PostSharedBufferToScript(buffer, CoreWebView2SharedBufferAccess.ReadWrite,
                "{\"w\":" + q.W + ",\"h\":" + q.H + ",\"fps\":" + q.Fps + ",\"slots\":" + Slots + "}");
            estado.Text = "Camera \"InkDOS Hub Webcam\" ready (" + q.W + "×" + q.H + "). Choose it in Zoom. On the iPhone, pick " + (q.H >= 2160 ? "4K" : q.H + "p") + " " + q.Fps + " fps.";
            Program.Log("Camera initialization finished.");
        }

        bool preenchendo;
        /* Só a padrão (1080p 30) ou a lista completa, conforme "Custom resolutions". */
        void PreencherLista(Qualidade escolhida)
        {
            preenchendo = true;
            qualidade.Items.Clear();
            if (personalizadas.Checked) qualidade.Items.AddRange(Qualidades);
            else qualidade.Items.Add(Qualidades[0]);
            int i = qualidade.Items.IndexOf(escolhida);
            qualidade.SelectedIndex = i >= 0 ? i : 0;
            preenchendo = false;
        }
        void Salvar()
        {
            try
            {
                using (var chave = Registry.CurrentUser.CreateSubKey(@"Software\InkDOS Hub Webcam"))
                {
                    chave.SetValue("qualidade3", Array.IndexOf(Qualidades, (Qualidade)qualidade.SelectedItem));
                    chave.SetValue("personalizadas", personalizadas.Checked ? 1 : 0);
                }
            }
            catch (Exception) { }
        }

        void Mensagem(object s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!Permitida(e.Source)) return;
            string m;
            try { m = e.TryGetWebMessageAsString(); } catch (Exception) { return; }
            // "frame:<bgrx|rgba>:<posição>" (já no tamanho da câmera) ou
            // "frame:raw:<posição>:<largura>:<altura>:<giro>:<0|1 inteira>" (BGRX cru do WebRTC; o app gira e corta)
            if (m != null && m.StartsWith("frame:", StringComparison.Ordinal))
            {
                var partes = m.Split(':');
                var p = new Pedido();
                if (partes.Length > 2) int.TryParse(partes[2], out p.Slot);
                if (p.Slot < 0 || p.Slot >= Slots) p.Slot = 0;
                p.Bgrx = partes[1] != "rgba";
                if (partes[1] == "raw" && partes.Length > 6)
                {
                    int.TryParse(partes[3], out p.Sw); int.TryParse(partes[4], out p.Sh); int.TryParse(partes[5], out p.Giro);
                    p.Inteira = partes[6] == "1";
                    p.Giro = ((p.Giro % 360) + 360) % 360;
                    p.Cru = p.Sw > 0 && p.Sh > 0 && p.Giro % 90 == 0;
                    if (!p.Cru) return;
                }
                fila.Enqueue(p);
                temQuadro.Set();
            }
            else if (m != null && m.StartsWith("BUF ", StringComparison.Ordinal))
            {
                // atraso do buffer de vídeo agora, medido pela página a cada segundo
                int ms;
                if (int.TryParse(m.Substring(4), out ms)) rotuloBuffer.Text = "Buffer: " + (ms < 0 ? "–" : ms + " ms");
            }
            else if (m != null && m.StartsWith("NATIVO ", StringComparison.Ordinal)) IniciarNativo(m.Substring(7).Trim());
            else if (m != null && m.StartsWith("PERFJS ", StringComparison.Ordinal)) Program.Log(m.Length > 300 ? m.Substring(0, 300) : m);
        }

        /* Receptor nativo não tem prévia: janela compacta, só a barra e o cartão do QR. */
        void Tamanho()
        {
            if (nativo.Checked) { MinimumSize = new Size(520, 300); ClientSize = new Size(760, 480); }
            else { MinimumSize = new Size(520, 420); ClientSize = new Size(960, 640); }
        }

        string Endereco() { return Pagina + (nativo.Checked ? "&nativo=1" : ""); }

        /* Receptor nativo (Nativo.cs): o app recebe o vídeo com o GStreamer e a página só mostra o QR. */
        void IniciarNativo(string codigo)
        {
            if (!nativo.Checked || codigo.Length != 10) return;
            if (receptor != null && codigo == codigoNativo) return;
            PararNativo();
            var erro = Gst.Iniciar();
            if (erro != null)
            {
                Program.Log("NATIVO: unavailable: " + erro);
                estado.Text = "Native receiver unavailable: " + erro;
                ParaPagina("nat:estado:Native receiver unavailable. Reinstall the Windows app.");
                return;
            }
            codigoNativo = codigo;
            receptor = new ReceptorNativo(codigo, EntregarNativo);
            receptor.Estado += s => ParaPagina("nat:estado:" + s);
            receptor.Conectado += ligado => ParaPagina(ligado ? "nat:on" : "nat:off");
        }
        void PararNativo()
        {
            if (receptor != null) { receptor.Dispose(); receptor = null; }
            codigoNativo = null;
        }
        void ParaPagina(string m)
        {
            try { BeginInvoke((Action)delegate { if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsString(m); }); } catch (Exception) { }
        }

        long nativoJanela = Stopwatch.GetTimestamp(), nativoQuadros;
        double nativoConversao;
        /* Quadro BGRA do GStreamer (thread do receptor) para a câmera virtual. */
        void EntregarNativo(IntPtr bgra, int sw, int sh)
        {
            var r = receptor;
            string view = r != null ? r.Visualizacao : "preencher";
            int giro = view == "gira90" ? 90 : view == "gira270" ? 270 : 0;
            lock (trava)
            {
                if (camera == IntPtr.Zero || bgr == null || atual == null) return;
                long t0 = Stopwatch.GetTimestamp();
                unsafe
                {
                    fixed (byte* d = bgr)
                    {
                        if (sw == atual.W && sh == atual.H && giro == 0) Converter(bgra, (IntPtr)d, sw * sh, true);
                        else Transformar(bgra, sw, sh, giro, view == "ajustar", (IntPtr)d, atual.W, atual.H);
                        Softcam.scSendFrame(camera, (IntPtr)d);
                    }
                }
                nativoConversao += (Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency;
            }
            nativoQuadros++;
            long agora = Stopwatch.GetTimestamp();
            double seg = (agora - nativoJanela) / (double)Stopwatch.Frequency;
            if (seg >= 1)
            {
                double fps = nativoQuadros / seg, ms = nativoConversao / Math.Max(1, nativoQuadros);
                string texto = "Native: " + sw + "×" + sh + " · " + fps.ToString("F0") + " fps";
                try { BeginInvoke((Action)delegate { rotuloBuffer.Text = texto; }); } catch (Exception) { }
                if (DateTime.Now.Second % 5 == 0) Program.Log("PERF native in=" + sw + "x" + sh + " fps=" + fps.ToString("F1") + " copy_avg_ms=" + ms.ToString("F2"));
                nativoJanela = agora; nativoQuadros = 0; nativoConversao = 0;
            }
        }

        /* 4 bytes por pixel (BGRX ou RGBA) para os 3 bytes BGR que o softcam pede, em faixas paralelas. */
        static void Converter(IntPtr origem, IntPtr destino, int n, bool bgrx)
        {
            int faixas = Math.Max(1, Math.Min(Environment.ProcessorCount, 8));
            int porFaixa = (n + faixas - 1) / faixas;
            Parallel.For(0, faixas, k =>
            {
                int ini = k * porFaixa, fim = Math.Min(n, ini + porFaixa);
                unsafe
                {
                    byte* src = (byte*)origem.ToPointer() + (long)ini * 4;
                    byte* dst = (byte*)destino.ToPointer() + (long)ini * 3;
                    if (bgrx)
                        for (int i = ini; i < fim; i++, src += 4, dst += 3) { dst[0] = src[0]; dst[1] = src[1]; dst[2] = src[2]; }
                    else
                        for (int i = ini; i < fim; i++, src += 4, dst += 3) { dst[0] = src[2]; dst[1] = src[1]; dst[2] = src[0]; }
                }
            });
        }

        /* BGRX cru (sw×sh) para BGR no tamanho da câmera: gira (0/90/180/270, sentido horário), preenche
           16:9 cortando as bordas ou mostra inteira com faixas pretas, por vizinho mais próximo, em faixas
           paralelas. Substitui o canvas da página, que custava ~130 ms por quadro a 4K. */
        static void Transformar(IntPtr origem, int sw, int sh, int giro, bool inteira, IntPtr destino, int W, int H)
        {
            bool deitado = giro == 90 || giro == 270;
            int rw = deitado ? sh : sw, rh = deitado ? sw : sh;   // tamanho depois do giro
            double esc = inteira ? Math.Min((double)W / rw, (double)H / rh) : Math.Max((double)W / rw, (double)H / rh);
            // coordenada na imagem girada para cada coluna x e linha y da câmera (-1 = fora: preto)
            int[] us = new int[W], vs = new int[H];
            for (int x = 0; x < W; x++) { int u = (int)Math.Floor((x + 0.5 - W / 2.0) / esc + rw / 2.0); us[x] = u >= 0 && u < rw ? u : -1; }
            for (int y = 0; y < H; y++) { int v = (int)Math.Floor((y + 0.5 - H / 2.0) / esc + rh / 2.0); vs[y] = v >= 0 && v < rh ? v : -1; }
            int faixas = Math.Max(1, Math.Min(Environment.ProcessorCount, 8));
            int porFaixa = (H + faixas - 1) / faixas;
            Parallel.For(0, faixas, k =>
            {
                int ini = k * porFaixa, fim = Math.Min(H, ini + porFaixa);
                unsafe
                {
                    uint* src = (uint*)origem.ToPointer();
                    for (int y = ini; y < fim; y++)
                    {
                        byte* dst = (byte*)destino.ToPointer() + (long)y * W * 3;
                        int v = vs[y];
                        for (int x = 0; x < W; x++, dst += 3)
                        {
                            int u = us[x];
                            if (u < 0 || v < 0) { dst[0] = 0; dst[1] = 0; dst[2] = 0; continue; }
                            int sx, sy;
                            // ponto (u,v) da imagem girada -> ponto da imagem crua
                            if (giro == 0) { sx = u; sy = v; }
                            else if (giro == 90) { sx = v; sy = sh - 1 - u; }
                            else if (giro == 180) { sx = sw - 1 - u; sy = sh - 1 - v; }
                            else { sx = sw - 1 - v; sy = u; }
                            uint c = src[(long)sy * sw + sx];
                            dst[0] = (byte)c; dst[1] = (byte)(c >> 8); dst[2] = (byte)(c >> 16);
                        }
                    }
                }
            });
        }

        /* Mede separadamente conversão e envio à câmera virtual para localizar gargalos. */
        void Enviar()
        {
            long janelaInicio = Stopwatch.GetTimestamp();
            long quadros = 0, somaConversao = 0, maxConversao = 0, somaEnvio = 0, maxEnvio = 0;
            while (rodando)
            {
                temQuadro.WaitOne();
                if (!rodando) break;
                Pedido item;
                while (rodando && fila.TryDequeue(out item))
                {
                int slotAtual = item.Slot;
                bool bgrx = item.Bgrx;
                lock (trava)
                {
                    if (camera != IntPtr.Zero && bufferPointer != IntPtr.Zero && bgr != null && atual != null)
                    {
                        int n = atual.W * atual.H;
                        unsafe
                        {
                            // Não acessa propriedades WebView2/COM nesta thread de fundo.
                            fixed (byte* dst0 = bgr)
                            {
                                long inicioConversao = Stopwatch.GetTimestamp();
                                IntPtr origemSlot = bufferPointer + (int)((long)slotAtual * n * 4);
                                if (!item.Cru)
                                    Converter(origemSlot, (IntPtr)dst0, n, bgrx);
                                else if ((long)item.Sw * item.Sh <= n)
                                    Transformar(origemSlot, item.Sw, item.Sh, item.Giro, item.Inteira, (IntPtr)dst0, atual.W, atual.H);
                                // (quadro cru maior que o buffer: a página não manda; se mandar, repete o último quadro)
                                long conversao = Stopwatch.GetTimestamp() - inicioConversao;
                                long inicioEnvio = Stopwatch.GetTimestamp();
                                Softcam.scSendFrame(camera, (IntPtr)dst0);
                                long envio = Stopwatch.GetTimestamp() - inicioEnvio;

                                quadros++;
                                somaConversao += conversao;
                                somaEnvio += envio;
                                if (conversao > maxConversao) maxConversao = conversao;
                                if (envio > maxEnvio) maxEnvio = envio;
                            }
                        }
                    }
                }
                long agora = Stopwatch.GetTimestamp();
                if (agora - janelaInicio >= Stopwatch.Frequency * 5)
                {
                    double segundos = (double)(agora - janelaInicio) / Stopwatch.Frequency;
                    if (quadros > 0)
                    {
                        double fatorMs = 1000.0 / Stopwatch.Frequency;
                        Program.Log("PERF camera=" + atual.W + "x" + atual.H + "@" + atual.Fps
                            + " delivered_fps=" + (quadros / segundos).ToString("F1")
                            + " convert_avg_ms=" + (somaConversao / (double)quadros * fatorMs).ToString("F2")
                            + " convert_max_ms=" + (maxConversao * fatorMs).ToString("F2")
                            + " send_avg_ms=" + (somaEnvio / (double)quadros * fatorMs).ToString("F2")
                            + " send_max_ms=" + (maxEnvio * fatorMs).ToString("F2")
                            + " frames=" + quadros);
                    }
                    else Program.Log("PERF: no frames delivered during last " + segundos.ToString("F1") + " seconds.");
                    janelaInicio = agora;
                    quadros = somaConversao = maxConversao = somaEnvio = maxEnvio = 0;
                }
                string resposta = "ok:" + slotAtual;
                try { BeginInvoke((Action)delegate { if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsString(resposta); }); } catch (Exception) { }
                }
            }
        }
    }
}
