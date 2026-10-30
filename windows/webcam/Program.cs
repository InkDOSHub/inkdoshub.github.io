// InkDOS Hub Webcam para Windows: a câmera do iPhone como webcam do Windows, sem o OBS e sem navegador.
//
// O iPhone abre a página Host do app Webcam (https://inkdoshub.github.io/apps/webcam/?host=<código>) no Safari.
// Este programa faz o papel da página Guest, todo nativo: mostra o QR e o código, conversa com o servidor do
// PeerJS e recebe o vídeo com o GStreamer (Nativo.cs). Cada quadro vai para uma câmera virtual do Windows
// (softcam, DirectShow), que o Zoom, o Teams, o Meet e os outros apps enxergam como "InkDOS Hub Webcam".
// Não usa o WebView2 nem o Edge.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
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
        // o iPhone abre esta página (Host) e liga para "inkdoshub-webcam-<código>"
        const string Host = "https://inkdoshub.github.io/apps/webcam/?host=";
        const string Letras = "abcdefghjkmnpqrstuvwxyz23456789";
        static readonly bool Pt = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "pt";
        static string Tx(string pt, string en) { return Pt ? pt : en; }

        static readonly Qualidade[] Qualidades =
        {
            // a primeira é a padrão; as outras só aparecem com "Outras resoluções"
            // (bitrate médio = o que o iPhone manda em cada modo)
            new Qualidade(Tx("1080p 30 fps · ~8 Mbps · leve (recomendada)", "1080p 30 fps · ~8 Mbps · light (recommended)"), 1920, 1080, 30),
            new Qualidade(Tx("720p 30 fps · ~4 Mbps · a mais leve", "720p 30 fps · ~4 Mbps · lightest"), 1280, 720, 30),
            new Qualidade(Tx("720p 60 fps · ~6 Mbps · leve", "720p 60 fps · ~6 Mbps · light"), 1280, 720, 60),
            new Qualidade(Tx("1080p 60 fps · ~15 Mbps · média", "1080p 60 fps · ~15 Mbps · medium"), 1920, 1080, 60),
            new Qualidade(Tx("4K 30 fps · ~25 Mbps · muito pesada", "4K 30 fps · ~25 Mbps · very heavy"), 3840, 2160, 30),
            new Qualidade(Tx("4K 60 fps · ~40 Mbps · extrema", "4K 60 fps · ~40 Mbps · extreme"), 3840, 2160, 60),
        };

        // cores da tela inicial do InkDOS Hub (assets/home.css), claro e escuro conforme o Windows
        static readonly bool Escuro = LerEscuro();
        static bool LerEscuro()
        {
            try { return (int)(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) ?? 1) == 0; }
            catch (Exception) { return false; }
        }
        static readonly Color Fundo = Escuro ? Color.FromArgb(28, 28, 30) : Color.FromArgb(245, 245, 247);
        static readonly Color CorCartao = Escuro ? Color.FromArgb(44, 44, 46) : Color.White;
        static readonly Color Texto = Escuro ? Color.FromArgb(245, 245, 247) : Color.FromArgb(29, 29, 31);
        static readonly Color Fraco = Escuro ? Color.FromArgb(152, 152, 157) : Color.FromArgb(110, 110, 115);
        static readonly Color Verde = Color.FromArgb(31, 157, 85);

        readonly CheckBox personalizadas = new CheckBox();
        readonly ComboBox qualidade = new ComboBox();
        readonly Label taxa = new Label();
        readonly Panel cartao = new Panel();
        readonly Label aviso = new Label(), codigoTexto = new Label(), estado = new Label(), cameraTexto = new Label();
        readonly PictureBox qr = new PictureBox();
        readonly Button novo = new Button();
        ReceptorNativo receptor;
        string codigo;
        bool ligado;
        IntPtr camera = IntPtr.Zero;
        byte[] bgr;
        Qualidade atual;
        readonly object trava = new object();

        public Janela()
        {
            Text = "InkDOS Hub Webcam";
            ClientSize = new Size(640, 560);
            MinimumSize = new Size(480, 480);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Fundo; ForeColor = Texto;
            Font = new Font("Segoe UI", 10f);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            // barra de cima: qualidade da câmera virtual
            var barra = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 46, Padding = new Padding(10, 10, 10, 0), BackColor = CorCartao, WrapContents = false };
            qualidade.DropDownStyle = ComboBoxStyle.DropDownList;
            qualidade.Width = 300;
            qualidade.FlatStyle = FlatStyle.Flat;
            personalizadas.Text = Tx("Outras resoluções", "Custom resolutions");
            personalizadas.AutoSize = true;
            personalizadas.Margin = new Padding(10, 4, 0, 0);
            taxa.AutoSize = true; taxa.ForeColor = Fraco; taxa.Margin = new Padding(12, 5, 0, 0);
            barra.Controls.Add(new Label { Text = Tx("Qualidade:", "Quality:"), AutoSize = true, Margin = new Padding(0, 5, 6, 0) });
            barra.Controls.Add(qualidade);
            barra.Controls.Add(personalizadas);
            barra.Controls.Add(taxa);

            // cartão do pareamento: QR, código e estado (o que antes era a página no WebView2)
            cartao.BackColor = CorCartao;
            qr.SizeMode = PictureBoxSizeMode.Zoom; qr.BackColor = Color.White;
            aviso.Text = Tx("Aponte a Câmera do iPhone para o QR code. Ou abra a Webcam do InkDOS Hub no iPhone, toque em Host e digite o código.",
                "Scan it with the iPhone Camera app, or open the InkDOS Hub Webcam on the iPhone, tap Host and type the code.");
            foreach (var l in new[] { aviso, codigoTexto, estado, cameraTexto }) { l.AutoSize = false; l.TextAlign = ContentAlignment.TopCenter; l.BackColor = CorCartao; }
            aviso.ForeColor = Fraco; cameraTexto.ForeColor = Fraco;
            codigoTexto.Font = new Font("Segoe UI Semibold", 13f);
            novo.Text = Tx("Novo código", "New code");
            novo.FlatStyle = FlatStyle.Flat; novo.AutoSize = true; novo.BackColor = CorCartao; novo.ForeColor = Texto;
            novo.FlatAppearance.BorderColor = Escuro ? Color.FromArgb(70, 70, 74) : Color.FromArgb(220, 220, 224);
            novo.Click += delegate { Codigo(NovoCodigo()); };
            cartao.Controls.AddRange(new Control[] { qr, aviso, codigoTexto, estado, novo, cameraTexto });
            cartao.Paint += (s, e) => { using (var p = new Pen(Escuro ? Color.FromArgb(60, 60, 64) : Color.FromArgb(226, 226, 230))) e.Graphics.DrawRectangle(p, 0, 0, cartao.Width - 1, cartao.Height - 1); };
            Controls.Add(cartao);
            Controls.Add(barra);
            Resize += delegate { Arrumar(); };

            int salvo = 0; bool todas = false;
            try
            {
                using (var chave = Registry.CurrentUser.CreateSubKey(@"Software\InkDOS Hub Webcam"))
                {
                    salvo = Convert.ToInt32(chave.GetValue("qualidade3", 0));
                    todas = Convert.ToInt32(chave.GetValue("personalizadas", 0)) == 1;
                    codigo = chave.GetValue("codigo", "") as string;
                }
            }
            catch (Exception) { }
            if (salvo < 0 || salvo >= Qualidades.Length) salvo = 0;
            if (salvo != 0) todas = true;
            personalizadas.Checked = todas;
            PreencherLista(Qualidades[salvo]);
            qualidade.SelectedIndexChanged += delegate { if (preenchendo) return; Salvar(); AbrirCamera(); };
            personalizadas.CheckedChanged += delegate
            {
                var antes = (Qualidade)qualidade.SelectedItem;
                PreencherLista(personalizadas.Checked ? antes : Qualidades[0]);
                Salvar();
                if (qualidade.SelectedItem != antes) AbrirCamera();
            };

            Load += delegate
            {
                AbrirCamera();
                Codigo(codigo != null && codigo.Length == 10 ? codigo : NovoCodigo());
            };
            FormClosing += delegate
            {
                Parar();
                lock (trava)
                {
                    if (camera != IntPtr.Zero) Softcam.scDeleteCamera(camera);
                    camera = IntPtr.Zero;
                }
            };
        }

        void Arrumar()
        {
            int w = Math.Min(420, ClientSize.Width - 40), top = 46 + 20;
            int lado = Math.Max(140, Math.Min(240, ClientSize.Height - top - 250));
            cartao.SetBounds((ClientSize.Width - w) / 2, top, w, ClientSize.Height - top - 20);
            int y = 20, iw = w - 40;
            qr.Visible = !ligado;
            if (!ligado) { qr.SetBounds((w - lado) / 2, y, lado, lado); y += lado + 14; }
            aviso.Visible = !ligado;
            if (!ligado) { aviso.SetBounds(20, y, iw, TextRenderer.MeasureText(aviso.Text, aviso.Font, new Size(iw, 0), TextFormatFlags.WordBreak).Height + 4); y = aviso.Bottom + 10; }
            codigoTexto.SetBounds(20, y, iw, 30); y += 34;
            estado.SetBounds(20, y, iw, TextRenderer.MeasureText(estado.Text, estado.Font, new Size(iw, 0), TextFormatFlags.WordBreak).Height + 4); y = estado.Bottom + 10;
            novo.Location = new Point((w - novo.Width) / 2, y); y = novo.Bottom + 12;
            cameraTexto.SetBounds(20, y, iw, TextRenderer.MeasureText(cameraTexto.Text, cameraTexto.Font, new Size(iw, 0), TextFormatFlags.WordBreak).Height + 4);
            cartao.Invalidate();
        }

        static string NovoCodigo()
        {
            var b = new byte[10];
            using (var r = new System.Security.Cryptography.RNGCryptoServiceProvider()) r.GetBytes(b);
            var s = new StringBuilder();
            foreach (byte x in b) s.Append(Letras[x % Letras.Length]);
            return s.ToString();
        }

        /* Mostra o QR deste código e liga o receptor nativo (Nativo.cs) com ele. */
        void Codigo(string c)
        {
            codigo = c;
            try { using (var chave = Registry.CurrentUser.CreateSubKey(@"Software\InkDOS Hub Webcam")) chave.SetValue("codigo", c); } catch (Exception) { }
            var m = Qr.Gerar(Host + c);
            int n = m.GetLength(0), borda = 2, esc = 8;
            var bmp = new Bitmap((n + borda * 2) * esc, (n + borda * 2) * esc);
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.White);
                for (int y = 0; y < n; y++) for (int x = 0; x < n; x++) if (m[y, x]) g.FillRectangle(Brushes.Black, (x + borda) * esc, (y + borda) * esc, esc, esc);
            }
            if (qr.Image != null) qr.Image.Dispose();
            qr.Image = bmp;
            codigoTexto.Text = Tx("Código: ", "Code: ") + c;
            Ligar(false);
            Parar();
            var erro = Gst.Iniciar();
            if (erro != null)
            {
                Program.Log("NATIVO: unavailable: " + erro);
                Estado(Tx("O receptor não abriu. Baixe o app de novo. ", "The receiver did not start. Download the app again. ") + erro);
                return;
            }
            receptor = new ReceptorNativo(c, EntregarNativo);
            receptor.Estado += s => { try { BeginInvoke((Action)delegate { Estado(Traduzir(s)); }); } catch (Exception) { } };
            receptor.Conectado += l => { try { BeginInvoke((Action)delegate { Ligar(l); }); } catch (Exception) { } };
        }

        void Parar() { if (receptor != null) { receptor.Dispose(); receptor = null; } }
        void Estado(string s) { estado.Text = s; Arrumar(); }
        void Ligar(bool l)
        {
            ligado = l;
            estado.ForeColor = l ? Verde : Texto;
            if (!l) taxa.Text = "";
            Arrumar();
        }

        // os avisos do receptor vêm em inglês; em português, traduz os conhecidos
        static string Traduzir(string s)
        {
            if (!Pt) return s;
            switch (s)
            {
                case "Connecting to the pairing server…": return "Conectando ao servidor de pareamento…";
                case "No connection to the pairing server. Trying again…": return "Sem conexão com o servidor de pareamento. Tentando de novo…";
                case "Ready. Waiting for the iPhone…": return "Pronto. Esperando o iPhone…";
                case "This code is open in another window (another tab or OBS). Trying again…": return "Este código está aberto em outra janela (outra aba ou o OBS). Tentando de novo…";
                case "Connecting to the iPhone…": return "Conectando ao iPhone…";
                case "Receiving from the iPhone (native receiver).": return "Recebendo a imagem do iPhone.";
                default: return s;
            }
        }

        /* Cria a câmera virtual no tamanho escolhido. */
        void AbrirCamera(int tentativa = 0)
        {
            var q = (Qualidade)qualidade.SelectedItem;
            if (q == null) return;
            Program.Log("AbrirCamera quality=" + q.W + "x" + q.H + "@" + q.Fps);
            lock (trava)
            {
                if (camera != IntPtr.Zero && atual != null && (atual.W != q.W || atual.H != q.H || atual.Fps != q.Fps))
                {
                    Softcam.scDeleteCamera(camera);
                    camera = IntPtr.Zero;
                }
                // framerate 0: cada quadro vai na hora (com fps fixo o scSendFrame "dorme" e soma atraso)
                if (camera == IntPtr.Zero) camera = Softcam.scCreateCamera(q.W, q.H, 0);
                if (camera != IntPtr.Zero) { bgr = new byte[q.W * q.H * 3]; atual = q; }
            }
            if (camera == IntPtr.Zero)
            {
                Program.Log("CAMERA INIT FAILED retry=" + tentativa);
                if (tentativa < 3)
                {
                    cameraTexto.Text = Tx("A câmera não abriu; tentando de novo. Veja se outro app está usando a InkDOS Hub Webcam.", "Camera initialization failed; retrying. Check whether another app is using InkDOS Hub Webcam.");
                    Task.Delay(350).ContinueWith(delegate { try { BeginInvoke((Action)delegate { if (!IsDisposed && qualidade.SelectedItem == q) AbrirCamera(tentativa + 1); }); } catch (Exception) { } });
                }
                else cameraTexto.Text = Tx("A câmera não abriu. Feche o Zoom ou o Teams e escolha a qualidade de novo.", "Camera could not be created. Close Zoom/Teams and choose the quality again.");
                Arrumar();
                return;
            }
            string modo = (q.H >= 2160 ? "4K" : q.H + "p") + " " + q.Fps + " fps";
            cameraTexto.Text = Tx("Câmera \"InkDOS Hub Webcam\" pronta (" + q.W + "×" + q.H + "). Escolha-a no Zoom. No iPhone, escolha " + modo + ".",
                "Camera \"InkDOS Hub Webcam\" ready (" + q.W + "×" + q.H + "). Choose it in Zoom. On the iPhone, pick " + modo + ".");
            Arrumar();
        }

        bool preenchendo;
        /* Só a padrão (1080p 30) ou a lista completa, conforme "Outras resoluções". */
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
                try { BeginInvoke((Action)delegate { taxa.Text = texto; }); } catch (Exception) { }
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

    }
}
