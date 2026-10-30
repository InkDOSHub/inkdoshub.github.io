// Tela inicial: a mesma gaveta de apps do site (marca, barra com ☰, busca e pasta, ícones de 76 px, rodapé),
// pintada num único controle. Os apps com versão nativa ganham o check verde quando já estão neste PC.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace InkDOSHub
{
    class App
    {
        public string Nome, Ferramenta, Dica;
        public Image Icone;
        public Action Acao;
        public Rectangle Caixa, IconeR, TextoR;
    }

    class Inicio : Control
    {
        public readonly List<App> Apps = new List<App>();
        public readonly TextBox Busca = new TextBox();
        public HashSet<string> Instaladas = new HashSet<string>();
        public string Aviso; public Action AvisoAcao;
        public event Action Menu, AbrirArquivo, CodigoFonte;
        public Rectangle MenuR { get { return menuR; } }

        readonly Image marca;
        readonly Dictionary<Image, Bitmap> reduzidas = new Dictionary<Image, Bitmap>();
        readonly ToolTip dica = new ToolTip();
        Rectangle marcaR, menuR, buscaR, abrirR, rodapeR, linkR, avisoR;
        List<App> visiveis = new List<App>();
        int rolagem, total, sobre = -1, apertado = -1, sobreBotao;  // sobreBotao: 1 ☰, 2 pasta, 3 link, 4 aviso
        string rodape;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, string l);

        public Inicio(Image marca)
        {
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
            this.marca = marca;
            Busca.BorderStyle = BorderStyle.None;
            Busca.TextChanged += (s, e) => { rolagem = 0; Arrumar(); };
            Controls.Add(Busca);
            Tema();
        }

        public void Tema()
        {
            BackColor = Ui.Fundo;
            Busca.Font = Ui.Fonte(14);
            Busca.BackColor = Ui.Mistura(Ui.Fundo, Ui.Hover);
            Busca.ForeColor = Ui.Texto;
            rodape = T.Tx("Os arquivos ficam neste PC e nada é enviado. As ferramentas são projetos de código aberto; veja a licença de cada uma no ☰.");
            Arrumar();
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try { SendMessage(Busca.Handle, 0x1501, (IntPtr)1, T.Tx("Buscar")); } catch { }  // texto de exemplo na busca
        }

        static string Simples(string s)
        {
            var sb = new StringBuilder();
            foreach (char c in s.Normalize(NormalizationForm.FormD))
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(char.ToLowerInvariant(c));
            return sb.ToString();
        }

        Bitmap Reduzida(Image i, int lado)
        {
            Bitmap b;
            if (reduzidas.TryGetValue(i, out b) && b.Width == lado) return b;
            b = new Bitmap(lado, lado);
            using (var g = Graphics.FromImage(b)) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.PixelOffsetMode = PixelOffsetMode.HighQuality; g.DrawImage(i, 0, 0, lado, lado); }
            reduzidas[i] = b;
            return b;
        }

        public void Arrumar()
        {
            int W = ClientSize.Width;
            bool estreito = W < Ui.P(720);
            int larg = estreito ? W - Ui.P(28) : Math.Min(Ui.P(1180), W - Ui.P(64));
            int x0 = (W - larg) / 2, y = (estreito ? Ui.P(20) : Ui.P(30)) - rolagem;
            marcaR = new Rectangle(x0, y, larg, Ui.P(46));
            y += Ui.P(46) + Ui.P(24);
            menuR = new Rectangle(x0, y, Ui.P(34), Ui.P(34));
            abrirR = new Rectangle(x0 + larg - Ui.P(34), y, Ui.P(34), Ui.P(34));
            buscaR = new Rectangle(menuR.Right + Ui.P(8), y, abrirR.X - Ui.P(8) - menuR.Right - Ui.P(8), Ui.P(32));
            buscaR.Y += Ui.P(1);
            int bh = Busca.PreferredHeight;
            Busca.SetBounds(buscaR.X + Ui.P(12), buscaR.Y + (buscaR.Height - bh) / 2, buscaR.Width - Ui.P(24), bh);
            y += Ui.P(34) + Ui.P(22);

            string q = Simples(Busca.Text.Trim());
            visiveis = Apps.Where(a => q.Length == 0 || Simples(a.Nome).Contains(q)).ToList();
            int min = Ui.P(estreito ? 80 : 108), gx = Ui.P(estreito ? 6 : 10), gy = Ui.P(estreito ? 20 : 26), ic = Ui.P(estreito ? 62 : 76);
            int n = Math.Max(1, (larg + gx) / (min + gx));
            float cw = (larg - gx * (n - 1)) / (float)n;
            var fonte = Ui.Fonte(estreito ? 12 : 13);
            for (int i = 0; i < visiveis.Count; i += n)
            {
                int linhas = 1;
                var fila = visiveis.Skip(i).Take(n).ToList();
                foreach (var a in fila)
                    linhas = Math.Max(linhas, TextRenderer.MeasureText(a.Nome, fonte, new Size((int)cw - Ui.P(4), int.MaxValue), TextFormatFlags.WordBreak | TextFormatFlags.NoPadding).Height / Math.Max(1, fonte.Height));
                int lh = (int)(fonte.Height * 1.1f);
                int h = Ui.P(6) + ic + Ui.P(9) + lh * linhas + Ui.P(6);
                for (int k = 0; k < fila.Count; k++)
                {
                    var a = fila[k];
                    int x = x0 + (int)(k * (cw + gx));
                    a.Caixa = new Rectangle(x, y, (int)cw, h);
                    a.IconeR = new Rectangle(x + ((int)cw - ic) / 2, y + Ui.P(6), ic, ic);
                    a.TextoR = new Rectangle(x + Ui.P(2), a.IconeR.Bottom + Ui.P(9), (int)cw - Ui.P(4), lh * linhas + Ui.P(2));
                }
                y += h + gy;
            }
            if (visiveis.Count > 0) y -= gy;
            y += Ui.P(42);
            var lf = Ui.Fonte(12);
            int lw = TextRenderer.MeasureText(T.Tx("Código-fonte"), lf).Width;
            int th = TextRenderer.MeasureText(rodape, lf, new Size(larg - lw - Ui.P(24), int.MaxValue), TextFormatFlags.WordBreak).Height;
            int baixo = Ui.P(Aviso != null ? 72 : 26);  // rodapé no fim da janela, como o margin-top:auto do site
            if (y + th + baixo < ClientSize.Height) y = ClientSize.Height - baixo - th;
            rodapeR = new Rectangle(x0, y, larg - lw - Ui.P(24), th);
            linkR = new Rectangle(x0 + larg - lw, y, lw, lf.Height);
            y += th + baixo;
            total = y + rolagem;
            if (Aviso != null)
            {
                int aw = TextRenderer.MeasureText(Aviso, Ui.Fonte(14, true)).Width + Ui.P(34);
                avisoR = new Rectangle((W - aw) / 2, ClientSize.Height - Ui.P(16) - Ui.P(40), aw, Ui.P(40));
            }
            Invalidate();
        }

        protected override void OnResize(EventArgs e) { base.OnResize(e); rolagem = Math.Max(0, Math.Min(rolagem, total - ClientSize.Height)); Arrumar(); }

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            int novo = Math.Max(0, Math.Min(rolagem - e.Delta * Ui.P(60) / 120, total - ClientSize.Height));
            if (novo != rolagem) { rolagem = novo; Arrumar(); }
        }

        int Alvo(Point p, out int botao)
        {
            botao = Aviso != null && avisoR.Contains(p) ? 4 : menuR.Contains(p) ? 1 : abrirR.Contains(p) ? 2 : linkR.Contains(p) ? 3 : 0;
            if (botao != 0) return -1;
            return visiveis.FindIndex(a => a.IconeR.Contains(p) || a.TextoR.Contains(p));
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            int b, i = Alvo(e.Location, out b);
            if (i != sobre || b != sobreBotao)
            {
                sobre = i; sobreBotao = b;
                Cursor = i >= 0 || b != 0 ? Cursors.Hand : Cursors.Default;
                dica.SetToolTip(this, i >= 0 ? visiveis[i].Dica : b == 1 ? "Menu" : b == 2 ? T.Tx("Abrir arquivo") : null);
                Invalidate();
            }
        }
        protected override void OnMouseLeave(EventArgs e) { sobre = -1; sobreBotao = 0; apertado = -1; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e)
        {
            Focus();
            int b; apertado = Alvo(e.Location, out b);
            Invalidate();
            base.OnMouseDown(e);
        }
        protected override void OnMouseUp(MouseEventArgs e)
        {
            int b, i = Alvo(e.Location, out b), antes = apertado;
            apertado = -1; Invalidate();
            if (e.Button != MouseButtons.Left) return;
            if (b == 1) { var m = Menu; if (m != null) m(); }
            else if (b == 2) { var a = AbrirArquivo; if (a != null) a(); }
            else if (b == 3) { var c = CodigoFonte; if (c != null) c(); }
            else if (b == 4) { if (AvisoAcao != null) AvisoAcao(); }
            else if (i >= 0 && i == antes) visiveis[i].Acao();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Ui.Fundo);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;

            // marca: ícone de 42 px com cantos de 10 px, nome e "Ferramentas avançadas"
            var mr = new Rectangle(marcaR.X, marcaR.Y + (marcaR.Height - Ui.P(42)) / 2, Ui.P(42), Ui.P(42));
            using (var p = Ui.Arred(mr, Ui.P(10)))
            {
                g.SetClip(p);
                int extra = (int)(mr.Width * .052f);  // o PNG tem margem clara: ampliar 1,104x como no site
                g.DrawImage(marca, Rectangle.Inflate(mr, extra, extra));
                g.ResetClip();
            }
            int tx = mr.Right + Ui.P(12);
            Ui.Escrever(g, "InkDOS Hub", Ui.Fonte(19, false, true), new Rectangle(tx, mr.Y + Ui.P(1), Ui.P(300), Ui.P(24)), Ui.Texto);
            Ui.Escrever(g, T.Tx("Ferramentas avançadas"), Ui.Fonte(12), new Rectangle(tx, mr.Y + Ui.P(25), Ui.P(300), Ui.P(16)), Ui.Fraco);

            // barra: ☰, busca, pasta
            if (sobreBotao == 1) Ui.Preencher(g, menuR, Ui.P(8), Ui.Hover);
            if (sobreBotao == 2) Ui.Preencher(g, abrirR, Ui.P(8), Ui.Hover);
            using (var p = new Pen(sobreBotao == 1 ? Ui.Texto : Ui.Fraco, 1.8f * Ui.E) { StartCap = LineCap.Round, EndCap = LineCap.Round })
            {
                float u = Ui.E * 20 / 24f, ox = menuR.X + (menuR.Width - 20 * Ui.E) / 2, oy = menuR.Y + (menuR.Height - 20 * Ui.E) / 2;
                foreach (float yy in new[] { 7f, 12f, 17f }) g.DrawLine(p, ox + 4 * u, oy + yy * u, ox + 20 * u, oy + yy * u);
            }
            using (var p = new Pen(sobreBotao == 2 ? Ui.Texto : Ui.Fraco, 1.8f * Ui.E) { LineJoin = LineJoin.Round })
            {
                float u = Ui.E * 20 / 24f, ox = abrirR.X + (abrirR.Width - 20 * Ui.E) / 2, oy = abrirR.Y + (abrirR.Height - 20 * Ui.E) / 2;
                Func<float, float, PointF> pt = (a, b) => new PointF(ox + a * u, oy + b * u);
                g.DrawPolygon(p, new[] { pt(3, 19), pt(3, 5), pt(9, 5), pt(11, 7), pt(21, 7), pt(21, 19) });
            }
            Ui.Preencher(g, buscaR, Ui.P(8), Ui.Mistura(Ui.Fundo, Ui.Hover));

            // apps
            bool estreito = ClientSize.Width < Ui.P(720);
            var fonte = Ui.Fonte(estreito ? 12 : 13);
            int img = Ui.P(estreito ? 40 : 50);
            for (int i = 0; i < visiveis.Count; i++)
            {
                var a = visiveis[i];
                if (a.Caixa.Bottom < 0 || a.Caixa.Top > ClientSize.Height) continue;
                RectangleF r = a.IconeR;
                if (i == apertado) r.Inflate(-r.Width * .035f, -r.Height * .035f);  // .workspace-card:active → scale(.93)
                Ui.Preencher(g, r, r.Width * 19 / 76f, Ui.Cartao, Ui.Borda);
                var bmp = Reduzida(a.Icone, img);
                float k = r.Width / a.IconeR.Width;
                g.DrawImage(bmp, r.X + (r.Width - img * k) / 2, r.Y + (r.Height - img * k) / 2, img * k, img * k);
                if (a.Ferramenta != null && Instaladas.Contains(a.Ferramenta))
                {
                    float c = Ui.P(20);
                    var cr = new RectangleF(r.Right - c * .7f, r.Y - c * .3f, c, c);
                    using (var b = new SolidBrush(Ui.Fundo)) g.FillEllipse(b, RectangleF.Inflate(cr, Ui.E * 2, Ui.E * 2));
                    Ui.Check(g, cr, true, false);
                }
                Ui.Escrever(g, a.Nome, fonte, a.TextoR, Ui.Texto, TextFormatFlags.HorizontalCenter | TextFormatFlags.WordBreak);
            }

            // rodapé
            Ui.Escrever(g, rodape, Ui.Fonte(12), rodapeR, Ui.Rodape, TextFormatFlags.WordBreak);
            Ui.Escrever(g, T.Tx("Código-fonte"), Ui.Fonte(12), linkR, sobreBotao == 3 ? Ui.Texto : Ui.Rodape);

            // aviso de atualização (.aviso-atualizar)
            if (Aviso != null)
            {
                for (int k = 1; k <= 3; k++) { var s = RectangleF.Inflate(avisoR, k * Ui.E * 2, k * Ui.E * 2); s.Offset(0, Ui.P(3)); Ui.Preencher(g, s, s.Height / 2, Color.FromArgb(10, 0, 0, 0)); }
                Ui.Preencher(g, avisoR, avisoR.Height / 2f, sobreBotao == 4 ? Ui.Mistura(Ui.Cartao, Ui.AcentoSuave) : Ui.Cartao, Ui.Borda);
                Ui.Escrever(g, Aviso, Ui.Fonte(14, true), avisoR, Ui.Texto, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            }
        }
    }
}
