// Peças da interface, desenhadas à mão com as cores e medidas da tela inicial do site (assets/home.css).
// Sem motor web: cada peça é um controle WinForms leve que se pinta sozinho.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace InkDOSHub
{
    interface IAltura { int Altura(int largura); }

    static class Ui
    {
        public static float E = 1f;                       // escala do monitor (100% = 1)
        public static int P(float px) { return (int)Math.Round(px * E); }
        public static bool Escuro;
        public static Action Refazer = () => { };         // refaz o painel aberto quando um texto muda de altura

        static Color C(int rgb) { return Color.FromArgb(255, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255); }
        public static Color Fundo { get { return Escuro ? C(0x1c1c1e) : C(0xf5f5f7); } }
        public static Color Cartao { get { return Escuro ? C(0x2c2c2e) : C(0xffffff); } }
        public static Color Texto { get { return Escuro ? C(0xf5f5f7) : C(0x1d1d1f); } }
        public static Color Fraco { get { return Escuro ? C(0x98989d) : C(0x6e6e73); } }
        public static Color Rodape { get { return Escuro ? C(0x8e8e93) : C(0x86868b); } }
        public static Color Borda { get { return Escuro ? Color.FromArgb(31, 255, 255, 255) : Color.FromArgb(26, 0, 0, 0); } }
        public static Color Hover { get { return Escuro ? Color.FromArgb(20, 255, 255, 255) : Color.FromArgb(15, 0, 0, 0); } }
        public static Color Acento { get { return Escuro ? C(0x0a84ff) : C(0x007aff); } }
        public static Color AcentoSuave { get { return Escuro ? Color.FromArgb(46, 10, 132, 255) : Color.FromArgb(26, 0, 122, 255); } }
        public static Color Perigo { get { return Escuro ? C(0xff6961) : C(0xd70015); } }
        public static readonly Color Verde = Color.FromArgb(31, 157, 85);

        // cor com transparência já misturada sobre um fundo (para controles nativos, que não aceitam alfa)
        public static Color Mistura(Color fundo, Color c)
        {
            float a = c.A / 255f;
            return Color.FromArgb((int)(fundo.R + (c.R - fundo.R) * a), (int)(fundo.G + (c.G - fundo.G) * a), (int)(fundo.B + (c.B - fundo.B) * a));
        }

        static readonly Dictionary<string, Font> fontes = new Dictionary<string, Font>();
        public static Font Fonte(float px, bool forte = false, bool negrito = false)
        {
            string k = px + "|" + forte + "|" + negrito + "|" + E;
            Font f;
            if (!fontes.TryGetValue(k, out f))
                fontes[k] = f = new Font(forte ? "Segoe UI Semibold" : "Segoe UI", px * E, negrito ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel);
            return f;
        }

        public static GraphicsPath Arred(RectangleF r, float raio)
        {
            var p = new GraphicsPath();
            float d = Math.Min(raio * 2, Math.Min(r.Width, r.Height));
            if (d <= 0) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static void Preencher(Graphics g, RectangleF r, float raio, Color cor, Color? borda = null)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var p = Arred(r, raio))
            {
                using (var b = new SolidBrush(cor)) g.FillPath(b, p);
                if (borda.HasValue) using (var l = new Pen(borda.Value, Math.Max(1, E))) g.DrawPath(l, p);
            }
        }

        // o check verde do Modo Offline do site: vazio, marcado ou girando enquanto baixa
        public static void Check(Graphics g, RectangleF r, bool marcado, bool girando)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float w = 1.5f * E;
            var c = RectangleF.Inflate(r, -w / 2, -w / 2);
            if (girando)
            {
                using (var p = new Pen(Borda, w)) g.DrawEllipse(p, c);
                using (var p = new Pen(Verde, w * 1.4f)) g.DrawArc(p, c, (Environment.TickCount / 3) % 360, 270);
                return;
            }
            if (!marcado) { using (var p = new Pen(Mistura(Cartao, Borda), w)) g.DrawEllipse(p, c); return; }
            using (var b = new SolidBrush(Verde)) g.FillEllipse(b, r);
            using (var p = new Pen(Color.White, 1.8f * E) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                g.DrawLines(p, new[] { new PointF(r.X + r.Width * .28f, r.Y + r.Height * .52f), new PointF(r.X + r.Width * .44f, r.Y + r.Height * .67f), new PointF(r.X + r.Width * .73f, r.Y + r.Height * .35f) });
        }

        public static int AlturaDe(Control c, int w)
        {
            var a = c as IAltura;
            return a != null ? a.Altura(w) : c.GetPreferredSize(new Size(w, 0)).Height;
        }

        public static void Escrever(Graphics g, string t, Font f, Rectangle r, Color cor, TextFormatFlags extra = 0)
        {
            TextRenderer.DrawText(g, t, f, r, cor, TextFormatFlags.NoPadding | TextFormatFlags.TextBoxControl | extra);
        }
    }

    // Texto que quebra linha sozinho. "EmLinha" mede uma linha só (para ficar ao lado de botões).
    class Rotulo : Control, IAltura
    {
        public bool Fraco, EmLinha;
        public Color? Cor;
        public Rotulo(string t, bool fraco = false, float px = 14, bool emLinha = false)
        {
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            Fraco = fraco; EmLinha = emLinha; Font = Ui.Fonte(fraco ? 13 : px); Text = t;
            Margin = new Padding(0, Ui.P(8), Ui.P(8), 0);
        }
        public int Altura(int w)
        {
            if (string.IsNullOrEmpty(Text)) return 0;
            return TextRenderer.MeasureText(Text, Font, new Size(Math.Max(1, w - Ui.P(1)), int.MaxValue), TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.TextBoxControl).Height + Ui.P(4);
        }
        public override Size GetPreferredSize(Size s)
        {
            if (EmLinha) { var m = TextRenderer.MeasureText(Text, Font, Size.Empty, TextFormatFlags.NoPadding); return new Size(m.Width + Ui.P(2), m.Height + Ui.P(4)); }
            return new Size(s.Width, Altura(s.Width));
        }
        protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); if (EmLinha) Size = GetPreferredSize(Size.Empty); Invalidate(); Ui.Refazer(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent != null ? Parent.BackColor : Ui.Cartao);
            var r = ClientRectangle; r.X += Ui.P(1); r.Width -= Ui.P(1);  // o "t" e o "c" passam 1 px da borda
            Ui.Escrever(e.Graphics, Text, Font, r, Cor ?? (Fraco ? Ui.Fraco : Ui.Texto), TextFormatFlags.WordBreak);
        }
    }

    // Botão arredondado no estilo do site (.botao, .off-atualizar, .off-sim).
    class Botao : Control
    {
        public enum Tipo { Normal, Principal, Verde, Perigo, Suave }
        public Tipo Estilo;
        readonly bool largo;
        bool sobre, apertado;
        public Botao(string t, Tipo tipo = Tipo.Normal, bool largo = false)
        {
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            Estilo = tipo; this.largo = largo; Cursor = Cursors.Hand;
            Font = Ui.Fonte(13, tipo != Tipo.Normal);
            Height = Ui.P(tipo == Tipo.Suave ? 36 : 32);
            Margin = new Padding(0, Ui.P(6), Ui.P(8), 0);
            Text = t;
        }
        public override Size GetPreferredSize(Size s)
        {
            return new Size(largo ? Math.Max(s.Width, 1) : TextRenderer.MeasureText(Text, Font).Width + Ui.P(20), Height);
        }
        protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); if (!largo) Width = GetPreferredSize(Size.Empty).Width; Invalidate(); }
        protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Cursor = Enabled ? Cursors.Hand : Cursors.Default; Invalidate(); }
        protected override void OnMouseEnter(EventArgs e) { sobre = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { sobre = apertado = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { apertado = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { apertado = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Parent != null ? Parent.BackColor : Ui.Cartao);
            RectangleF r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            if (apertado) r.Inflate(-Width * .015f, -Height * .03f);  // afunda um pouco ao tocar
            Color fundo, texto = Color.White; Color? borda = null;
            switch (Estilo)
            {
                case Tipo.Principal: fundo = Ui.Acento; break;
                case Tipo.Verde: fundo = Ui.Verde; break;
                case Tipo.Perigo: fundo = Ui.Perigo; break;
                case Tipo.Suave: fundo = Ui.Mistura(Ui.Cartao, Ui.AcentoSuave); texto = Ui.Texto; borda = Ui.Borda; break;
                default: fundo = sobre ? Ui.Mistura(Ui.Cartao, Ui.Hover) : Ui.Cartao; texto = Ui.Texto; borda = Ui.Borda; break;
            }
            if (!Enabled) { fundo = Ui.Mistura(Ui.Cartao, Color.FromArgb(150, fundo)); texto = Ui.Mistura(fundo, Color.FromArgb(160, texto)); }
            Ui.Preencher(g, r, Ui.P(Estilo == Tipo.Suave ? 10 : 8), fundo, borda);
            TextRenderer.DrawText(g, Text, Font, Rectangle.Round(r), texto, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }

    // Uma linha do painel "Ferramentas neste PC": check verde, nome e tamanho, como no Modo Offline do site.
    class LinhaCheck : Control, IAltura
    {
        public string Nome, Tamanho;
        public bool Marcado, Girando, Fixo, Apagada;
        public int Progresso = -1;
        bool sobre;
        public LinhaCheck(string nome, string tamanho, bool marcado, bool fixo = false)
        {
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            Nome = nome; Tamanho = tamanho; Marcado = marcado; Fixo = fixo;
            Cursor = fixo ? Cursors.Default : Cursors.Hand;
        }
        public int Altura(int w) { return Ui.P(38); }
        public void Tocar() { OnClick(EventArgs.Empty); }
        protected override void OnMouseEnter(EventArgs e) { sobre = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { sobre = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Ui.Cartao);
            var r = new RectangleF(0, 0, Width - 1, Height - 1);
            if (Progresso >= 0)
            {
                g.SetClip(new RectangleF(0, 0, Width * Progresso / 100f, Height));
                Ui.Preencher(g, r, Ui.P(8), Ui.AcentoSuave);
                g.ResetClip();
            }
            else if (sobre && !Fixo) Ui.Preencher(g, r, Ui.P(8), Ui.AcentoSuave);
            float c = Ui.P(20);
            Ui.Check(g, new RectangleF(Ui.P(8), (Height - c) / 2f, c, c), Marcado, Girando);
            var cor = Fixo ? Ui.Mistura(Ui.Cartao, Color.FromArgb(190, Ui.Texto)) : Ui.Texto;
            int tw = TextRenderer.MeasureText(Tamanho ?? "", Ui.Fonte(12)).Width;
            Ui.Escrever(g, Nome, Ui.Fonte(14), new Rectangle(Ui.P(38), 0, Width - Ui.P(46) - tw - Ui.P(8), Height), cor, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            Ui.Escrever(g, Tamanho ?? "", Ui.Fonte(12), new Rectangle(0, 0, Width - Ui.P(8), Height), Ui.Fraco, TextFormatFlags.VerticalCenter | TextFormatFlags.Right);
            if (Apagada) using (var b = new SolidBrush(Color.FromArgb(140, Ui.Cartao))) g.FillRectangle(b, ClientRectangle);
        }
    }

    // Empilha os controles de cima para baixo (com recuo à esquerda, se pedido).
    class Pilha : Control, IAltura
    {
        public int Recuo, Espaco;
        public Pilha(int recuo = 0, int espaco = 0) { Recuo = recuo; Espaco = espaco; BackColor = Ui.Cartao; }
        public int Altura(int w)
        {
            int h = 0, n = 0;
            foreach (Control c in Controls) if (c.Visible) { h += Ui.AlturaDe(c, w - Recuo) + Espaco; n++; }
            return n == 0 ? 0 : h - Espaco;
        }
        public void Arrumar(int w)
        {
            int y = 0;
            foreach (Control c in Controls)
            {
                if (!c.Visible) continue;
                int h = Ui.AlturaDe(c, w - Recuo);
                c.SetBounds(Recuo, y, w - Recuo, h);
                var p = c as Pilha; if (p != null) p.Arrumar(w - Recuo);
                y += h + Espaco;
            }
            Size = new Size(w, Math.Max(0, y - Espaco));
        }
        protected override void OnControlAdded(ControlEventArgs e) { base.OnControlAdded(e); Ui.Refazer(); }
        protected override void OnControlRemoved(ControlEventArgs e) { base.OnControlRemoved(e); Ui.Refazer(); }
    }

    // Botões e textos lado a lado, quebrando linha quando não cabem.
    class Fila : FlowLayoutPanel
    {
        public Fila(params Control[] c) { BackColor = Ui.Cartao; WrapContents = true; Margin = Padding.Empty; Controls.AddRange(c); }
    }

    // Painel na própria janela (o XeOS e o estilo do Hub não usam caixas de diálogo): cartão no centro
    // sobre uma foto escurecida da tela inicial.
    class Camada : Control
    {
        public Bitmap Foto;
        public string Titulo = "";
        public readonly Panel Rolagem = new Panel { AutoScroll = true };
        public Pilha Conteudo = new Pilha(0, Ui.P(2));
        public event Action Fechar;
        Rectangle cartao, x;
        bool sobreX;

        public Camada()
        {
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
            Rolagem.Controls.Add(Conteudo);
            Controls.Add(Rolagem);
        }

        public void Trocar(string titulo, Pilha conteudo)
        {
            Titulo = titulo;
            Rolagem.Controls.Clear();
            Conteudo = conteudo;
            Rolagem.AutoScrollPosition = Point.Empty;
            Rolagem.Controls.Add(Conteudo);
            Arrumar();
        }

        public void Arrumar()
        {
            if (!Visible) return;
            int w = Math.Min(Ui.P(460), Width - Ui.P(32)), pad = Ui.P(14), iw = w - pad * 2;
            int topo = Ui.P(40), cab = Ui.P(38);
            int max = Math.Max(Ui.P(120), Height - topo - Ui.P(16) - pad * 2 - cab);
            int h = Conteudo.Altura(iw);
            bool barra = h > max;
            int cw = barra ? iw - SystemInformation.VerticalScrollBarWidth : iw;
            Conteudo.Arrumar(cw);
            int vis = Math.Min(Conteudo.Height, max);
            cartao = new Rectangle((Width - w) / 2, topo, w, pad + cab + vis + pad);
            Rolagem.BackColor = Ui.Cartao;
            Rolagem.SetBounds(cartao.X + pad, cartao.Y + pad + cab, iw, vis);
            x = new Rectangle(cartao.Right - pad - Ui.P(30), cartao.Y + pad - Ui.P(2), Ui.P(30), Ui.P(30));
            Invalidate();
        }

        // rola o painel até o fim de "c" ficar à vista (os botões dos detalhes abertos)
        public void MostrarAte(Control c)
        {
            int fim = Conteudo.PointToClient(c.PointToScreen(Point.Empty)).Y + c.Height;
            int topo = -Rolagem.AutoScrollPosition.Y;
            if (fim > topo + Rolagem.ClientSize.Height) Rolagem.AutoScrollPosition = new Point(0, fim - Rolagem.ClientSize.Height);
        }

        protected override void OnResize(EventArgs e) { base.OnResize(e); Arrumar(); }
        protected override void OnMouseWheel(MouseEventArgs e)
        {
            Rolagem.AutoScrollPosition = new Point(0, -Rolagem.AutoScrollPosition.Y - e.Delta);
        }
        protected override void OnMouseMove(MouseEventArgs e)
        {
            bool s = x.Contains(e.Location);
            if (s != sobreX) { sobreX = s; Invalidate(x); Cursor = s ? Cursors.Hand : Cursors.Default; }
        }
        protected override void OnMouseDown(MouseEventArgs e)
        {
            Focus();
            if (x.Contains(e.Location) || !cartao.Contains(e.Location)) { var f = Fechar; if (f != null) f(); }
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Ui.Fundo);
            if (Foto != null) g.DrawImageUnscaled(Foto, 0, 0);
            using (var b = new SolidBrush(Color.FromArgb(Ui.Escuro ? 110 : 72, 0, 0, 0))) g.FillRectangle(b, ClientRectangle);
            for (int i = 1; i <= 4; i++)  // sombra macia
            {
                var s = RectangleF.Inflate(cartao, i * Ui.E * 2, i * Ui.E * 2); s.Offset(0, Ui.P(4));
                Ui.Preencher(g, s, Ui.P(14) + i * 2, Color.FromArgb(12, 0, 0, 0));
            }
            Ui.Preencher(g, cartao, Ui.P(14), Ui.Cartao, Ui.Borda);
            int pad = Ui.P(14);
            Ui.Escrever(g, Titulo, Ui.Fonte(16, true), new Rectangle(cartao.X + pad, cartao.Y + pad, cartao.Width - pad * 2 - Ui.P(34), Ui.P(26)), Ui.Texto, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            if (sobreX) Ui.Preencher(g, x, Ui.P(8), Ui.Hover);
            Ui.Escrever(g, "✕", Ui.Fonte(16), x, Ui.Fraco, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
    }

    // O menu ☰ da tela inicial (.menu-pop): cartão com linhas, check azul nas opções escolhidas.
    class MenuPop : Control
    {
        public class Item { public string Texto, Lado; public bool Marcado, Separador, Rotulo, Sol; public Action Acao; public Rectangle R; }
        List<Item> itens = new List<Item>();
        public Bitmap Foto;
        Rectangle cartao;
        int sobre = -1;
        public MenuPop() { SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint, true); Visible = false; }

        public void Abrir(List<Item> l, Point canto)
        {
            itens = l;
            int m = Ui.P(10), y = m + Ui.P(6), w = Ui.P(250);
            foreach (var i in itens)
            {
                int h = i.Separador ? Ui.P(11) : i.Rotulo ? Ui.P(22) : Ui.P(32);
                i.R = new Rectangle(m + Ui.P(6), y, w - Ui.P(12), h);
                y += h + 1;
            }
            cartao = new Rectangle(m, m, w, y - m + Ui.P(5));
            Bounds = new Rectangle(canto.X - m, canto.Y - m, w + m * 2, cartao.Bottom + m);
            sobre = -1; Visible = true; BringToFront(); Invalidate();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            int s = itens.FindIndex(i => i.Acao != null && i.R.Contains(e.Location));
            if (s != sobre) { sobre = s; Cursor = s >= 0 ? Cursors.Hand : Cursors.Default; Invalidate(); }
        }
        protected override void OnMouseLeave(EventArgs e) { sobre = -1; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseUp(MouseEventArgs e)
        {
            var i = itens.Find(x => x.Acao != null && x.R.Contains(e.Location));
            if (i == null) return;
            Visible = false;
            i.Acao();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Ui.Fundo);
            if (Foto != null) g.DrawImage(Foto, new Rectangle(0, 0, Width, Height), new Rectangle(Left, Top, Width, Height), GraphicsUnit.Pixel);
            for (int k = 1; k <= 4; k++)
            {
                var s = RectangleF.Inflate(cartao, k * Ui.E * 1.5f, k * Ui.E * 1.5f); s.Offset(0, Ui.P(3));
                Ui.Preencher(g, s, Ui.P(12) + k, Color.FromArgb(9, 0, 0, 0));
            }
            Ui.Preencher(g, cartao, Ui.P(12), Ui.Cartao, Ui.Borda);
            for (int n = 0; n < itens.Count; n++)
            {
                var i = itens[n];
                if (i.Separador)
                {
                    using (var p = new Pen(Ui.Mistura(Ui.Cartao, Ui.Borda))) g.DrawLine(p, i.R.X + Ui.P(4), i.R.Y + i.R.Height / 2, i.R.Right - Ui.P(4), i.R.Y + i.R.Height / 2);
                    continue;
                }
                if (i.Rotulo) { Ui.Escrever(g, i.Texto, Ui.Fonte(12), new Rectangle(i.R.X + Ui.P(8), i.R.Y, i.R.Width, i.R.Height), Ui.Fraco, TextFormatFlags.VerticalCenter); continue; }
                if (n == sobre) Ui.Preencher(g, i.R, Ui.P(6), Ui.AcentoSuave);
                var marca = new Rectangle(i.R.X + Ui.P(8), i.R.Y, Ui.P(16), i.R.Height);
                if (i.Sol)
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    float cx = marca.X + marca.Width / 2f, cy = marca.Y + marca.Height / 2f, u = Ui.E * 16 / 24f;
                    using (var p = new Pen(Ui.Texto, 1.6f * Ui.E) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    {
                        g.DrawEllipse(p, cx - 4 * u, cy - 4 * u, 8 * u, 8 * u);
                        for (int a = 0; a < 8; a++)
                        {
                            double t = a * Math.PI / 4;
                            g.DrawLine(p, cx + (float)Math.Cos(t) * 7 * u, cy + (float)Math.Sin(t) * 7 * u, cx + (float)Math.Cos(t) * 9.5f * u, cy + (float)Math.Sin(t) * 9.5f * u);
                        }
                    }
                }
                else if (i.Marcado) Ui.Escrever(g, "✓", Ui.Fonte(14, true), marca, Ui.Acento, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                var tr = new Rectangle(i.R.X + Ui.P(34), i.R.Y, i.R.Width - Ui.P(42), i.R.Height);
                Ui.Escrever(g, i.Texto, Ui.Fonte(14), tr, Ui.Texto, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                if (i.Lado != null) Ui.Escrever(g, i.Lado, Ui.Fonte(12), tr, Ui.Fraco, TextFormatFlags.VerticalCenter | TextFormatFlags.Right);
            }
        }
    }
}
