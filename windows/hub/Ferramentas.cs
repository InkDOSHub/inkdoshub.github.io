// Catálogo, download conferido, instalação e abertura das ferramentas nativas.
//
// Segurança de cada download (pedido do Paulo, para não gerar desconfiança):
//  1. O endereço vem do catálogo windows/ferramentas.json, gerado pela action windows-hub.yml a partir da fonte
//     oficial de cada projeto (tools/windows_ferramentas.py). O catálogo vem do site do InkDOS Hub por HTTPS;
//     sem rede, vale a cópia que está dentro do .exe.
//  2. Depois de baixar, o SHA-256 do arquivo precisa ser igual ao do catálogo. Se não for, nada é instalado.
//  3. Quando o fabricante assina o programa, a assinatura digital (Authenticode) é conferida pelo Windows e o nome
//     de quem assinou precisa ser o esperado.
// Tudo fica em %LOCALAPPDATA%\InkDOS Hub\ (sem admin), menos o que o instalador do próprio fabricante escolher.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace InkDOSHub
{
#pragma warning disable CS0649 // preenchidos pelo JavaScriptSerializer
    class Ferramenta
    {
        public string id, nome, publica, licenca, tipo, assinante, acesso, versao, url, sha256, pagina;
        public long baixar;
        public int instalado_mb;
    }

    class Catalogo
    {
        public int formato;
        public List<Ferramenta> ferramentas = new List<Ferramenta>();
    }

    static class Ferramentas
    {
        public const string SITE = "https://inkdoshub.github.io/";
        public static readonly string Pasta = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InkDOS Hub");
        public static readonly string PastaFerramentas = Path.Combine(Pasta, "ferramentas");
        public const string DistroLinux = "InkDOSHub-Alpine";
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };

        static Ferramentas()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            Directory.CreateDirectory(PastaFerramentas);
        }

        public static Catalogo Embutido()
        {
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("ferramentas.json"))
            using (var r = new StreamReader(s, Encoding.UTF8)) return Json.Deserialize<Catalogo>(r.ReadToEnd());
        }

        // O catálogo do site é o mais novo; sem rede, vale o que veio dentro do .exe.
        public static Catalogo Carregar()
        {
            try
            {
                using (var w = Cliente()) return Json.Deserialize<Catalogo>(w.DownloadString(SITE + "windows/ferramentas.json"));
            }
            catch { return Embutido(); }
        }

        public static WebClient Cliente()
        {
            var w = new WebClient { Encoding = Encoding.UTF8 };
            w.Headers[HttpRequestHeader.UserAgent] = "InkDOSHub-Windows";
            return w;
        }

        // ---------- estado de cada ferramenta ----------
        public static string PastaDe(Ferramenta f) { return Path.Combine(PastaFerramentas, f.id); }
        static string Marca(Ferramenta f) { return Path.Combine(PastaDe(f), "inkdoshub.json"); }

        public static string VersaoInstalada(Ferramenta f)
        {
            try
            {
                if (!File.Exists(Marca(f))) return null;
                var d = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Marca(f)));
                return d.ContainsKey("versao") ? d["versao"] as string : null;
            }
            catch { return null; }
        }

        public static bool Instalada(Ferramenta f) { return VersaoInstalada(f) != null && Executavel(f) != null; }
        public static bool TemAtualizacao(Ferramenta f) { var v = VersaoInstalada(f); return v != null && v != f.versao; }

        public static long TamanhoNoDisco(Ferramenta f)
        {
            try
            {
                var d = new DirectoryInfo(PastaDe(f));
                long n = d.Exists ? d.EnumerateFiles("*", SearchOption.AllDirectories).Sum(x => x.Length) : 0;
                var fora = PastaExterna(f);
                if (fora != null && Directory.Exists(fora))
                    n += new DirectoryInfo(fora).EnumerateFiles("*", SearchOption.AllDirectories).Sum(x => x.Length);
                return n;
            }
            catch { return 0; }
        }

        public static long EspacoLivre()
        {
            try { return new DriveInfo(Path.GetPathRoot(Pasta)).AvailableFreeSpace; } catch { return 0; }
        }

        // Pasta onde o instalador do fabricante coloca o programa (quando não é um .zip nosso).
        static string PastaExterna(Ferramenta f)
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            switch (f.id)
            {
                case "zed": return Path.Combine(local, "Programs", "Zed");
                case "onlyoffice": return Path.Combine(pf, "ONLYOFFICE", "DesktopEditors");
                case "ghostscript": return Path.Combine(pf, "gs");
                default: return null;
            }
        }

        public static string Executavel(Ferramenta f)
        {
            string p = PastaDe(f);
            switch (f.id)
            {
                case "linux": return Wsl.TemDistro() ? Wsl.Exe : null;
                case "vscode": return Existe(Path.Combine(p, "Code.exe"));
                case "qpdf": return Achar(p, "qpdf.exe");
                case "ffmpeg": return Achar(p, "ffmpeg.exe");
                case "webcam":
                case "transferir": return Achar(p, "InkDOS*.exe");
                case "zed": return Existe(Path.Combine(PastaExterna(f), "Zed.exe")) ?? Achar(PastaExterna(f), "zed.exe");
                case "onlyoffice": return Existe(Path.Combine(PastaExterna(f), "DesktopEditors.exe"));
                case "ghostscript": return Achar(PastaExterna(f), "gswin64c.exe");
                default: return null;
            }
        }

        static string Existe(string p) { return p != null && File.Exists(p) ? p : null; }
        static string Achar(string pasta, string nome)
        {
            try { return pasta != null && Directory.Exists(pasta) ? Directory.EnumerateFiles(pasta, nome, SearchOption.AllDirectories).FirstOrDefault() : null; }
            catch { return null; }
        }

        // ---------- baixar, conferir e instalar ----------
        // progresso: 0..100 durante o download; texto: cada etapa, para mostrar na tela.
        public static void Instalar(Ferramenta f, Action<int> progresso, Action<string> etapa, CancellationToken cancelar)
        {
            Directory.CreateDirectory(PastaDe(f));
            string nomeArq = Path.GetFileName(new Uri(f.url).AbsolutePath);
            string arq = Path.Combine(Path.GetTempPath(), "inkdoshub-" + f.id + "-" + nomeArq);
            etapa(T.Tx("Baixando de {0}…", new Uri(f.url).Host));
            Baixar(f.url, arq, f.baixar, progresso, cancelar);

            etapa(T.Tx("Conferindo a impressão digital (SHA-256)…"));
            string sha = Sha256(arq);
            if (!string.Equals(sha, f.sha256, StringComparison.OrdinalIgnoreCase))
            {
                File.Delete(arq);
                throw new Exception(T.Tx("O arquivo baixado não é o publicado pelo fabricante (SHA-256 diferente). Nada foi instalado."));
            }

            if (f.tipo == "instalador")
            {
                ConferirAssinatura(arq, f);
                etapa(T.Tx("Abrindo o instalador de {0}…", f.publica));
                using (var p = Process.Start(new ProcessStartInfo(arq) { UseShellExecute = true })) p.WaitForExit();
                File.Delete(arq);
            }
            else if (f.tipo == "zip")
            {
                etapa(T.Tx("Extraindo…"));
                string destino = PastaDe(f);
                foreach (var d in Directory.GetDirectories(destino)) Directory.Delete(d, true);
                foreach (var a in Directory.GetFiles(destino)) File.Delete(a);
                ZipFile.ExtractToDirectory(arq, destino);
                File.Delete(arq);
                if (f.id == "vscode") Directory.CreateDirectory(Path.Combine(destino, "data")); // modo portátil: tudo nesta pasta
                if (f.assinante != null)
                {
                    var exe = Executavel(f);
                    if (exe != null) ConferirAssinatura(exe, f);
                }
            }
            else if (f.tipo == "exe")
            {
                File.Copy(arq, Path.Combine(PastaDe(f), nomeArq), true);
                File.Delete(arq);
            }
            else if (f.tipo == "wsl")
            {
                etapa(T.Tx("Criando o Linux no WSL…"));
                Wsl.Importar(arq, Path.Combine(PastaDe(f), "disco"));
                File.Delete(arq);
            }

            File.WriteAllText(Marca(f), Json.Serialize(new Dictionary<string, object> { { "versao", f.versao }, { "sha256", f.sha256 }, { "url", f.url } }));
            if (Executavel(f) == null)
                throw new Exception(T.Tx("A instalação não terminou. Se o instalador foi cancelado, tente de novo."));
        }

        public static void Remover(Ferramenta f)
        {
            if (f.id == "linux") Wsl.Remover();
            if (Directory.Exists(PastaDe(f))) Directory.Delete(PastaDe(f), true);
            // programas com instalador próprio: o desinstalador do Windows (Configurações > Apps) remove o resto
        }

        static void Baixar(string url, string destino, long total, Action<int> progresso, CancellationToken cancelar)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = "InkDOSHub-Windows";
            req.AllowAutoRedirect = true;
            using (var resp = req.GetResponse())
            using (var s = resp.GetResponseStream())
            using (var o = File.Create(destino))
            {
                if (resp.ContentLength > 0) total = resp.ContentLength;
                var buf = new byte[1 << 16];
                long feito = 0; int n, ultimo = -1;
                while ((n = s.Read(buf, 0, buf.Length)) > 0)
                {
                    cancelar.ThrowIfCancellationRequested();
                    o.Write(buf, 0, n);
                    feito += n;
                    int pct = total > 0 ? (int)Math.Min(100, feito * 100 / total) : 0;
                    if (pct != ultimo) { ultimo = pct; progresso(pct); }
                }
            }
        }

        public static string Sha256(string arq)
        {
            using (var h = SHA256.Create())
            using (var s = File.OpenRead(arq))
                return BitConverter.ToString(h.ComputeHash(s)).Replace("-", "").ToLowerInvariant();
        }

        // ---------- assinatura digital (Authenticode) ----------
        public static void ConferirAssinatura(string arq, Ferramenta f)
        {
            if (string.IsNullOrEmpty(f.assinante)) return;
            if (!AssinaturaValida(arq))
                throw new Exception(T.Tx("A assinatura digital de {0} não é válida. Nada foi instalado.", f.nome));
            string quem = "";
            try { quem = new X509Certificate2(X509Certificate.CreateFromSignedFile(arq)).GetNameInfo(X509NameType.SimpleName, false); } catch { }
            if (quem.IndexOf(f.assinante, StringComparison.OrdinalIgnoreCase) < 0)
                throw new Exception(T.Tx("{0} foi assinado por \"{1}\", e não por \"{2}\". Nada foi instalado.", f.nome, quem, f.assinante));
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct WINTRUST_FILE_INFO { public uint cbStruct; public string pcwszFilePath; public IntPtr hFile; public IntPtr pgKnownSubject; }
        [StructLayout(LayoutKind.Sequential)]
        struct WINTRUST_DATA
        {
            public uint cbStruct; public IntPtr pPolicyCallbackData; public IntPtr pSIPClientData; public uint dwUIChoice;
            public uint fdwRevocationChecks; public uint dwUnionChoice; public IntPtr pFile; public uint dwStateAction;
            public IntPtr hWVTStateData; public IntPtr pwszURLReference; public uint dwProvFlags; public uint dwUIContext; public IntPtr pSignatureSettings;
        }
        [DllImport("wintrust.dll", CharSet = CharSet.Unicode)]
        static extern int WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid action, ref WINTRUST_DATA data);
        static readonly Guid AcaoGenerica = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

        public static bool AssinaturaValida(string arq)
        {
            var fi = new WINTRUST_FILE_INFO { cbStruct = (uint)Marshal.SizeOf(typeof(WINTRUST_FILE_INFO)), pcwszFilePath = arq };
            IntPtr pFi = Marshal.AllocHGlobal(Marshal.SizeOf(fi));
            try
            {
                Marshal.StructureToPtr(fi, pFi, false);
                var d = new WINTRUST_DATA
                {
                    cbStruct = (uint)Marshal.SizeOf(typeof(WINTRUST_DATA)), dwUIChoice = 2 /* sem janela */, fdwRevocationChecks = 0,
                    dwUnionChoice = 1 /* arquivo */, pFile = pFi, dwStateAction = 0, dwProvFlags = 0x80 /* revogação só da cadeia em cache */
                };
                return WinVerifyTrust(IntPtr.Zero, AcaoGenerica, ref d) == 0;
            }
            finally { Marshal.FreeHGlobal(pFi); }
        }

        // ---------- abrir ----------
        public static void Abrir(Ferramenta f, string argumento = null)
        {
            string exe = Executavel(f);
            if (exe == null) throw new Exception(T.Tx("{0} não está instalado.", f.nome));
            if (f.id == "linux") { Wsl.AbrirTerminal(); return; }
            var psi = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) };
            if (argumento != null) psi.Arguments = "\"" + argumento + "\"";
            Process.Start(psi);
        }

        // Roda uma ferramenta de linha de comando (qpdf, Ghostscript, ffmpeg) e devolve o erro, se houver.
        public static string Rodar(string exe, string argumentos)
        {
            var psi = new ProcessStartInfo(exe, argumentos) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
            using (var p = Process.Start(psi))
            {
                string erro = p.StandardError.ReadToEnd();
                p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                return p.ExitCode == 0 || (exe.EndsWith("qpdf.exe", StringComparison.OrdinalIgnoreCase) && p.ExitCode == 3) ? null : (erro.Trim().Length > 0 ? erro.Trim() : "código " + p.ExitCode);
            }
        }
    }

    // Linux pelo WSL do Windows: um Alpine só do InkDOS Hub, importado do arquivo oficial (minirootfs).
    static class Wsl
    {
        public static readonly string Exe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "wsl.exe");

        static string Rodar(string args, out int codigo)
        {
            var psi = new ProcessStartInfo(Exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.Unicode };
            using (var p = Process.Start(psi))
            {
                string saida = p.StandardOutput.ReadToEnd();
                p.StandardError.ReadToEnd();
                p.WaitForExit();
                codigo = p.ExitCode;
                return saida.Replace("\0", "");
            }
        }

        public static bool Existe() { return File.Exists(Exe); }

        public static bool Ligado()
        {
            if (!Existe()) return false;
            try { int c; Rodar("--status", out c); return c == 0; } catch { return false; }
        }

        public static bool TemDistro()
        {
            if (!Existe()) return false;
            try { int c; var s = Rodar("--list --quiet", out c); return c == 0 && s.Split('\n').Any(l => l.Trim() == Ferramentas.DistroLinux); } catch { return false; }
        }

        // Liga o WSL (pede admin uma vez; o Windows pode pedir para reiniciar).
        public static void Ligar()
        {
            using (var p = Process.Start(new ProcessStartInfo(Exe, "--install --no-distribution") { UseShellExecute = true, Verb = "runas" })) p.WaitForExit();
        }

        public static void Importar(string tarGz, string pastaDisco)
        {
            if (!Ligado()) throw new Exception(T.Tx("O WSL do Windows ainda não está ligado. Toque em \"Ligar o WSL\" e, se o Windows pedir, reinicie o PC."));
            Directory.CreateDirectory(pastaDisco);
            int c;
            string s = Rodar("--import " + Ferramentas.DistroLinux + " \"" + pastaDisco + "\" \"" + tarGz + "\" --version 2", out c);
            if (c != 0) throw new Exception(T.Tx("O WSL não conseguiu criar o Linux: {0}", s.Trim()));
            // pasta compartilhada: ~/windows aponta para a pasta do usuário no Windows
            Rodar("-d " + Ferramentas.DistroLinux + " -- sh -c \"ln -sfn \\\"$(wslpath '" + Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + "')\\\" /root/windows\"", out c);
        }

        public static void Remover() { int c; if (TemDistro()) Rodar("--unregister " + Ferramentas.DistroLinux, out c); }

        public static void AbrirTerminal()
        {
            string wt = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps", "wt.exe");
            if (File.Exists(wt)) Process.Start(new ProcessStartInfo(wt, "--title \"InkDOS Hub · Linux\" " + Exe + " -d " + Ferramentas.DistroLinux + " --cd ~") { UseShellExecute = false });
            else Process.Start(new ProcessStartInfo(Exe, "-d " + Ferramentas.DistroLinux + " --cd ~") { UseShellExecute = true });
        }
    }
}
