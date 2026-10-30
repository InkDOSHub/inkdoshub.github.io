// InkDOS Hub para Windows: lançador nativo e leve (WinForms, sem motor web), com o visual da tela inicial do site.
//
// A tela inicial (Inicio.cs) mostra os mesmos apps do site. Os que têm versão nativa (Linux, Código, Documentos,
// Planilhas, Apresentações, Editar PDF, Vídeo, Webcam, Transferir) usam programas que só são baixados quando a
// pessoa quer, sempre da fonte oficial e conferidos (Ferramentas.cs). Os outros abrem no navegador.
// O ☰ > "Ferramentas neste PC" é o Modo Offline do site: um check verde por ferramenta; tocar baixa (depois de mostrar
// de onde vem, quem publica, o tamanho e o espaço livre), tocar de novo pergunta, na própria janela, se pode remover.
// Atualizações: o catálogo do site diz a versão de cada ferramenta e a release "hub-windows" traz o próprio Hub,
// conferido pelo SHA-256 publicado junto.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace InkDOSHub
{
    static class Program
    {
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main()
        {
            bool primeiro;
            using (new Mutex(true, "InkDOSHub-Windows", out primeiro))
            {
                if (!primeiro) return;
                Atualizador.LimparVelho();
                try { SetProcessDPIAware(); } catch { }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var g = Graphics.FromHwnd(IntPtr.Zero)) Ui.E = g.DpiX / 96f;
                Application.Run(new Janela());
            }
        }
    }

    // Preferências em %LOCALAPPDATA%\InkDOS Hub\config.txt, uma por linha (chave=valor).
    static class Conf
    {
        static readonly string Arq = Path.Combine(Ferramentas.Pasta, "config.txt");
        static Dictionary<string, string> Ler()
        {
            var d = new Dictionary<string, string>();
            try
            {
                foreach (var l in File.ReadAllLines(Arq))
                {
                    int i = l.IndexOf('=');
                    if (i > 0) d[l.Substring(0, i).Trim()] = l.Substring(i + 1).Trim();
                    else if (l.Trim() == "zed") d["editor"] = "zed";  // formato da versão 0.1
                }
            }
            catch { }
            return d;
        }
        public static string Pegar(string k, string padrao) { string v; return Ler().TryGetValue(k, out v) ? v : padrao; }
        public static void Gravar(string k, string v)
        {
            var d = Ler(); d[k] = v;
            try { Directory.CreateDirectory(Ferramentas.Pasta); File.WriteAllLines(Arq, d.Select(x => x.Key + "=" + x.Value)); } catch { }
        }
    }

    class Janela : Form
    {
        Catalogo catalogo;
        readonly Inicio inicio;
        readonly Camada camada = new Camada { Visible = false };
        readonly MenuPop menu = new MenuPop();
        readonly System.Windows.Forms.Timer giro = new System.Windows.Forms.Timer { Interval = 40 };
        CancellationTokenSource cancelar;
        bool ocupado, menuAberto;

        static string Editor { get { return Conf.Pegar("editor", "vscode") == "zed" ? "zed" : "vscode"; } }

        static Image Icone(string nome)
        {
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("icones/" + nome + ".png")) return Image.FromStream(s);
        }

        public Janela()
        {
            string tema = Conf.Pegar("tema", "");
            Ui.Escuro = tema == "escuro" || (tema == "" && WindowsEscuro());
            Text = "InkDOS Hub";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            AutoScaleMode = AutoScaleMode.None;
            ClientSize = new Size(Ui.P(1000), Ui.P(680));
            MinimumSize = new Size(Ui.P(420), Ui.P(480));
            StartPosition = FormStartPosition.CenterScreen;
            KeyPreview = true;
            BackColor = Ui.Fundo;

            inicio = new Inicio(Icone("marca")) { Dock = DockStyle.Fill };
            Apps();
            inicio.Menu += AbrirMenu;
            inicio.AbrirArquivo += AbrirArquivo;
            inicio.CodigoFonte += () => Navegar("https://github.com/InkDOSHub/inkdoshub.github.io");
            inicio.MouseDown += (s, e) => { menuAberto = menu.Visible; menu.Visible = false; };
            inicio.Busca.MouseDown += (s, e) => menu.Visible = false;
            camada.Dock = DockStyle.Fill;
            camada.Fechar += FecharPainel;
            Controls.Add(menu);
            Controls.Add(camada);
            Controls.Add(inicio);
            Ui.Refazer = () => camada.Arrumar();
            giro.Tick += (s, e) => { foreach (var l in Linhas()) if (l.Girando) l.Invalidate(); };
            Deactivate += (s, e) => menu.Visible = false;
            KeyDown += (s, e) => { if (e.KeyCode == Keys.Escape) { if (menu.Visible) menu.Visible = false; else if (camada.Visible) FecharPainel(); } };

            catalogo = Ferramentas.Embutido();
            Shown += async (s, e) =>
            {
                catalogo = await Task.Run(() => Ferramentas.Carregar());
                AtualizarInstaladas();
                ProcurarAtualizacoes();
            };
        }

        static bool WindowsEscuro()
        {
            try { return (int)(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) ?? 1) == 0; }
            catch { return false; }
        }

        Ferramenta F(string id) { return catalogo.ferramentas.FirstOrDefault(x => x.id == id); }
        static string Mb(long b) { return b <= 0 ? "0 MB" : b >= 1000000000 ? (b / 1e9).ToString("0.0") + " GB" : Math.Max(0.1, b / 1e6).ToString(b < 10000000 ? "0.0" : "0") + " MB"; }
        static void Navegar(string url) { try { Process.Start(url); } catch { } }

        // ---------- apps da tela inicial (mesma ordem do site) ----------
        void Apps()
        {
            Action<string, string, string, string, Action> app = (icone, nome, ferramenta, dica, acao) =>
                inicio.Apps.Add(new App { Icone = Icone(icone), Nome = T.Tx(nome), Sub = icone.StartsWith("oo-") ? "ONLYOFFICE" : null, Ferramenta = ferramenta, Dica = T.Tx(dica), Acao = () => { menu.Visible = false; try { acao(); } catch (Exception ex) { Aviso(ex.Message); } } });
            Func<string, Action> site = caminho => () => Navegar(Ferramentas.SITE + caminho);
            const string noNavegador = "Abre no navegador.";
            app("pdf", "PDF", null, noNavegador, site("inkdos/apps/pdf/index.html?suite=1"));
            app("editar-pdf", "Editar PDF", "qpdf", "Juntar, girar e comprimir PDFs (qpdf e Ghostscript).", PainelPdf);
            // InkDOS (rápido, no navegador) e ONLYOFFICE (completo, nativo) separados, como no site
            app("documentos", "Documentos", null, noNavegador, site("inkdos/apps/documents/index.html?suite=1"));
            app("planilhas", "Planilhas", null, noNavegador, site("inkdos/apps/spreadsheets/index.html?suite=1"));
            app("apresentacoes", "Apresentações", null, noNavegador, site("inkdos/apps/presentations/index.html?suite=1"));
            app("texto", "Texto simples", null, "Bloco de Notas do Windows.", () => Process.Start("notepad.exe"));
            app("epub", "Leitor EPUB", null, noNavegador, site("inkdos/apps/epub/index.html?suite=1"));
            app("foto", "Fotos", null, noNavegador, site("apps/foto/"));
            app("video", "Vídeo", "ffmpeg", "Cortar vídeo sem perder qualidade (ffmpeg).", () => Usar("ffmpeg", f => PainelVideo(f, null)));
            app("musica", "Música", null, noNavegador, site("apps/musica/"));
            app("gravador", "Gravador", null, noNavegador, site("apps/gravador/"));
            app("webcam", "Webcam", "webcam", "A câmera do celular como webcam do PC.", () => Usar("webcam", f => Ferramentas.Abrir(f)));
            app("transferir", "Transferir", "transferir", "Arquivos entre o celular e o PC, sem internet.", () => Usar("transferir", f => Ferramentas.Abrir(f)));
            app("quadro", "Quadro branco", null, noNavegador, site("apps/quadro/"));
            app("oo-docx", "Documentos", "onlyoffice", "Word (DOCX) no ONLYOFFICE Desktop.", () => Usar("onlyoffice", f => Ferramentas.Abrir(f, "--new:word", true)));
            app("oo-xlsx", "Planilhas", "onlyoffice", "Excel (XLSX) no ONLYOFFICE Desktop.", () => Usar("onlyoffice", f => Ferramentas.Abrir(f, "--new:cell", true)));
            app("oo-pptx", "Apresentações", "onlyoffice", "PowerPoint (PPTX) no ONLYOFFICE Desktop.", () => Usar("onlyoffice", f => Ferramentas.Abrir(f, "--new:slide", true)));
            app("codigo", "Código", "editor", "VS Code ou Zed (escolha no ☰).", () => Usar(Editor, f => Ferramentas.Abrir(f)));
            app("terminal", "Linux terminal", "linux", "Alpine Linux no WSL, com as pastas do Windows.", () => Usar("linux", f => Ferramentas.Abrir(f)));
        }

        async void AtualizarInstaladas()
        {
            var c = catalogo; string ed = Editor;
            var s = await Task.Run(() => new HashSet<string>(c.ferramentas.Where(Ferramentas.Instalada).Select(x => x.id)));
            if (s.Contains(ed)) s.Add("editor");
            inicio.Instaladas = s;
            inicio.Invalidate();
        }

        // Abre a ferramenta; se ainda não está no PC, abre "Ferramentas neste PC" já nela.
        void Usar(string id, Action<Ferramenta> abrir)
        {
            var f = F(id);
            if (f == null) { Aviso(T.Tx("{0} não está instalado.", id)); return; }
            if (Ferramentas.Instalada(f)) { abrir(f); return; }
            PainelFerramentas(id, () => abrir(f));
        }

        // ---------- painel na janela ----------
        void MostrarPainel(string titulo, params Control[] itens)
        {
            menu.Visible = false;
            var p = new Pilha(0, Ui.P(2));
            p.Controls.AddRange(itens);
            if (!camada.Visible)
            {
                camada.Foto = new Bitmap(inicio.Width, inicio.Height);
                inicio.DrawToBitmap(camada.Foto, new Rectangle(0, 0, inicio.Width, inicio.Height));
                camada.Visible = true; camada.BringToFront();
            }
            camada.Trocar(titulo, p);
            camada.Focus();
        }

        void FecharPainel()
        {
            if (cancelar != null) cancelar.Cancel();
            camada.Visible = false;
            if (camada.Foto != null) { camada.Foto.Dispose(); camada.Foto = null; }
            giro.Stop();
            AtualizarInstaladas();
        }

        void Aviso(string texto) { MostrarPainel("InkDOS Hub", new Rotulo(texto)); }

        IEnumerable<LinhaCheck> Linhas()
        {
            return camada.Visible ? camada.Conteudo.Controls.OfType<Pilha>().SelectMany(p => p.Controls.OfType<LinhaCheck>()) : Enumerable.Empty<LinhaCheck>();
        }

        // ---------- ☰ ----------
        void AbrirMenu()
        {
            if (menuAberto) { menuAberto = false; return; }
            var l = new List<MenuPop.Item>
            {
                new MenuPop.Item { Texto = T.Tx("Tema claro ou escuro"), Sol = true, Acao = TrocarTema },
                new MenuPop.Item { Texto = T.Tx("Ferramentas neste PC"), Lado = inicio.Instaladas.Count(x => x != "editor") + "/" + catalogo.ferramentas.Count, Marcado = inicio.Instaladas.Count > 0, Acao = () => PainelFerramentas(null, null) },
                new MenuPop.Item { Separador = true },
                new MenuPop.Item { Rotulo = true, Texto = T.Tx("Editor de código") },
                new MenuPop.Item { Texto = "VS Code", Marcado = Editor == "vscode", Acao = () => { Conf.Gravar("editor", "vscode"); AtualizarInstaladas(); } },
                new MenuPop.Item { Texto = T.Tx("Zed (leve)"), Marcado = Editor == "zed", Acao = () => { Conf.Gravar("editor", "zed"); AtualizarInstaladas(); } },
                new MenuPop.Item { Separador = true },
                new MenuPop.Item { Texto = T.Tx("Segurança e privacidade"), Acao = PainelSeguranca },
                new MenuPop.Item { Texto = T.Tx("Abrir no navegador"), Acao = () => Navegar(Ferramentas.SITE) },
            };
            if (menu.Foto != null) menu.Foto.Dispose();
            menu.Foto = new Bitmap(inicio.Width, inicio.Height);
            inicio.DrawToBitmap(menu.Foto, new Rectangle(0, 0, inicio.Width, inicio.Height));
            menu.Abrir(l, new Point(inicio.MenuR.X, inicio.MenuR.Bottom + Ui.P(6)));
        }

        void TrocarTema()
        {
            Ui.Escuro = !Ui.Escuro;
            Conf.Gravar("tema", Ui.Escuro ? "escuro" : "claro");
            BackColor = Ui.Fundo;
            inicio.Tema();
        }

        // ---------- Ferramentas neste PC (o Modo Offline do site) ----------
        void PainelFerramentas(string abrirId, Action depois)
        {
            var status = new Rotulo("");
            Action<string, Color?> dizer = (t, c) => { status.Cor = c; status.Text = t; status.Invalidate(); };
            var espaco = new Rotulo("", true);
            var lista = new Pilha(0, Ui.P(2));
            var atualizar = new Botao(T.Tx("Atualizar"), Botao.Tipo.Suave, true);
            Pilha aberta = null;  // detalhes ou confirmação abertos embaixo de uma linha

            Action contar = async () =>
            {
                var c = catalogo;
                long usado = await Task.Run(() => c.ferramentas.Where(Ferramentas.Instalada).Sum(x => Ferramentas.TamanhoNoDisco(x)));
                espaco.Text = T.Tx("Usado pelas ferramentas: {0}. Livre no PC: {1}.", Mb(usado), Mb(Ferramentas.EspacoLivre()));
            };
            Action fecharAberta = () => { if (aberta != null) { lista.Controls.Remove(aberta); aberta.Dispose(); aberta = null; } };
            Action<bool> travar = sim => { foreach (var x in lista.Controls.OfType<LinhaCheck>()) x.Apagada = sim && !x.Girando && !x.Fixo; lista.Invalidate(true); };

            long exe = 0; try { exe = new FileInfo(Application.ExecutablePath).Length; } catch { }
            lista.Controls.Add(new LinhaCheck(T.Tx("InkDOS Hub (este app)"), Mb(exe) + " · " + T.Tx("sempre guardado"), true, true));

            foreach (var f in catalogo.ferramentas)
            {
                var ff = f;
                bool tem = inicio.Instaladas.Contains(f.id);
                var linha = new LinhaCheck(f.nome, Mb(f.baixar), tem);
                if (tem) Task.Run(() => Ferramentas.TamanhoNoDisco(ff)).ContinueWith(t => { if (t.Result > 0) { linha.Tamanho = Mb(t.Result); linha.Invalidate(); } }, TaskScheduler.FromCurrentSynchronizationContext());
                linha.Click += (s, e) =>
                {
                    if (ocupado) { dizer(T.Tx("Aguarde o download atual terminar."), Ui.Perigo); return; }
                    bool estavaAberta = aberta != null && aberta.Tag == linha;
                    fecharAberta();
                    if (estavaAberta) return;
                    dizer("", null);
                    aberta = new Pilha(Ui.P(38), 0) { Tag = linha };
                    var nao = new Botao(T.Tx("Cancelar"));
                    nao.Click += (s2, e2) => fecharAberta();

                    if (linha.Marcado)
                    {
                        // remover: confirmação na própria janela
                        var sim = new Botao(T.Tx("Remover"), Botao.Tipo.Perigo);
                        aberta.Controls.Add(new Rotulo(T.Tx("Remover {0} deste PC? ({1})", ff.nome, linha.Tamanho), false, 13));
                        aberta.Controls.Add(new Fila(nao, sim));
                        sim.Click += async (s2, e2) =>
                        {
                            sim.Enabled = nao.Enabled = false; sim.Text = "…";
                            dizer(T.Tx("Removendo…"), null);
                            try
                            {
                                await Task.Run(() => Ferramentas.Remover(ff));
                                linha.Marcado = false; linha.Tamanho = Mb(ff.baixar); linha.Invalidate();
                                fecharAberta();
                                dizer(T.Tx("{0} removido", ff.nome), Ui.Verde);
                            }
                            catch (Exception ex) { fecharAberta(); dizer(T.Tx("Falhou: {0}", ex.Message), Ui.Perigo); }
                            AtualizarInstaladas(); contar();
                        };
                    }
                    else
                    {
                        // baixar: antes, de onde vem, quem publica, tamanho e segurança
                        foreach (var t in Detalhes(ff)) aberta.Controls.Add(new Rotulo(t, true));
                        if (ff.tipo == "wsl" && !Wsl.Ligado())
                        {
                            aberta.Controls.Add(new Rotulo(T.Tx("O Linux roda no WSL, que vem com o Windows mas precisa ser ligado uma vez (pede permissão de administrador e, às vezes, reiniciar)."), false, 13));
                            var ligar = new Botao(T.Tx("Ligar o WSL"), Botao.Tipo.Verde);
                            ligar.Click += async (s2, e2) =>
                            {
                                ligar.Enabled = false; dizer(T.Tx("Ligando o WSL…"), null);
                                try { await Task.Run(() => Wsl.Ligar()); dizer(T.Tx("Pronto. Se o Windows pedir, reinicie o PC e toque no Linux de novo."), Ui.Verde); }
                                catch (Exception ex) { dizer(T.Tx("Falhou: {0}", ex.Message), Ui.Perigo); }
                                ligar.Enabled = true;
                            };
                            aberta.Controls.Add(new Fila(nao, ligar));
                        }
                        else
                        {
                            var sim = new Botao(T.Tx("Baixar e instalar") + " · " + Mb(ff.baixar), Botao.Tipo.Verde);
                            aberta.Controls.Add(new Fila(nao, sim));
                            sim.Click += async (s2, e2) =>
                            {
                                fecharAberta();
                                bool ok = await Instalar(ff, linha, dizer, travar);
                                contar();
                                if (ok && depois != null && abrirId == ff.id) { FecharPainel(); try { depois(); } catch (Exception ex) { Aviso(ex.Message); } }
                            };
                        }
                    }
                    lista.Controls.Add(aberta);
                    lista.Controls.SetChildIndex(aberta, lista.Controls.GetChildIndex(linha) + 1);
                    camada.Arrumar();
                    camada.MostrarAte(aberta);
                };
                lista.Controls.Add(linha);
            }

            atualizar.Click += async (s, e) =>
            {
                if (ocupado) { dizer(T.Tx("Aguarde o download atual terminar."), Ui.Perigo); return; }
                fecharAberta();
                atualizar.Enabled = false; atualizar.Text = "…";
                dizer(T.Tx("Procurando atualizações…"), null);
                catalogo = await Task.Run(() => Ferramentas.Carregar());
                var velhas = catalogo.ferramentas.Where(Ferramentas.TemAtualizacao).ToList();
                bool tudoOk = true;
                foreach (var f in velhas)
                {
                    var linha = lista.Controls.OfType<LinhaCheck>().FirstOrDefault(x => x.Nome == f.nome);
                    if (linha == null || !await Instalar(f, linha, dizer, travar)) { tudoOk = false; break; }
                }
                if (tudoOk && await Task.Run(() => Atualizador.TemVersaoNova()))
                {
                    dizer(T.Tx("Atualizando o InkDOS Hub…"), null);
                    try { await Task.Run(() => Atualizador.Instalar()); Application.Restart(); Environment.Exit(0); }
                    catch (Exception ex) { dizer(T.Tx("Falhou: {0}", ex.Message), Ui.Perigo); tudoOk = false; }
                }
                if (tudoOk) { dizer(T.Tx("Tudo atualizado") + " ✓", Ui.Verde); inicio.Aviso = null; inicio.Arrumar(); }
                atualizar.Text = T.Tx("Atualizar"); atualizar.Enabled = true;
                contar();
            };

            MostrarPainel(T.Tx("Ferramentas neste PC"),
                new Rotulo(T.Tx("Escolha o que fica neste PC. Toque num item para baixar; toque de novo para remover. Cada download vem da fonte oficial e é conferido antes de instalar."), true),
                atualizar, status, espaco, lista);
            contar();
            if (abrirId != null)
            {
                var alvo = catalogo.ferramentas.FirstOrDefault(x => x.id == abrirId);
                var l = alvo == null ? null : lista.Controls.OfType<LinhaCheck>().FirstOrDefault(x => x.Nome == alvo.nome);
                if (l != null) l.Tocar();
            }
        }

        IEnumerable<string> Detalhes(Ferramenta f)
        {
            yield return T.Tx("De onde vem") + ": " + new Uri(f.url).Host + " (" + f.pagina + ")";
            yield return T.Tx("Quem publica") + ": " + f.publica + " · " + T.Tx("Licença") + ": " + f.licenca + " · " + T.Tx("Versão") + ": " + f.versao;
            yield return T.Tx("Download") + ": " + Mb(f.baixar) + " · " + T.Tx("No disco (aprox.)") + ": " + Mb((long)f.instalado_mb * 1000000) + " · " + T.Tx("Livre no PC") + ": " + Mb(Ferramentas.EspacoLivre());
            yield return T.Tx("O que acessa") + ": " + f.acesso;
            yield return T.Tx("Segurança") + ": " + (string.IsNullOrEmpty(f.assinante)
                ? T.Tx("Antes de instalar, o InkDOS Hub confere a impressão digital (SHA-256) do arquivo. Este fabricante não assina o programa.")
                : T.Tx("Antes de instalar, o InkDOS Hub confere a impressão digital (SHA-256) do arquivo e a assinatura digital de {0}.", f.assinante));
        }

        // Baixa e instala uma ferramenta mostrando o progresso na linha e no status. Devolve se deu certo.
        async Task<bool> Instalar(Ferramenta f, LinhaCheck linha, Action<string, Color?> dizer, Action<bool> travar)
        {
            ocupado = true;
            linha.Girando = true; linha.Progresso = 0; linha.Invalidate(); giro.Start();
            travar(true);
            string etapa = T.Tx("Baixando {0}…", f.nome);
            int pct = 0;
            dizer(etapa + " 0%", null);
            cancelar = new CancellationTokenSource();
            var tk = cancelar.Token;
            bool ok = false;
            try
            {
                await Task.Run(() => Ferramentas.Instalar(f,
                    p => BeginInvoke((Action)(() => { pct = p; linha.Progresso = p; linha.Tamanho = p + "%"; linha.Invalidate(); dizer(etapa + " " + p + "%", null); })),
                    t => BeginInvoke((Action)(() => { etapa = t; dizer(t, null); })), tk));
                linha.Marcado = true;
                dizer(T.Tx("{0} instalado e verificado ✓", f.nome), Ui.Verde);
                ok = true;
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { if (!camada.IsDisposed) dizer(T.Tx("Falhou: {0}", ex.Message), Ui.Perigo); }
            finally
            {
                cancelar = null; ocupado = false; giro.Stop();
                linha.Girando = false; linha.Progresso = -1; linha.Tamanho = Mb(f.baixar); linha.Invalidate();
                travar(false);
                AtualizarInstaladas();
            }
            return ok;
        }

        void PainelSeguranca()
        {
            MostrarPainel(T.Tx("Segurança e privacidade"),
                new Rotulo(T.Tx("O InkDOS Hub não coleta nem envia dados. Não tem conta, anúncios nem estatísticas.")),
                new Rotulo(T.Tx("Cada ferramenta vem só do site oficial de quem a publica. Antes de instalar, o InkDOS Hub confere a impressão digital (SHA-256) publicada pela fonte e, quando existe, a assinatura digital do fabricante. Se algo não bater, nada é instalado.")),
                new Rotulo(T.Tx("Código aberto (MIT): github.com/InkDOSHub/inkdoshub.github.io. Revisões do código em auditoria/."), true));
        }

        // ---------- atualizações ----------
        async void ProcurarAtualizacoes()
        {
            var c = catalogo;
            bool ferramentas = await Task.Run(() => c.ferramentas.Any(Ferramentas.TemAtualizacao));
            bool hub = await Task.Run(() => Atualizador.TemVersaoNova());
            if (!ferramentas && !hub) return;
            inicio.Aviso = T.Tx("Atualização disponível") + " · " + T.Tx("Atualizar");
            inicio.AvisoAcao = () => PainelFerramentas(null, null);
            inicio.Arrumar();
        }

        // ---------- pasta: abrir um arquivo no app certo ----------
        void AbrirArquivo()
        {
            menu.Visible = false;
            var a = new OpenFileDialog();
            if (a.ShowDialog(this) != DialogResult.OK) return;
            string arq = a.FileName, ext = Path.GetExtension(arq).ToLowerInvariant();
            try
            {
                if (",.docx,.doc,.odt,.rtf,.xlsx,.xls,.ods,.csv,.pptx,.ppt,.odp,".Contains("," + ext + ","))
                    Usar("onlyoffice", f => Ferramentas.Abrir(f, arq));
                else if (",.mp4,.mov,.mkv,.webm,.avi,.m4v,".Contains("," + ext + ","))
                    Usar("ffmpeg", f => PainelVideo(f, arq));
                else if (",.txt,.md,.json,.js,.ts,.py,.c,.cpp,.h,.cs,.java,.html,.css,.sh,.xml,.yml,.yaml,.ini,.toml,".Contains("," + ext + ","))
                {
                    var ed = F(Editor);
                    if (ed != null && Ferramentas.Instalada(ed)) Ferramentas.Abrir(ed, arq); else Process.Start("notepad.exe", "\"" + arq + "\"");
                }
                else Process.Start(arq);
            }
            catch (Exception ex) { Aviso(ex.Message); }
        }

        // ---------- Editar PDF (qpdf e Ghostscript, nativos) ----------
        void PainelPdf()
        {
            var estado = new Rotulo("", true);
            var juntar = new Botao(T.Tx("Juntar PDFs"), Botao.Tipo.Principal);
            var girar = new Botao(T.Tx("Girar páginas"));
            var comprimir = new Botao(T.Tx("Comprimir PDF"));
            juntar.Click += (s, e) => Usar("qpdf", f =>
            {
                var a = new OpenFileDialog { Filter = "PDF|*.pdf", Multiselect = true, Title = T.Tx("Escolha os PDFs na ordem em que devem ficar.") };
                if (a.ShowDialog(this) != DialogResult.OK || a.FileNames.Length == 0) return;
                var g = new SaveFileDialog { Filter = "PDF|*.pdf", FileName = "juntos.pdf" };
                if (g.ShowDialog(this) != DialogResult.OK) return;
                string args = "--empty --pages " + string.Join(" ", a.FileNames.Select(x => "\"" + x + "\"")) + " -- \"" + g.FileName + "\"";
                Trabalho(estado, () => Ferramentas.Rodar(Ferramentas.Executavel(f), args), g.FileName);
            });
            girar.Click += (s, e) => Usar("qpdf", f =>
            {
                var a = new OpenFileDialog { Filter = "PDF|*.pdf" };
                if (a.ShowDialog(this) != DialogResult.OK) return;
                string saida = Path.Combine(Path.GetDirectoryName(a.FileName), Path.GetFileNameWithoutExtension(a.FileName) + " (girado).pdf");
                Trabalho(estado, () => Ferramentas.Rodar(Ferramentas.Executavel(f), "--rotate=+90 \"" + a.FileName + "\" \"" + saida + "\""), saida);
            });
            comprimir.Click += (s, e) => Usar("ghostscript", f =>
            {
                var a = new OpenFileDialog { Filter = "PDF|*.pdf" };
                if (a.ShowDialog(this) != DialogResult.OK) return;
                string saida = Path.Combine(Path.GetDirectoryName(a.FileName), Path.GetFileNameWithoutExtension(a.FileName) + " (menor).pdf");
                Trabalho(estado, () => Ferramentas.Rodar(Ferramentas.Executavel(f), "-sDEVICE=pdfwrite -dPDFSETTINGS=/ebook -dNOPAUSE -dBATCH -dQUIET -o \"" + saida + "\" \"" + a.FileName + "\""), saida);
            });
            MostrarPainel(T.Tx("Editar PDF"), new Fila(juntar, girar, comprimir), estado);
        }

        async void Trabalho(Rotulo estado, Func<string> tarefa, string saida)
        {
            estado.Text = T.Tx("Trabalhando…");
            string erro = await Task.Run(tarefa);
            string msg = erro == null ? T.Tx("Salvo: {0}", saida) + " ✓" : T.Tx("Falhou: {0}", erro);
            if (camada.Visible && estado.FindForm() != null) estado.Text = msg; else Aviso(msg);
            if (erro == null) try { Process.Start("explorer.exe", "/select,\"" + saida + "\""); } catch { }
        }

        // ---------- Vídeo: cortar com o ffmpeg, sem recompactar ----------
        void PainelVideo(Ferramenta f, string inicial)
        {
            string arquivo = inicial;
            var estado = new Rotulo("", true);
            var nome = new Rotulo(arquivo != null ? Path.GetFileName(arquivo) : "—", false, 14, true);
            Func<string, TextBox> campo = t => new TextBox { Width = Ui.P(80), Text = t, Font = Ui.Fonte(14), BackColor = Ui.Mistura(Ui.Cartao, Ui.Hover), ForeColor = Ui.Texto, BorderStyle = BorderStyle.FixedSingle, Margin = new Padding(0, Ui.P(6), Ui.P(12), 0) };
            var ini = campo("00:00");
            var fim = campo("00:10");
            var escolher = new Botao(T.Tx("Escolher vídeo"));
            var cortar = new Botao(T.Tx("Cortar"), Botao.Tipo.Principal);
            escolher.Click += (s, e) => { var a = new OpenFileDialog { Filter = T.Tx("Vídeo") + "|*.mp4;*.mov;*.mkv;*.webm;*.avi;*.m4v|*.*|*.*" }; if (a.ShowDialog(this) == DialogResult.OK) { arquivo = a.FileName; nome.Text = Path.GetFileName(arquivo); } };
            cortar.Click += async (s, e) =>
            {
                if (arquivo == null) { estado.Text = T.Tx("Escolha um vídeo primeiro."); return; }
                string saida = Path.Combine(Path.GetDirectoryName(arquivo), Path.GetFileNameWithoutExtension(arquivo) + " (cortado)" + Path.GetExtension(arquivo));
                cortar.Enabled = false; estado.Text = T.Tx("Trabalhando…");
                string args = "-y -ss " + ini.Text.Trim() + " -to " + fim.Text.Trim() + " -i \"" + arquivo + "\" -c copy -map 0 \"" + saida + "\"";
                string erro = await Task.Run(() => Ferramentas.Rodar(Ferramentas.Executavel(f), args));
                cortar.Enabled = true;
                estado.Text = erro == null ? T.Tx("Salvo: {0}", saida) + " ✓" : T.Tx("Falhou: {0}", erro.Split('\n').Last());
                if (erro == null) try { Process.Start("explorer.exe", "/select,\"" + saida + "\""); } catch { }
            };
            MostrarPainel(T.Tx("Cortar vídeo"),
                new Fila(escolher, nome),
                new Fila(new Rotulo(T.Tx("Início (mm:ss)"), false, 14, true), ini, new Rotulo(T.Tx("Fim (mm:ss)"), false, 14, true), fim),
                new Rotulo(T.Tx("Corta sem recompactar: é rápido e não perde qualidade (o corte cai no quadro-chave mais próximo)."), true),
                new Fila(cortar), estado);
        }
    }

    // O próprio InkDOS Hub: a release "hub-windows" publica o .exe e o SHA-256. Só troca se o hash bater.
    static class Atualizador
    {
        const string Release = "https://github.com/InkDOSHub/inkdoshub.github.io/releases/download/hub-windows/";
        static string Exe { get { return Assembly.GetExecutingAssembly().Location; } }

        public static void LimparVelho() { try { if (File.Exists(Exe + ".old")) File.Delete(Exe + ".old"); } catch { } }

        static string ShaPublicado()
        {
            using (var w = Ferramentas.Cliente()) return w.DownloadString(Release + "InkDOSHub.exe.sha256").Trim().Split(' ')[0].ToLowerInvariant();
        }

        public static bool TemVersaoNova()
        {
            try { string s = ShaPublicado(); return s.Length == 64 && s != Ferramentas.Sha256(Exe); } catch { return false; }
        }

        public static void Instalar()
        {
            string sha = ShaPublicado();
            string novo = Exe + ".new";
            using (var w = Ferramentas.Cliente()) w.DownloadFile(Release + "InkDOSHub.exe", novo);
            if (Ferramentas.Sha256(novo) != sha) { File.Delete(novo); throw new Exception(T.Tx("O arquivo baixado não é o publicado pelo fabricante (SHA-256 diferente). Nada foi instalado.")); }
            if (File.Exists(Exe + ".old")) File.Delete(Exe + ".old");
            File.Move(Exe, Exe + ".old"); // o Windows deixa renomear o .exe aberto
            File.Move(novo, Exe);
        }
    }
}
