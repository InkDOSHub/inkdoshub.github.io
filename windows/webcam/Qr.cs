// Gerador de QR code mínimo (modo byte, correção M, versões 1 a 10), sem bibliotecas.
// Segue o algoritmo do "QR Code generator library" de Project Nayuki (MIT), reduzido ao que o app usa:
// o link do iPhone, com uns 60 caracteres.
using System;
using System.Collections.Generic;
using System.Text;

namespace InkDOSHubWebcam
{
    static class Qr
    {
        static readonly int[] EccPorBloco = { 0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26 };
        static readonly int[] Blocos = { 0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5 };

        // Devolve a matriz [y, x] (true = escuro).
        public static bool[,] Gerar(string texto)
        {
            byte[] dados = Encoding.UTF8.GetBytes(texto);
            int ver = 1;
            for (; ver <= 10; ver++)
                if (4 + (ver < 10 ? 8 : 16) + dados.Length * 8 <= Capacidade(ver) * 8) break;
            if (ver > 10) throw new ArgumentException("texto longo demais para o QR");

            // bits: modo byte, tamanho, dados, terminador, preenchimento
            var bits = new List<bool>();
            Action<int, int> poe = (v, n) => { for (int i = n - 1; i >= 0; i--) bits.Add(((v >> i) & 1) != 0); };
            poe(4, 4); poe(dados.Length, ver < 10 ? 8 : 16);
            foreach (byte b in dados) poe(b, 8);
            int cap = Capacidade(ver) * 8;
            poe(0, Math.Min(4, cap - bits.Count));
            poe(0, (8 - bits.Count % 8) % 8);
            for (int p = 0xEC; bits.Count < cap; p ^= 0xEC ^ 0x11) poe(p, 8);
            var cod = new byte[bits.Count / 8];
            for (int i = 0; i < bits.Count; i++) if (bits[i]) cod[i >> 3] |= (byte)(1 << (7 - (i & 7)));

            var q = new Matriz(ver);
            q.Desenhar(Intercalar(cod, ver));
            return q.M;
        }

        static int Brutos(int ver)
        {
            int r = (16 * ver + 128) * ver + 64;
            if (ver >= 2) { int n = ver / 7 + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
            return r;
        }
        static int Capacidade(int ver) { return Brutos(ver) / 8 - EccPorBloco[ver] * Blocos[ver]; }

        static byte[] Intercalar(byte[] dados, int ver)
        {
            int nb = Blocos[ver], ecc = EccPorBloco[ver], total = Brutos(ver) / 8;
            int curtos = nb - total % nb, tamCurto = total / nb;
            var div = Divisor(ecc);
            var blocos = new List<byte[]>();
            for (int i = 0, k = 0; i < nb; i++)
            {
                int n = tamCurto - ecc + (i < curtos ? 0 : 1);
                var d = new byte[n]; Array.Copy(dados, k, d, 0, n); k += n;
                var r = Resto(d, div);
                var b = new byte[tamCurto + 1];
                Array.Copy(d, 0, b, 0, n);
                Array.Copy(r, 0, b, tamCurto + 1 - ecc, ecc);  // o bloco curto fica com um buraco antes do ECC
                blocos.Add(b);
            }
            var saida = new List<byte>();
            for (int i = 0; i <= tamCurto; i++)
                for (int j = 0; j < nb; j++)
                    if (i != tamCurto - ecc || j >= curtos) saida.Add(blocos[j][i]);
            return saida.ToArray();
        }

        static int Mul(int x, int y)
        {
            int z = 0;
            for (int i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >> 7) * 0x11D); z ^= ((y >> i) & 1) * x; }
            return z & 0xFF;
        }
        static byte[] Divisor(int grau)
        {
            var r = new byte[grau]; r[grau - 1] = 1;
            int raiz = 1;
            for (int i = 0; i < grau; i++)
            {
                for (int j = 0; j < grau; j++) { r[j] = (byte)Mul(r[j], raiz); if (j + 1 < grau) r[j] ^= r[j + 1]; }
                raiz = Mul(raiz, 2);
            }
            return r;
        }
        static byte[] Resto(byte[] dados, byte[] div)
        {
            var r = new byte[div.Length];
            foreach (byte b in dados)
            {
                int f = b ^ r[0];
                Array.Copy(r, 1, r, 0, r.Length - 1); r[r.Length - 1] = 0;
                for (int i = 0; i < r.Length; i++) r[i] ^= (byte)Mul(div[i], f);
            }
            return r;
        }

