// InkDOS Hub para Windows: lançador nativo e leve (WinForms, sem motor web).
//
// A tela inicial mostra as ferramentas. As pesadas (Linux, Código, Documentos, PDF, Cortar vídeo) são programas
// nativos que só são baixados quando a pessoa quer, sempre da fonte oficial e conferidos (Ferramentas.cs).
// Antes de baixar, um cartão na própria janela mostra de onde vem, quem publica, a licença, o tamanho do download,
// o espaço no disco e o espaço livre. Fotos, música, gravador, quadro e os documentos rápidos continuam no site.
// Atualizações: o catálogo do site diz a versão de cada ferramenta (só o que mudou é baixado de novo) e a release
// "hub-windows" traz o próprio InkDOS Hub, conferido pelo SHA-256 publicado junto.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace InkDOSHub
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            bool primeiro;
            using (new Mutex(true, "InkDOSHub-Windows", out primeiro))
            {
                if (!primeiro) return;
                Atualizador.LimparVelho();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Janela());
            }
        }
    }

    static class Cores
    {
        public static readonly bool Escuro = LerEscuro();
        static bool LerEscuro()
        {
            try { return (int)(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) ?? 1) == 0; }
            catch { return false; }
        }
        public static Color Fundo { get { return Escuro ? Color.FromArgb(28, 28, 30) : Color.FromArgb(245, 246, 248); } }
        public static Color Cartao { get { return Escuro ? Color.FromArgb(44, 44, 46) : Color.White; } }
        public static Color Texto { get { return Escuro ? Color.FromArgb(242, 242, 247) : Color.FromArgb(25, 34, 53); } }
        public static Color Fraco { get { return Escuro ? Color.FromArgb(160, 160, 168) : Color.FromArgb(105, 112, 128); } }
        public static Color Linha { get { return Escuro ? Color.FromArgb(64, 64, 68) : Color.FromArgb(227, 232, 239); } }
        public static readonly Color Verde = Color.FromArgb(31, 157, 85);
        public static readonly Color Acento = Color.FromArgb(37, 99, 235);
    }

    class Janela : Form
    {
        Catalogo catalogo;
        readonly FlowLayoutPanel grade = new FlowLayoutPanel();
        readonly Panel faixa = new Panel();
        readonly Label faixaTexto = new Label();
        readonly Button faixaBotao = new Button();
        readonly Panel fundoPainel = new Panel();
        readonly Panel painel = new Panel();
        readonly Font fonte = new Font("Segoe UI", 10f);
        readonly Font fonteTitulo = new Font("Segoe UI Semibold", 12f);
        readonly Font fonteIcone = new Font("Segoe UI Symbol", 22f);
        CancellationTokenSource cancelar;

        static readonly string Config = Path.Combine(Ferramentas.Pasta, "config.txt");
        static string Editor
        {
            get { try { return File.Exists(Config) && File.ReadAllText(Config).Trim() == "zed" ? "zed" : "vscode"; } catch { return "vscode"; } }
            set { try { File.WriteAllText(Config, value); } catch { } }
        }

        public Janela()
        {
            Text = "InkDOS Hub";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            ClientSize = new Size(900, 600);
            MinimumSize = new Size(560, 420);
            BackColor = Cores.Fundo;
            ForeColor = Cores.Texto;
            Font = fonte;
            StartPosition = FormStartPosition.CenterScreen;

            // barra de cima: nome à esquerda, ☰ à direita (o mesmo desenho dos apps do site)
            var barra = new Panel { Dock = DockStyle.Top, Height = 48, BackColor = Cores.Cartao };
            barra.Controls.Add(new Label { Text = "InkDOS Hub", Font = fonteTitulo, AutoSize = true, Location = new Point(16, 13), ForeColor = Cores.Texto });
            var menu = new Button { Text = "☰", Width = 44, Height = 36, FlatStyle = FlatStyle.Flat, Anchor = AnchorStyles.Top | AnchorStyles.Right, ForeColor = Cores.Texto, Font = new Font("Segoe UI Symbol", 13f) };
            menu.FlatAppearance.BorderSize = 0;
            menu.Location = new Point(barra.Width - 54, 6);
            barra.Resize += (s, e) => menu.Left = barra.Width - 54;
            menu.Click += (s, e) => MenuPrincipal().Show(menu, new Point(menu.Width - 220, menu.Height));
            barra.Controls.Add(menu);

            faixa.Dock = DockStyle.Top; faixa.Height = 40; faixa.Visible = false; faixa.BackColor = Cores.Escuro ? Color.FromArgb(40, 52, 80) : Color.FromArgb(232, 240, 254);
            faixaTexto.AutoSize = true; faixaTexto.Location = new Point(16, 11); faixaTexto.ForeColor = Cores.Texto;
            faixaBotao.AutoSize = true; faixaBotao.FlatStyle = FlatStyle.Flat; faixaBotao.Location = new Point(320, 5); faixaBotao.ForeColor = Cores.Texto;
            faixa.Controls.Add(faixaTexto); faixa.Controls.Add(faixaBotao);

            grade.Dock = DockStyle.Fill; grade.Padding = new Padding(16); grade.AutoScroll = true; grade.BackColor = Cores.Fundo;

            // painel na própria janela (sem caixas de diálogo): cartão no centro sobre um fundo
            fundoPainel.Dock = DockStyle.Fill; fundoPainel.Visible = false; fundoPainel.BackColor = Cores.Escuro ? Color.FromArgb(18, 18, 20) : Color.FromArgb(214, 218, 226);
            painel.BackColor = Cores.Cartao; painel.Padding = new Padding(18); painel.AutoScroll = true;
            fundoPainel.Controls.Add(painel);
            fundoPainel.Resize += (s, e) => CentralizarPainel();

            Controls.Add(fundoPainel);
            Controls.Add(grade);
            Controls.Add(faixa);
            Controls.Add(barra);

            catalogo = Ferramentas.Embutido();
            Desenhar();
            Shown += async (s, e) =>
            {
                catalogo = await Task.Run(() => Ferramentas.Carregar());
                Desenhar();
                ProcurarAtualizacoes(false);
            };
        }

        Ferramenta F(string id) { return catalogo.ferramentas.FirstOrDefault(x => x.id == id); }

        static string Mb(long b) { return b >= 1000000000 ? (b / 1e9).ToString("0.0") + " GB" : Math.Max(0.1, b / 1e6).ToString(b < 10000000 ? "0.0" : "0") + " MB"; }

        // ---------- tela inicial ----------
        void Desenhar()
        {
            grade.SuspendLayout();
            grade.Controls.Clear();
            Bloco("⌨", T.Tx("Linux"), "linux", () => Usar("linux", f => Ferramentas.Abrir(f)));
            Bloco("❮❯", T.Tx("Código"), Editor, () => Usar(Editor, f => Ferramentas.Abrir(f)));
            Bloco("▤", T.Tx("Documentos"), "onlyoffice", () => Usar("onlyoffice", f => Ferramentas.Abrir(f)));
            Bloco("⎙", T.Tx("PDF"), "qpdf", PainelPdf);
            Bloco("✂", T.Tx("Cortar vídeo"), "ffmpeg", () => Usar("ffmpeg", f => PainelVideo(f)));
            Bloco("◉", T.Tx("Webcam"), "webcam", () => Usar("webcam", f => Ferramentas.Abrir(f)));
            Bloco("⇄", T.Tx("Transferir"), "transferir", () => Usar("transferir", f => Ferramentas.Abrir(f)));
            Bloco("⌂", T.Tx("Mais apps"), null, () => Process.Start(Ferramentas.SITE));
            grade.ResumeLayout();
        }

        void Bloco(string icone, string nome, string id, Action acao)
        {
            var f = id != null ? F(id) : null;
            string estado = id == null ? T.Tx("no navegador") : f == null ? "" : Ferramentas.Instalada(f) ? T.Tx("Abrir") : T.Tx("Baixar · {0}", Mb(f.baixar));
            var b = new Button { Width = 150, Height = 120, Margin = new Padding(8), FlatStyle = FlatStyle.Flat, BackColor = Cores.Cartao, ForeColor = Cores.Texto, Cursor = Cursors.Hand };
            b.FlatAppearance.BorderColor = Cores.Linha;
            b.Paint += (s, e) =>
            {
                var g = e.Graphics; g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                var r = b.ClientRectangle;
                TextRenderer.DrawText(g, icone, fonteIcone, new Rectangle(0, 14, r.Width, 40), Cores.Acento, TextFormatFlags.HorizontalCenter);
                TextRenderer.DrawText(g, nome, fonte, new Rectangle(0, 62, r.Width, 22), Cores.Texto, TextFormatFlags.HorizontalCenter);
                TextRenderer.DrawText(g, estado, new Font("Segoe UI", 8.5f), new Rectangle(0, 86, r.Width, 20), Cores.Fraco, TextFormatFlags.HorizontalCenter);
            };
            b.Click += (s, e) => { try { acao(); } catch (Exception ex) { Aviso(ex.Message); } };
            grade.Controls.Add(b);
        }

        // Abre a ferramenta; se ainda não está no PC, mostra antes o cartão de download.
        void Usar(string id, Action<Ferramenta> abrir)
        {
            var f = F(id);
            if (f == null) { Aviso(T.Tx("{0} não está instalado.", id)); return; }
            if (Ferramentas.Instalada(f)) { abrir(f); return; }
            CartaoInstalar(f, () => abrir(f));
        }

        // ---------- painel genérico ----------
        void MostrarPainel(string titulo, IEnumerable<Control> itens)
        {
            painel.SuspendLayout();
            painel.Controls.Clear();
            var col = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, Dock = DockStyle.Top, BackColor = Cores.Cartao };
            var topo = new Panel { Width = 460, Height = 34 };
            topo.Controls.Add(new Label { Text = titulo, Font = fonteTitulo, AutoSize = true, Location = new Point(0, 4), ForeColor = Cores.Texto });
            var x = new Button { Text = "✕", Width = 32, Height = 30, FlatStyle = FlatStyle.Flat, Location = new Point(428, 0), ForeColor = Cores.Fraco };
            x.FlatAppearance.BorderSize = 0;
            x.Click += (s, e) => FecharPainel();
            topo.Controls.Add(x);
            col.Controls.Add(topo);
            foreach (var c in itens) col.Controls.Add(c);
            painel.Controls.Add(col);
            painel.ResumeLayout();
            fundoPainel.Visible = true; fundoPainel.BringToFront();
            CentralizarPainel();
        }

        void CentralizarPainel()
        {
            var col = painel.Controls.Count > 0 ? painel.Controls[0] : null;
            int h = Math.Min(fundoPainel.Height - 40, (col != null ? col.PreferredSize.Height : 200) + 40);
            painel.Size = new Size(500, Math.Max(160, h));
            painel.Location = new Point(Math.Max(0, (fundoPainel.Width - painel.Width) / 2), Math.Max(10, (fundoPainel.Height - painel.Height) / 2));
        }

        void FecharPainel() { if (cancelar != null) cancelar.Cancel(); fundoPainel.Visible = false; Desenhar(); }

        Label Texto(string t, bool fraco = false) { return new Label { Text = t, AutoSize = true, MaximumSize = new Size(460, 0), ForeColor = fraco ? Cores.Fraco : Cores.Texto, Margin = new Padding(0, 4, 0, 4) }; }

        Button Botao(string t, bool principal = false)
        {
            var b = new Button { Text = t, AutoSize = true, MinimumSize = new Size(110, 34), FlatStyle = FlatStyle.Flat, Margin = new Padding(0, 6, 8, 0), BackColor = principal ? Cores.Verde : Cores.Cartao, ForeColor = principal ? Color.White : Cores.Texto };
            b.FlatAppearance.BorderColor = principal ? Cores.Verde : Cores.Linha;
            return b;
        }

        FlowLayoutPanel Linha(params Control[] c)
        {
            var l = new FlowLayoutPanel { AutoSize = true, WrapContents = true, MaximumSize = new Size(460, 0), Margin = new Padding(0) };
            l.Controls.AddRange(c);
            return l;
        }

        void Aviso(string texto) { MostrarPainel("InkDOS Hub", new Control[] { Texto(texto) }); }

        // ---------- cartão de download ----------
        void CartaoInstalar(Ferramenta f, Action depois)
        {
            var itens = new List<Control>();
            Func<string, string, Control> campo = (k, v) => Texto(k + ": " + v);
            string host = new Uri(f.url).Host;
            itens.Add(campo(T.Tx("De onde vem"), host + "  (" + f.pagina + ")"));
            itens.Add(campo(T.Tx("Quem publica"), f.publica));
            itens.Add(campo(T.Tx("Licença"), f.licenca));
            itens.Add(campo(T.Tx("Versão"), f.versao));
            itens.Add(campo(T.Tx("Download"), Mb(f.baixar) + "   ·   " + T.Tx("No disco (aprox.)") + ": " + Mb((long)f.instalado_mb * 1000000) + "   ·   " + T.Tx("Livre no PC") + ": " + Mb(Ferramentas.EspacoLivre())));
            itens.Add(campo(T.Tx("O que acessa"), f.acesso));
            itens.Add(Texto(T.Tx("Segurança") + ": " + (string.IsNullOrEmpty(f.assinante)
                ? T.Tx("Antes de instalar, o InkDOS Hub confere a impressão digital (SHA-256) do arquivo. Este fabricante não assina o programa.")
                : T.Tx("Antes de instalar, o InkDOS Hub confere a impressão digital (SHA-256) do arquivo e a assinatura digital de {0}.", f.assinante)), true));
            itens.Add(Texto("SHA-256: " + f.sha256, true));

            var barra = new ProgressBar { Width = 460, Height = 8, Visible = false, Margin = new Padding(0, 8, 0, 0) };
            var estado = Texto("", true);
            var nao = Botao(T.Tx("Cancelar"));
            var sim = Botao(T.Tx("Baixar e instalar"), true);
            nao.Click += (s, e) => FecharPainel();

            if (f.tipo == "wsl" && !Wsl.Ligado())
            {
                itens.Add(Texto(T.Tx("O Linux roda no WSL, que vem com o Windows mas precisa ser ligado uma vez (pede permissão de administrador e, às vezes, reiniciar).")));
                var ligar = Botao(T.Tx("Ligar o WSL"), true);
                ligar.Click += async (s, e) => { ligar.Enabled = false; try { await Task.Run(() => Wsl.Ligar()); } catch (Exception ex) { estado.Text = T.Tx("Falhou: {0}", ex.Message); } ligar.Enabled = true; CartaoInstalar(f, depois); };
                itens.Add(Linha(nao, ligar));
                itens.Add(estado);
                MostrarPainel(T.Tx("Instalar {0}?", f.nome), itens);
                return;
            }

            sim.Click += async (s, e) =>
            {
                sim.Enabled = false; barra.Visible = true;
                cancelar = new CancellationTokenSource();
                var tk = cancelar.Token;
                try
                {
                    await Task.Run(() => Ferramentas.Instalar(f,
                        p => BeginInvoke((Action)(() => barra.Value = p)),
                        t => BeginInvoke((Action)(() => estado.Text = t)), tk));
                    estado.Text = T.Tx("Verificado ✓") + "  " + T.Tx("Pronto.");
                    estado.ForeColor = Cores.Verde;
                    sim.Text = T.Tx("Abrir"); sim.Enabled = true;
                    sim.Click += (s2, e2) => { FecharPainel(); try { depois(); } catch (Exception ex) { Aviso(ex.Message); } };
                }
                catch (OperationCanceledException) { }
                catch (Exception ex) { estado.Text = T.Tx("Falhou: {0}", ex.Message); estado.ForeColor = Color.IndianRed; sim.Enabled = true; }
                finally { cancelar = null; }
            };
            itens.Add(barra);
            itens.Add(estado);
            itens.Add(Linha(nao, sim));
            MostrarPainel(T.Tx("Instalar {0}?", f.nome), itens);
        }

        // ---------- ☰ ----------
        ContextMenuStrip MenuPrincipal()
        {
            var m = new ContextMenuStrip { Font = fonte };
            m.Items.Add(T.Tx("Ferramentas guardadas"), null, (s, e) => PainelGuardadas());
            m.Items.Add(T.Tx("Procurar atualizações"), null, (s, e) => ProcurarAtualizacoes(true));
            m.Items.Add(new ToolStripSeparator());
            var vs = new ToolStripMenuItem(T.Tx("Editor de código: VS Code")) { Checked = Editor == "vscode" };
            vs.Click += (s, e) => { Editor = "vscode"; Desenhar(); };
            var zed = new ToolStripMenuItem(T.Tx("Editor de código: Zed (leve)")) { Checked = Editor == "zed" };
            zed.Click += (s, e) => { Editor = "zed"; Desenhar(); };
            m.Items.Add(vs); m.Items.Add(zed);
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add(T.Tx("Segurança e privacidade"), null, (s, e) => PainelSeguranca());
            m.Items.Add(T.Tx("Abrir o InkDOS Hub no navegador"), null, (s, e) => Process.Start(Ferramentas.SITE));
            return m;
        }

        void PainelGuardadas()
        {
            var itens = new List<Control>();
            long total = 0;
            foreach (var f in catalogo.ferramentas.Where(Ferramentas.Instalada))
            {
                long n = Ferramentas.TamanhoNoDisco(f); total += n;
                var rem = Botao(T.Tx("Remover"));
                var linha = Linha(new Label { Text = "✓ " + f.nome + "  ·  " + Mb(n), AutoSize = true, ForeColor = Cores.Texto, Margin = new Padding(0, 12, 12, 0) }, rem);
                var ff = f;
                rem.Click += (s, e) =>
                {
                    // confirmação na própria janela
                    var sim = Botao(T.Tx("Remover"), true); sim.BackColor = Color.IndianRed; sim.FlatAppearance.BorderColor = Color.IndianRed;
                    var nao = Botao(T.Tx("Cancelar"));
                    var conf = Linha(Texto(T.Tx("Remover {0} deste PC?", ff.nome)), nao, sim);
                    int i = linha.Parent.Controls.GetChildIndex(linha);
                    linha.Parent.Controls.Add(conf); linha.Parent.Controls.SetChildIndex(conf, i + 1);
                    nao.Click += (s2, e2) => conf.Dispose();
                    sim.Click += (s2, e2) => { try { Ferramentas.Remover(ff); } catch (Exception ex) { Aviso(ex.Message); return; } PainelGuardadas(); };
                    CentralizarPainel();
                };
                itens.Add(linha);
            }
            if (itens.Count == 0) itens.Add(Texto(T.Tx("Nenhuma ferramenta guardada ainda.")));
            itens.Add(Texto(T.Tx("Total no disco: {0}", Mb(total)) + "   ·   " + T.Tx("Livre no PC") + ": " + Mb(Ferramentas.EspacoLivre()), true));
            itens.Add(Texto(T.Tx("Programas com instalador próprio também aparecem em Configurações > Apps do Windows."), true));
            MostrarPainel(T.Tx("Ferramentas guardadas"), itens);
        }

        void PainelSeguranca()
        {
            MostrarPainel(T.Tx("Segurança e privacidade"), new Control[]
            {
                Texto(T.Pt ? "O InkDOS Hub não coleta nem envia dados. Não tem conta, anúncios nem estatísticas." : "InkDOS Hub does not collect or send data. No accounts, ads or analytics."),
                Texto(T.Pt ? "Cada ferramenta vem só do site oficial de quem a publica. Antes de instalar, o InkDOS Hub confere a impressão digital (SHA-256) publicada pela fonte e, quando existe, a assinatura digital do fabricante. Se algo não bater, nada é instalado." : "Each tool comes only from its publisher's official site. Before installing, InkDOS Hub checks the SHA-256 fingerprint published by the source and, when present, the publisher's digital signature. If anything does not match, nothing is installed."),
                Texto(T.Pt ? "Código aberto (MIT): github.com/InkDOSHub/inkdoshub.github.io. Revisões do código em auditoria/." : "Open source (MIT): github.com/InkDOSHub/inkdoshub.github.io. Code reviews in auditoria/.", true),
            });
        }

        // ---------- atualizações ----------
        async void ProcurarAtualizacoes(bool mostrar)
        {
            var velhas = catalogo.ferramentas.Where(Ferramentas.TemAtualizacao).ToList();
            bool hub = await Task.Run(() => Atualizador.TemVersaoNova());
            if (hub)
            {
                faixaTexto.Text = T.Tx("Atualização disponível") + ": InkDOS Hub";
                faixaBotao.Text = T.Tx("Atualizar");
                faixaBotao.Left = faixaTexto.Right + 12;
                faixaBotao.Click -= AtualizarHub; faixaBotao.Click += AtualizarHub;
                faixa.Visible = true;
            }
            if (!mostrar && velhas.Count == 0) return;
            if (!mostrar) { faixaTexto.Text = T.Tx("Atualização disponível"); faixaBotao.Text = T.Tx("Atualizar"); faixaBotao.Left = faixaTexto.Right + 12; faixaBotao.Click -= AtualizarHub; faixaBotao.Click += (s, e) => ProcurarAtualizacoes(true); faixa.Visible = true; return; }
            var itens = new List<Control>();
            if (velhas.Count == 0 && !hub) itens.Add(Texto(T.Tx("Tudo atualizado.")));
            foreach (var f in velhas)
            {
                var b = Botao(T.Tx("Atualizar {0} ({1} → {2})", f.nome, Ferramentas.VersaoInstalada(f), f.versao));
                var ff = f;
                b.Click += (s, e) => CartaoInstalar(ff, () => { });
                itens.Add(b);
            }
            if (hub) { var b = Botao(T.Tx("Atualizar o InkDOS Hub"), true); b.Click += AtualizarHub; itens.Add(b); }
            MostrarPainel(T.Tx("Procurar atualizações"), itens);
        }

        async void AtualizarHub(object s, EventArgs e)
        {
            faixaBotao.Enabled = false; faixaTexto.Text = T.Tx("Trabalhando…");
            try { await Task.Run(() => Atualizador.Instalar()); Application.Restart(); Environment.Exit(0); }
            catch (Exception ex) { faixaTexto.Text = T.Tx("Falhou: {0}", ex.Message); faixaBotao.Enabled = true; }
        }

        // ---------- PDF (qpdf e Ghostscript, nativos) ----------
        void PainelPdf()
        {
            var estado = Texto("", true);
            var juntar = Botao(T.Tx("Juntar PDFs"), true);
            var girar = Botao(T.Tx("Girar páginas"));
            var comprimir = Botao(T.Tx("Comprimir PDF"));
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
            MostrarPainel(T.Tx("PDF"), new Control[] { Linha(juntar, girar, comprimir), estado });
        }

        async void Trabalho(Label estado, Func<string> tarefa, string saida)
        {
            if (!fundoPainel.Visible) PainelPdf();
            estado.Text = T.Tx("Trabalhando…");
            string erro = await Task.Run(tarefa);
            estado.Text = erro == null ? T.Tx("Salvo: {0}", saida) : T.Tx("Falhou: {0}", erro);
            if (erro == null) try { Process.Start("explorer.exe", "/select,\"" + saida + "\""); } catch { }
        }

        // ---------- Cortar vídeo (ffmpeg, sem recompactar) ----------
        void PainelVideo(Ferramenta f)
        {
            string arquivo = null;
            var estado = Texto("", true);
            var nome = Texto("—");
            var ini = new TextBox { Width = 90, Text = "00:00" };
            var fim = new TextBox { Width = 90, Text = "00:10" };
            var escolher = Botao(T.Tx("Escolher vídeo"));
            var cortar = Botao(T.Tx("Cortar"), true);
            escolher.Click += (s, e) => { var a = new OpenFileDialog { Filter = "Vídeo|*.mp4;*.mov;*.mkv;*.webm;*.avi;*.m4v|*.*|*.*" }; if (a.ShowDialog(this) == DialogResult.OK) { arquivo = a.FileName; nome.Text = Path.GetFileName(arquivo); } };
            cortar.Click += async (s, e) =>
            {
                if (arquivo == null) return;
                string saida = Path.Combine(Path.GetDirectoryName(arquivo), Path.GetFileNameWithoutExtension(arquivo) + " (cortado)" + Path.GetExtension(arquivo));
                estado.Text = T.Tx("Trabalhando…");
                string args = "-y -ss " + ini.Text.Trim() + " -to " + fim.Text.Trim() + " -i \"" + arquivo + "\" -c copy -map 0 \"" + saida + "\"";
                string erro = await Task.Run(() => Ferramentas.Rodar(Ferramentas.Executavel(f), args));
                estado.Text = erro == null ? T.Tx("Salvo: {0}", saida) : T.Tx("Falhou: {0}", erro.Split('\n').Last());
                if (erro == null) try { Process.Start("explorer.exe", "/select,\"" + saida + "\""); } catch { }
            };
            MostrarPainel(T.Tx("Cortar vídeo"), new Control[]
            {
                Linha(escolher, nome),
                Linha(Texto(T.Tx("Início (mm:ss)")), ini, Texto(T.Tx("Fim (mm:ss)")), fim),
                Texto(T.Tx("Corta sem recompactar: é rápido e não perde qualidade (o corte cai no quadro-chave mais próximo)."), true),
                cortar, estado
            });
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
