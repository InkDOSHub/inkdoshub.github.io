// InkDOS Hub Transferir (protótipo).
//
// Transferência rápida celular <-> PC sem internet, sem servidor e sem admin.
// Duas formas de conexão:
//  - Wi-Fi direto: o PC cria uma rede Wi-Fi própria (Wi-Fi Direct no modo "legado", API do Windows
//    que não pede admin). O celular entra nela como numa Wi-Fi comum.
//  - Pelo roteador: usa a rede que o PC já tem (cabo ou Wi-Fi); o celular precisa estar na mesma rede.
// Nos dois casos o celular abre no navegador a página servida por este programa (http://IP:porta/).
// O painel do PC abre no navegador do próprio PC (http://localhost:porta/pc).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Windows.Devices.WiFiDirect;
using Windows.Security.Credentials;

namespace InkDOSHubTransferir
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Janela());
        }
    }

    class Janela : Form
    {
        readonly Servidor srv;
        readonly Label info;

        public Janela()
        {
            Text = "InkDOS Hub Transferir";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            ClientSize = new Size(420, 170);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 10f);

            info = new Label { Left = 16, Top = 14, Width = 390, Height = 70, Text = "Iniciando…" };
            var bPainel = new Button { Text = "Abrir painel", Left = 16, Top = 100, Width = 130, Height = 34 };
            var bPasta = new Button { Text = "Pasta recebidos", Left = 156, Top = 100, Width = 140, Height = 34 };
            var bSair = new Button { Text = "Sair", Left = 306, Top = 100, Width = 98, Height = 34 };
            Controls.AddRange(new Control[] { info, bPainel, bPasta, bSair });

            srv = new Servidor(this);
            bPainel.Click += delegate { srv.AbrirPainel(); };
            bPasta.Click += delegate { srv.AbrirPasta(); };
            bSair.Click += delegate { Close(); };
            Load += delegate
            {
                try
                {
                    srv.Iniciar();
                    info.Text = "Funcionando. O painel abre no navegador do PC.\nMantenha esta janela aberta durante a transferência.\nRecebidos: " + srv.Pasta;
                    srv.AbrirPainel();
                }
                catch (Exception e) { info.Text = "Erro ao iniciar: " + e.Message; }
            };
            FormClosing += delegate { srv.Parar(); };
        }
    }

    class Transf
    {
        public int Id;
        public string Nome, Dir;
        public long Total, Feito, FeitoAnt;
        public DateTime Ini = DateTime.UtcNow, TAnt = DateTime.UtcNow;
        public DateTime? Fim;
        public double Vel;
        public bool Erro;
    }

    class Oferta { public int Id; public string Caminho, Nome; public long Tam; }

    class Servidor
    {
        readonly Form ui;
        TcpListener tcp;
        volatile bool rodando;
        public int Porta;
        public string Pasta;

        readonly object trava = new object();
        readonly List<Transf> transfs = new List<Transf>();
        readonly List<Oferta> ofertas = new List<Oferta>();
        int prox = 1;
        string modo = "";
        string diagCelular = "null";
        int diagPedido;
        DateTime celularVisto = DateTime.MinValue;
        string celularIp = "";

        WiFiDirectAdvertisementPublisher pub;
        WiFiDirectConnectionListener ouvinte;
        string ssid = "", senha = "", statusDireto = "";
        // chave que vai no QR: sem ela, outro aparelho da mesma rede não acessa nada
        readonly string chave = Aleatorio("abcdefghjkmnpqrstuvwxyz23456789", 8);

        public Servidor(Form ui) { this.ui = ui; }

        public void Iniciar()
        {
            Pasta = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "InkDOS Hub Transferir");
            Directory.CreateDirectory(Pasta);
            for (int p = 47800; p < 47820; p++)
            {
                try { tcp = new TcpListener(IPAddress.Any, p); tcp.Start(); Porta = p; break; }
                catch (SocketException) { tcp = null; }
            }
            if (tcp == null) throw new Exception("nenhuma porta livre entre 47800 e 47819");
            rodando = true;
            new Thread(Aceitar) { IsBackground = true }.Start();
        }

        public void Parar()
        {
            rodando = false;
            PararDireto();
            try { tcp.Stop(); } catch { }
        }

        public void AbrirPainel() { try { Process.Start("http://localhost:" + Porta + "/pc"); } catch { } }
        public void AbrirPasta() { try { Process.Start("explorer.exe", "\"" + Pasta + "\""); } catch { } }

        // ---------- Wi-Fi direto ----------

        static readonly Random rnd = new Random();
        static string Aleatorio(string alfabeto, int n)
        {
            var sb = new StringBuilder();
            lock (rnd) for (int i = 0; i < n; i++) sb.Append(alfabeto[rnd.Next(alfabeto.Length)]);
            return sb.ToString();
        }

        void IniciarDireto()
        {
            PararDireto();
            ssid = "InkDOS-" + Aleatorio("0123456789", 4);
            senha = Aleatorio("abcdefghjkmnpqrstuvwxyz23456789", 10);
            statusDireto = "Criando a rede…";
            try
            {
                pub = new WiFiDirectAdvertisementPublisher();
                pub.Advertisement.IsAutonomousGroupOwnerEnabled = true;
                pub.Advertisement.LegacySettings.IsEnabled = true;
                pub.Advertisement.LegacySettings.Ssid = ssid;
                var cred = new PasswordCredential();
                cred.Password = senha;
                pub.Advertisement.LegacySettings.Passphrase = cred;
                pub.StatusChanged += (s, a) =>
                {
                    statusDireto = a.Status.ToString() + (a.Error != WiFiDirectError.Success ? " (" + a.Error + ")" : "");
                };
                // aparelhos com Wi-Fi Direct de verdade também podem pedir conexão; aceita sem fazer nada
                ouvinte = new WiFiDirectConnectionListener();
                ouvinte.ConnectionRequested += (s, a) => { };
                pub.Start();
            }
            catch (Exception e)
            {
                statusDireto = "Erro: " + e.Message;
            }
        }

        void PararDireto()
        {
            try { if (pub != null) pub.Stop(); } catch { }
            pub = null;
            ouvinte = null;
            statusDireto = "";
        }

        // ---------- HTTP ----------

        void Aceitar()
        {
            while (rodando)
            {
                TcpClient c;
                try { c = tcp.AcceptTcpClient(); } catch { break; }
                new Thread(() => Atender(c)) { IsBackground = true }.Start();
            }
        }

        void Atender(TcpClient c)
        {
            try
            {
                c.NoDelay = true;
                c.ReceiveBufferSize = 1 << 20;
                c.SendBufferSize = 1 << 20;
                var s = c.GetStream();
                var remoto = ((IPEndPoint)c.Client.RemoteEndPoint).Address;
                bool local = IPAddress.IsLoopback(remoto);
                if (!local) { celularVisto = DateTime.UtcNow; celularIp = remoto.ToString(); }

                string metodo, alvo; Dictionary<string, string> cab; byte[] sobra;
                if (!LerCabecalho(s, out metodo, out alvo, out cab, out sobra)) return;
                string caminho = alvo; var q = new Dictionary<string, string>();
                int iq = alvo.IndexOf('?');
                if (iq >= 0)
                {
                    caminho = alvo.Substring(0, iq);
                    foreach (var par in alvo.Substring(iq + 1).Split('&'))
                    {
                        int ie = par.IndexOf('=');
                        if (ie > 0) q[Dec(par.Substring(0, ie))] = Dec(par.Substring(ie + 1));
                    }
                }
                long tam = 0;
                string cl;
                if (cab.TryGetValue("content-length", out cl)) long.TryParse(cl, out tam);
                var corpo = new Corpo(s, sobra, tam);
                string k;
                if (!local && caminho != "/qrcode.js" && (!q.TryGetValue("k", out k) || k != chave))
                {
                    Texto(s, 403, "Abra pelo QR code mostrado no PC.");
                    return;
                }

                switch (caminho)
                {
                    case "/": Recurso(s, "celular.html", "text/html; charset=utf-8"); break;
                    case "/qrcode.js": Recurso(s, "qrcode.js", "application/javascript"); break;
                    case "/pc":
                        if (local) Recurso(s, "pc.html", "text/html; charset=utf-8"); else Texto(s, 403, "so no PC");
                        break;
                    case "/ping": Texto(s, 200, "ok"); break;
                    case "/arquivos": Json(s, JsonOfertas()); break;
                    case "/baixar": Baixar(s, q); break;
                    case "/enviar": Receber(s, q, corpo, tam); break;
                    case "/teste":
                        if (metodo == "POST") TesteSubida(s, corpo, tam); else TesteDescida(s, q);
                        break;
                    case "/diag":
                        var d = Encoding.UTF8.GetString(corpo.LerTudo(65536)).Trim();
                        diagCelular = d.StartsWith("{") && d.EndsWith("}") && !d.Contains("<") ? d : "null";
                        Texto(s, 200, "ok");
                        break;
                    default:
                        if (!local) { Texto(s, 404, "nao encontrado"); break; }
                        Painel(s, caminho, q);
                        break;
                }
            }
            catch { }
            finally { try { c.Close(); } catch { } }
        }

        // rotas só do painel do PC (localhost)
        void Painel(NetworkStream s, string caminho, Dictionary<string, string> q)
        {
            switch (caminho)
            {
                case "/estado": Json(s, JsonEstado()); break;
                case "/modo":
                    string m; q.TryGetValue("m", out m);
                    lock (trava) modo = m == "direto" || m == "roteador" ? m : "";
                    if (m == "direto") IniciarDireto(); else PararDireto();
                    Json(s, JsonEstado());
                    break;
                case "/escolher":
                    ui.Invoke((Action)delegate
                    {
                        using (var d = new OpenFileDialog { Multiselect = true, Title = "Arquivos para o celular" })
                        {
                            if (d.ShowDialog(ui) != DialogResult.OK) return;
                            lock (trava)
                                foreach (var f in d.FileNames)
                                    ofertas.Add(new Oferta { Id = prox++, Caminho = f, Nome = Path.GetFileName(f), Tam = new FileInfo(f).Length });
                        }
                    });
                    Json(s, JsonOfertas());
                    break;
                case "/remover":
                    string id; q.TryGetValue("id", out id);
                    lock (trava) ofertas.RemoveAll(o => o.Id.ToString() == id);
                    Json(s, JsonOfertas());
                    break;
                case "/pasta": AbrirPasta(); Texto(s, 200, "ok"); break;
                case "/pedirdiag": Interlocked.Increment(ref diagPedido); Texto(s, 200, "ok"); break;
                case "/wifi": Json(s, JsonWifi()); break;
                default: Texto(s, 404, "nao encontrado"); break;
            }
        }

        Transf NovaTransf(string nome, string dir, long total)
        {
            var t = new Transf { Nome = nome, Dir = dir, Total = total };
            lock (trava)
            {
                t.Id = prox++;
                transfs.Add(t);
                if (transfs.Count > 30) transfs.RemoveAt(0);
            }
            return t;
        }

        const int BUF = 1 << 20;

        void Receber(NetworkStream s, Dictionary<string, string> q, Corpo corpo, long tam)
        {
            string nome; q.TryGetValue("nome", out nome);
            nome = Limpar(nome);
            string destino = Path.Combine(Pasta, nome);
            for (int i = 2; File.Exists(destino); i++)
                destino = Path.Combine(Pasta, Path.GetFileNameWithoutExtension(nome) + " (" + i + ")" + Path.GetExtension(nome));
            var t = NovaTransf(Path.GetFileName(destino), "recebendo", tam);
            try
            {
                using (var f = new FileStream(destino, FileMode.CreateNew, FileAccess.Write, FileShare.Read, BUF))
                {
                    var b = new byte[BUF]; int n;
                    while (t.Feito < tam && (n = corpo.Read(b, 0, b.Length)) > 0) { f.Write(b, 0, n); t.Feito += n; }
                }
                if (t.Feito < tam) throw new IOException("incompleto");
                t.Fim = DateTime.UtcNow;
                Texto(s, 200, "ok");
            }
            catch
            {
                t.Erro = true; t.Fim = DateTime.UtcNow;
                try { File.Delete(destino); } catch { }
                throw;
            }
        }

        void Baixar(NetworkStream s, Dictionary<string, string> q)
        {
            string id; q.TryGetValue("id", out id);
            Oferta o;
            lock (trava) o = ofertas.FirstOrDefault(x => x.Id.ToString() == id);
            if (o == null || !File.Exists(o.Caminho)) { Texto(s, 404, "arquivo nao encontrado"); return; }
            using (var f = new FileStream(o.Caminho, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, BUF, FileOptions.SequentialScan))
            {
                var t = NovaTransf(o.Nome, "enviando", f.Length);
                string nomeAscii = new string(o.Nome.Select(ch => ch < 128 && ch != '"' ? ch : '_').ToArray());
                Cabecalho(s, 200, "application/octet-stream", f.Length,
                    "Content-Disposition: attachment; filename=\"" + nomeAscii + "\"; filename*=UTF-8''" + Uri.EscapeDataString(o.Nome) + "\r\n");
                var b = new byte[BUF]; int n;
                try
                {
                    while ((n = f.Read(b, 0, b.Length)) > 0) { s.Write(b, 0, n); t.Feito += n; }
                    t.Fim = DateTime.UtcNow;
                }
                catch { t.Erro = true; t.Fim = DateTime.UtcNow; throw; }
            }
        }

        static readonly byte[] lixo = CriarLixo();
        static byte[] CriarLixo() { var b = new byte[BUF]; new Random(7).NextBytes(b); return b; }

        void TesteDescida(NetworkStream s, Dictionary<string, string> q)
        {
            string smb; q.TryGetValue("mb", out smb);
            int mb; if (!int.TryParse(smb, out mb)) mb = 30;
            mb = Math.Max(1, Math.Min(mb, 500));
            long total = (long)mb * BUF;
            var t = NovaTransf("Diagnóstico: PC → celular", "teste", total);
            Cabecalho(s, 200, "application/octet-stream", total, "");
            try
            {
                for (int i = 0; i < mb; i++) { s.Write(lixo, 0, lixo.Length); t.Feito += lixo.Length; }
                t.Fim = DateTime.UtcNow;
            }
            catch { t.Erro = true; t.Fim = DateTime.UtcNow; throw; }
        }

        void TesteSubida(NetworkStream s, Corpo corpo, long tam)
        {
            var t = NovaTransf("Diagnóstico: celular → PC", "teste", tam);
            var b = new byte[BUF]; int n;
            while (t.Feito < tam && (n = corpo.Read(b, 0, b.Length)) > 0) t.Feito += n;
            t.Fim = DateTime.UtcNow;
            Texto(s, 200, "ok");
        }

        // ---------- JSON ----------

        static string J(string v)
        {
            if (v == null) return "null";
            var sb = new StringBuilder("\"");
            foreach (char ch in v)
            {
                if (ch == '"' || ch == '\\') sb.Append('\\').Append(ch);
                else if (ch < 32) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                else sb.Append(ch);
            }
            return sb.Append('"').ToString();
        }
        static string N(double v) { return v.ToString("0.###", CultureInfo.InvariantCulture); }

        string JsonOfertas()
        {
            lock (trava)
                return "{\"diag\":" + diagPedido + ",\"arquivos\":[" + string.Join(",", ofertas.Select(o =>
                    "{\"id\":" + o.Id + ",\"nome\":" + J(o.Nome) + ",\"tam\":" + o.Tam + "}")) + "]}";
        }

        string JsonEstado()
        {
            var agora = DateTime.UtcNow;
            var ts = new List<string>();
            double velTotal = 0;
            lock (trava)
            {
                foreach (var t in transfs)
                {
                    double dt = (agora - t.TAnt).TotalSeconds;
                    if (dt >= 0.2)
                    {
                        double v = (t.Feito - t.FeitoAnt) / dt;
                        t.Vel = t.Fim.HasValue ? 0 : (t.Vel == 0 ? v : t.Vel * 0.4 + v * 0.6);
                        t.FeitoAnt = t.Feito; t.TAnt = agora;
                    }
                    double media = t.Feito / Math.Max(0.001, ((t.Fim ?? agora) - t.Ini).TotalSeconds);
                    if (!t.Fim.HasValue) velTotal += t.Vel;
                    ts.Add("{\"id\":" + t.Id + ",\"nome\":" + J(t.Nome) + ",\"dir\":" + J(t.Dir) + ",\"total\":" + t.Total +
                        ",\"feito\":" + t.Feito + ",\"vel\":" + N(t.Vel) + ",\"media\":" + N(media) +
                        ",\"fim\":" + (t.Fim.HasValue ? "true" : "false") + ",\"erro\":" + (t.Erro ? "true" : "false") + "}");
                }
            }
            var ips = new List<string>();
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    var p = ni.GetIPProperties();
                    bool gw = p.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
                    bool direto = ni.Description.IndexOf("Wi-Fi Direct", StringComparison.OrdinalIgnoreCase) >= 0;
                    foreach (var a in p.UnicastAddresses)
                        if (a.Address.AddressFamily == AddressFamily.InterNetwork)
                            ips.Add("{\"ip\":" + J(a.Address.ToString()) + ",\"nome\":" + J(ni.Name) + ",\"tipo\":" + J(ni.NetworkInterfaceType.ToString()) +
                                ",\"gw\":" + (gw ? "true" : "false") + ",\"direto\":" + (direto ? "true" : "false") + "}");
                }
            }
            catch { }
            bool celular = (agora - celularVisto).TotalSeconds < 8;
            return "{\"porta\":" + Porta + ",\"chave\":" + J(chave) + ",\"pasta\":" + J(Pasta) + ",\"modo\":" + J(modo) +
                ",\"ssid\":" + J(ssid) + ",\"senha\":" + J(senha) + ",\"statusDireto\":" + J(statusDireto) +
                ",\"celular\":" + (celular ? "true" : "false") + ",\"celularIp\":" + J(celularIp) +
                ",\"vel\":" + N(velTotal) + ",\"diagCelular\":" + diagCelular +
                ",\"ips\":[" + string.Join(",", ips) + "],\"transfs\":[" + string.Join(",", ts) + "]}";
        }

        // dados da placa Wi-Fi do PC (sinal, padrão, canal, taxa); netsh não pede admin
        string JsonWifi()
        {
            var linhas = new List<string>();
            string sinal = null;
            try
            {
                var psi = new ProcessStartInfo("netsh", "wlan show interfaces")
                {
                    UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage)
                };
                using (var p = Process.Start(psi))
                {
                    string saida = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(5000);
                    foreach (var l in saida.Split('\n'))
                    {
                        int i = l.IndexOf(" : ");
                        if (i < 0) continue;
                        string k = l.Substring(0, i).Trim(), v = l.Substring(i + 3).Trim();
                        string kl = k.ToLowerInvariant();
                        if (kl.Contains("bssid") || kl.Contains("guid") || kl.Contains("physical") || kl.Contains("física") || kl.Contains("fisica")) continue;
                        if (v.EndsWith("%") && sinal == null) sinal = v;
                        linhas.Add("[" + J(k) + "," + J(v) + "]");
                    }
                }
            }
            catch (Exception e) { linhas.Add("[\"Erro\"," + J(e.Message) + "]"); }
            return "{\"sinal\":" + J(sinal) + ",\"linhas\":[" + string.Join(",", linhas) + "]}";
        }

        // ---------- utilidades HTTP ----------

        static string Dec(string v) { try { return Uri.UnescapeDataString(v.Replace('+', ' ')); } catch { return v; } }

        static string Limpar(string nome)
        {
            if (string.IsNullOrWhiteSpace(nome)) nome = "arquivo";
            nome = Path.GetFileName(nome.Replace('\\', '/').Split('/').Last());
            foreach (var ch in Path.GetInvalidFileNameChars()) nome = nome.Replace(ch, '_');
            nome = nome.Trim().TrimEnd('.');
            return nome.Length == 0 ? "arquivo" : nome;
        }

        static bool LerCabecalho(NetworkStream s, out string metodo, out string alvo, out Dictionary<string, string> cab, out byte[] sobra)
        {
            metodo = alvo = null; cab = null; sobra = null;
            var buf = new byte[16384]; int len = 0, fim = -1;
            while (fim < 0)
            {
                if (len == buf.Length) return false;
                int n = s.Read(buf, len, buf.Length - len);
                if (n <= 0) return false;
                int de = Math.Max(0, len - 3);
                len += n;
                for (int i = de; i + 3 < len; i++)
                    if (buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10) { fim = i; break; }
            }
            var linhas = Encoding.UTF8.GetString(buf, 0, fim).Split(new[] { "\r\n" }, StringSplitOptions.None);
            var p = linhas[0].Split(' ');
            if (p.Length < 2) return false;
            metodo = p[0].ToUpperInvariant(); alvo = p[1];
            cab = new Dictionary<string, string>();
            for (int i = 1; i < linhas.Length; i++)
            {
                int c = linhas[i].IndexOf(':');
                if (c > 0) cab[linhas[i].Substring(0, c).Trim().ToLowerInvariant()] = linhas[i].Substring(c + 1).Trim();
            }
            sobra = new byte[len - fim - 4];
            Array.Copy(buf, fim + 4, sobra, 0, sobra.Length);
            return true;
        }

        static void Cabecalho(NetworkStream s, int cod, string tipo, long tam, string extra)
        {
            string h = "HTTP/1.1 " + cod + (cod == 200 ? " OK" : " Erro") + "\r\nContent-Type: " + tipo +
                "\r\nContent-Length: " + tam + "\r\nCache-Control: no-store\r\nConnection: close\r\n" + extra + "\r\n";
            var b = Encoding.UTF8.GetBytes(h);
            s.Write(b, 0, b.Length);
        }

        static void Enviar(NetworkStream s, int cod, string tipo, byte[] corpo)
        {
            Cabecalho(s, cod, tipo, corpo.Length, "");
            s.Write(corpo, 0, corpo.Length);
        }
        static void Texto(NetworkStream s, int cod, string t) { Enviar(s, cod, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(t)); }
        static void Json(NetworkStream s, string t) { Enviar(s, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(t)); }

        static readonly Dictionary<string, byte[]> recursos = new Dictionary<string, byte[]>();
        static void Recurso(NetworkStream s, string nome, string tipo)
        {
            byte[] b;
            lock (recursos)
                if (!recursos.TryGetValue(nome, out b))
                    using (var r = Assembly.GetExecutingAssembly().GetManifestResourceStream(nome))
                    using (var m = new MemoryStream()) { r.CopyTo(m); b = recursos[nome] = m.ToArray(); }
            Enviar(s, 200, tipo, b);
        }
    }

    // corpo da requisição: o que sobrou do cabeçalho + o resto do socket, até Content-Length
    class Corpo
    {
        readonly NetworkStream s; readonly byte[] sobra; int pos; long resta;
        public Corpo(NetworkStream s, byte[] sobra, long tam) { this.s = s; this.sobra = sobra; resta = tam; }
        public int Read(byte[] b, int o, int n)
        {
            if (resta <= 0) return 0;
            n = (int)Math.Min(n, resta);
            int r;
            if (pos < sobra.Length) { r = Math.Min(n, sobra.Length - pos); Array.Copy(sobra, pos, b, o, r); pos += r; }
            else r = s.Read(b, o, n);
            resta -= r;
            return r;
        }
        public byte[] LerTudo(int max)
        {
            var m = new MemoryStream(); var b = new byte[8192]; int n;
            while (m.Length < max && (n = Read(b, 0, b.Length)) > 0) m.Write(b, 0, n);
            return m.ToArray();
        }
    }
}