        sealed class Matriz
        {
            public readonly bool[,] M;
            readonly bool[,] fixo;
            readonly int n, ver;
            const int Mascara = 0;  // qualquer máscara vale para a leitura

            public Matriz(int ver) { this.ver = ver; n = ver * 4 + 17; M = new bool[n, n]; fixo = new bool[n, n]; }

            void P(int x, int y, bool v) { M[y, x] = v; fixo[y, x] = true; }

            public void Desenhar(byte[] cod)
            {
                for (int i = 0; i < n; i++) { P(6, i, i % 2 == 0); P(i, 6, i % 2 == 0); }
                Localizador(3, 3); Localizador(n - 4, 3); Localizador(3, n - 4);
                var al = Alinhamentos();
                for (int i = 0; i < al.Count; i++)
                    for (int j = 0; j < al.Count; j++)
                        if (!(i == 0 && j == 0 || i == 0 && j == al.Count - 1 || i == al.Count - 1 && j == 0))
                            for (int dy = -2; dy <= 2; dy++)
                                for (int dx = -2; dx <= 2; dx++)
                                    P(al[i] + dx, al[j] + dy, Math.Max(Math.Abs(dx), Math.Abs(dy)) != 1);
                Formato();
                if (ver >= 7)
                {
                    int r = ver;
                    for (int i = 0; i < 12; i++) r = (r << 1) ^ ((r >> 11) * 0x1F25);
                    long b = (long)ver << 12 | (long)r;
                    for (int i = 0; i < 18; i++) { bool v = ((b >> i) & 1) != 0; int a = n - 11 + i % 3, c = i / 3; P(a, c, v); P(c, a, v); }
                }
                // dados em zigue-zague, de baixo para cima, duas colunas por vez
                int k = 0;
                for (int dir = n - 1; dir >= 1; dir -= 2)
                {
                    if (dir == 6) dir = 5;
                    for (int v = 0; v < n; v++)
                        for (int j = 0; j < 2; j++)
                        {
                            int x = dir - j; bool sobe = ((dir + 1) & 2) == 0; int y = sobe ? n - 1 - v : v;
                            if (!fixo[y, x] && k < cod.Length * 8) { M[y, x] = ((cod[k >> 3] >> (7 - (k & 7))) & 1) != 0; k++; }
                        }
                }
                for (int y = 0; y < n; y++)
                    for (int x = 0; x < n; x++)
                        if (!fixo[y, x] && (x + y) % 2 == 0) M[y, x] = !M[y, x];  // máscara 0
            }

            void Localizador(int x, int y)
            {
                for (int dy = -4; dy <= 4; dy++)
                    for (int dx = -4; dx <= 4; dx++)
                    {
                        int d = Math.Max(Math.Abs(dx), Math.Abs(dy)), xx = x + dx, yy = y + dy;
                        if (xx >= 0 && xx < n && yy >= 0 && yy < n) P(xx, yy, d != 2 && d != 4);
                    }
            }

            List<int> Alinhamentos()
            {
                var r = new List<int>();
                if (ver == 1) return r;
                int num = ver / 7 + 2;
                int passo = (int)Math.Ceiling((ver * 4 + 4) / (double)(num * 2 - 2)) * 2;
                r.Add(6);
                for (int p = n - 7; r.Count < num; p -= passo) r.Insert(1, p);
                return r;
            }

            void Formato()
            {
                int dados = (0 << 3) | Mascara;  // correção M = 00
                int r = dados;
                for (int i = 0; i < 10; i++) r = (r << 1) ^ ((r >> 9) * 0x537);
                int b = (dados << 10 | r) ^ 0x5412;
                Func<int, bool> bit = i => ((b >> i) & 1) != 0;
                for (int i = 0; i <= 5; i++) P(8, i, bit(i));
                P(8, 7, bit(6)); P(8, 8, bit(7)); P(7, 8, bit(8));
                for (int i = 9; i < 15; i++) P(14 - i, 8, bit(i));
                for (int i = 0; i < 8; i++) P(n - 1 - i, 8, bit(i));
                for (int i = 8; i < 15; i++) P(8, n - 15 + i, bit(i));
                P(8, n - 8, true);
            }
        }
    }
}
