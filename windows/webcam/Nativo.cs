// Receptor nativo: recebe o vídeo do iPhone direto com o GStreamer, sem passar pelo
// navegador interno.
//
// O iPhone continua igual (página Host no Safari). Este arquivo faz o papel da página Guest:
//   1. SinalPeerJs: fala com o servidor público do PeerJS (o "telefone" que liga o iPhone ao PC) e
//      se registra como "inkdoshub-webcam-<código>".
//   2. ReceptorGst: para cada chamada do iPhone, monta um pipeline GStreamer
//      webrtcbin → rtph264depay → h264parse → decodificador da placa de vídeo → BGRA → appsink
//      e entrega cada quadro já decodificado para a câmera virtual.
//
// O GStreamer fica na pasta "gstreamer" ao lado do app (só os plugins usados; LGPL).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace InkDOSHubWebcam
{
    /* ---------- JSON mínimo (o .NET Framework 4.8 não traz um leitor de JSON pronto) ---------- */
    static class Json
    {
        public static object Ler(string s) { int i = 0; var v = Valor(s, ref i); return v; }

        static void Espaco(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

        static object Valor(string s, ref int i)
        {
            Espaco(s, ref i);
            if (i >= s.Length) throw new FormatException("json");
            char c = s[i];
            if (c == '{')
            {
                var d = new Dictionary<string, object>();
                i++; Espaco(s, ref i);
                if (s[i] == '}') { i++; return d; }
                while (true)
                {
                    Espaco(s, ref i);
                    string k = Texto(s, ref i);
                    Espaco(s, ref i);
                    if (s[i] != ':') throw new FormatException("json");
                    i++;
                    d[k] = Valor(s, ref i);
                    Espaco(s, ref i);
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == '}') { i++; return d; }
                    throw new FormatException("json");
                }
            }
            if (c == '[')
            {
                var l = new List<object>();
                i++; Espaco(s, ref i);
                if (s[i] == ']') { i++; return l; }
                while (true)
                {
                    l.Add(Valor(s, ref i));
                    Espaco(s, ref i);
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == ']') { i++; return l; }
                    throw new FormatException("json");
                }
            }
            if (c == '"') return Texto(s, ref i);
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (s.Length - i >= 5 && string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int ini = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            if (ini == i) throw new FormatException("json");
            return double.Parse(s.Substring(ini, i - ini), CultureInfo.InvariantCulture);
        }

        static string Texto(string s, ref int i)
        {
            if (s[i] != '"') throw new FormatException("json");
            i++;
            var b = new StringBuilder();
            while (s[i] != '"')
            {
                char c = s[i++];
                if (c != '\\') { b.Append(c); continue; }
                char e = s[i++];
                switch (e)
                {
                    case 'n': b.Append('\n'); break;
                    case 'r': b.Append('\r'); break;
                    case 't': b.Append('\t'); break;
                    case 'b': b.Append('\b'); break;
                    case 'f': b.Append('\f'); break;
                    case 'u': b.Append((char)Convert.ToInt32(s.Substring(i, 4), 16)); i += 4; break;
                    default: b.Append(e); break;
                }
            }
            i++;
            return b.ToString();
        }

        public static string Escrever(object v)
        {
            var b = new StringBuilder();
            Escrever(b, v);
            return b.ToString();
        }

        static void Escrever(StringBuilder b, object v)
        {
            if (v == null) { b.Append("null"); return; }
            var s = v as string;
            if (s != null)
            {
                b.Append('"');
                foreach (char c in s)
                {
                    if (c == '"') b.Append("\\\"");
                    else if (c == '\\') b.Append("\\\\");
                    else if (c == '\n') b.Append("\\n");
                    else if (c == '\r') b.Append("\\r");
                    else if (c == '\t') b.Append("\\t");
                    else if (c < 0x20) b.Append("\\u").Append(((int)c).ToString("x4"));
                    else b.Append(c);
                }
                b.Append('"');
                return;
            }
            if (v is bool) { b.Append((bool)v ? "true" : "false"); return; }
            if (v is int || v is long || v is uint) { b.Append(Convert.ToInt64(v).ToString(CultureInfo.InvariantCulture)); return; }
            if (v is double) { b.Append(((double)v).ToString("R", CultureInfo.InvariantCulture)); return; }
            var d = v as IDictionary<string, object>;
            if (d != null)
            {
                b.Append('{');
                bool primeiro = true;
                foreach (var kv in d)
                {
                    if (!primeiro) b.Append(',');
                    primeiro = false;
                    Escrever(b, kv.Key);
                    b.Append(':');
                    Escrever(b, kv.Value);
                }
                b.Append('}');
                return;
            }
            var l = v as System.Collections.IEnumerable;
            if (l != null)
            {
                b.Append('[');
                bool primeiro = true;
                foreach (var x in l) { if (!primeiro) b.Append(','); primeiro = false; Escrever(b, x); }
                b.Append(']');
                return;
            }
            Escrever(b, v.ToString());
        }

        public static Dictionary<string, object> Obj(object v) { return v as Dictionary<string, object>; }
        public static string Str(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v as string : null; }
        public static double Num(Dictionary<string, object> d, string k, double padrao)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v is double ? (double)v : padrao;
        }
    }

    /* ---------- Sinalização: servidor público do PeerJS ---------- */
    sealed class SinalPeerJs : IDisposable
    {
        public delegate void OfertaHandler(string origem, string conexao, string sdp, Dictionary<string, object> metadata);
        public delegate void CandidatoHandler(string origem, string conexao, string candidato, int linha);
        public event OfertaHandler Oferta;
        public event CandidatoHandler Candidato;
        public event Action<string> Saiu;        // o iPhone fechou a página (LEAVE/EXPIRE)
        public event Action<string> Estado;      // texto para a barra de estado

        readonly string id;
        readonly CancellationTokenSource fim = new CancellationTokenSource();
        ClientWebSocket ws;
        readonly SemaphoreSlim envio = new SemaphoreSlim(1, 1);

        public SinalPeerJs(string id) { this.id = id; }

        public void Iniciar() { Task.Run(Laco); }

        async Task Laco()
        {
            int espera = 1000;
            while (!fim.IsCancellationRequested)
            {
                try
                {
                    Avisar("Connecting to the pairing server…");
                    var token = Guid.NewGuid().ToString("N").Substring(0, 12);
                    var url = "wss://0.peerjs.com:443/peerjs?key=peerjs&id=" + Uri.EscapeDataString(id) + "&token=" + token + "&version=1.5.5";
                    using (var s = new ClientWebSocket())
                    {
                        ws = s;
                        await s.ConnectAsync(new Uri(url), fim.Token);
                        Program.Log("NATIVO: signaling socket open for " + id);
                        var batida = Task.Run(async () =>
                        {
                            while (s.State == WebSocketState.Open && !fim.IsCancellationRequested)
                            {
                                await Task.Delay(5000, fim.Token);
                                await Mandar("{\"type\":\"HEARTBEAT\"}");
                            }
                        });
                        var buf = new byte[64 * 1024];
                        var msg = new MemoryStream();
                        while (s.State == WebSocketState.Open && !fim.IsCancellationRequested)
                        {
                            var r = await s.ReceiveAsync(new ArraySegment<byte>(buf), fim.Token);
                            if (r.MessageType == WebSocketMessageType.Close) break;
                            msg.Write(buf, 0, r.Count);
                            if (!r.EndOfMessage) continue;
                            var texto = Encoding.UTF8.GetString(msg.ToArray());
                            msg.SetLength(0);
                            espera = 1000;
                            Tratar(texto);
                        }
                    }
                }
                catch (OperationCanceledException) { return; }
                catch (Exception e) { Program.Log("NATIVO: signaling error: " + e.Message); }
                ws = null;
                if (fim.IsCancellationRequested) return;
                Avisar("No connection to the pairing server. Trying again…");
                try { await Task.Delay(espera, fim.Token); } catch (OperationCanceledException) { return; }
                espera = Math.Min(espera * 2, 10000);
            }
        }

        void Tratar(string texto)
        {
            Dictionary<string, object> m;
            try { m = Json.Obj(Json.Ler(texto)); } catch (Exception) { return; }
            if (m == null) return;
            var tipo = Json.Str(m, "type");
            var origem = Json.Str(m, "src");
            var carga = m.ContainsKey("payload") ? Json.Obj(m["payload"]) : null;
            switch (tipo)
            {
                case "OPEN":
                    Avisar("Ready. Waiting for the iPhone…");
                    break;
                case "ID-TAKEN":
                    Avisar("This code is open in another window (another tab or OBS). Trying again…");
                    try { ws.Abort(); } catch (Exception) { }
                    break;
                case "ERROR":
                    Program.Log("NATIVO: server error " + texto);
                    break;
                case "OFFER":
                    if (carga == null || Json.Str(carga, "type") != "media") return; // só chamadas de vídeo
                    var sdp = Json.Obj(carga.ContainsKey("sdp") ? carga["sdp"] : null);
                    var meta = carga.ContainsKey("metadata") ? Json.Obj(carga["metadata"]) : null;
                    if (sdp != null && Oferta != null) Oferta(origem, Json.Str(carga, "connectionId"), Json.Str(sdp, "sdp"), meta);
                    break;
                case "CANDIDATE":
                    if (carga == null) return;
                    var c = Json.Obj(carga.ContainsKey("candidate") ? carga["candidate"] : null);
                    var cand = Json.Str(c, "candidate");
                    if (!string.IsNullOrEmpty(cand) && Candidato != null)
                        Candidato(origem, Json.Str(carga, "connectionId"), cand, (int)Json.Num(c, "sdpMLineIndex", 0));
                    break;
                case "LEAVE":
                case "EXPIRE":
                    if (Saiu != null) Saiu(origem);
                    break;
            }
        }

        void Avisar(string s) { if (Estado != null) Estado(s); }

        public void Resposta(string destino, string conexao, string sdp)
        {
            var carga = new Dictionary<string, object>
            {
                { "sdp", new Dictionary<string, object> { { "type", "answer" }, { "sdp", sdp } } },
                { "type", "media" },
                { "connectionId", conexao },
                { "browser", "inkdoshub-native" },
            };
            Mandar(Json.Escrever(new Dictionary<string, object> { { "type", "ANSWER" }, { "payload", carga }, { "dst", destino } }));
        }

        public void MandarCandidato(string destino, string conexao, string candidato, int linha, string mid)
        {
            var c = new Dictionary<string, object> { { "candidate", candidato }, { "sdpMLineIndex", linha }, { "sdpMid", mid } };
            var carga = new Dictionary<string, object> { { "candidate", c }, { "type", "media" }, { "connectionId", conexao } };
            Mandar(Json.Escrever(new Dictionary<string, object> { { "type", "CANDIDATE" }, { "payload", carga }, { "dst", destino } }));
        }

        async Task Mandar(string texto)
        {
            var s = ws;
            if (s == null || s.State != WebSocketState.Open) return;
            await envio.WaitAsync();
            try { await s.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(texto)), WebSocketMessageType.Text, true, fim.Token); }
            catch (Exception e) { Program.Log("NATIVO: send error: " + e.Message); }
            finally { envio.Release(); }
        }

        public void Dispose()
        {
            fim.Cancel();
            try { var s = ws; if (s != null) s.Abort(); } catch (Exception) { }
        }
    }

    /* ---------- SDP: só H.264, sem giro por metadado, e o bitrate pedido ---------- */
    static class SdpNativo
    {
        static int[] SecaoVideo(List<string> l)
        {
            int ini = -1, fim = l.Count;
            for (int i = 0; i < l.Count; i++)
            {
                if (l[i].StartsWith("m=video", StringComparison.Ordinal)) ini = i;
                else if (ini >= 0 && l[i].StartsWith("m=", StringComparison.Ordinal)) { fim = i; break; }
            }
            return new[] { ini, fim };
        }

        /* Oferta do iPhone: deixa só o melhor H.264 (e o RTX dele) e tira o giro por metadado
           (urn:3gpp:video-orientation), para o iPhone mandar a imagem já em pé. */
        public static string LimparOferta(string sdp)
        {
            var l = new List<string>(sdp.Replace("\r\n", "\n").Split('\n'));
            RecusarDados(l);
            var s = SecaoVideo(l);
            int ini = s[0], fim = s[1];
            if (ini < 0) return sdp;
            var fmtp = new Dictionary<string, string>();
            var h264 = new List<string>();
            for (int i = ini; i < fim; i++)
            {
                var f = Regex.Match(l[i], @"^a=fmtp:(\d+) (.*)$");
                if (f.Success) fmtp[f.Groups[1].Value] = f.Groups[2].Value;
                var m = Regex.Match(l[i], @"^a=rtpmap:(\d+) H264/", RegexOptions.IgnoreCase);
                if (m.Success) h264.Add(m.Groups[1].Value);
            }
            if (h264.Count == 0) return sdp;
            Func<string, int> nota = pt =>
            {
                string p; fmtp.TryGetValue(pt, out p); p = p ?? "";
                return (p.Contains("packetization-mode=1") ? 2 : 0) + (Regex.IsMatch(p, "profile-level-id=64", RegexOptions.IgnoreCase) ? 1 : 0);
            };
            string melhor = h264[0];
            foreach (var pt in h264) if (nota(pt) > nota(melhor)) melhor = pt;
            var manter = new HashSet<string> { melhor };
            foreach (var kv in fmtp) if (kv.Value.Contains("apt=" + melhor) && Regex.IsMatch(kv.Value, @"(^|;)apt=" + melhor + "($|;)")) manter.Add(kv.Key);
            var partes = l[ini].Split(' ');
            var linhaM = new List<string> { partes[0], partes[1], partes[2] };
            for (int i = 3; i < partes.Length; i++) if (manter.Contains(partes[i])) linhaM.Add(partes[i]);
            l[ini] = string.Join(" ", linhaM);
            for (int i = fim - 1; i > ini; i--)
            {
                var m = Regex.Match(l[i], @"^a=(rtpmap|fmtp|rtcp-fb):(\d+)[ ]");
                if ((m.Success && !manter.Contains(m.Groups[2].Value)) || l[i].Contains("urn:3gpp:video-orientation"))
                    l.RemoveAt(i);
            }
            return string.Join("\r\n", l);
        }

        /* O PeerJS põe um canal de dados (m=application) na chamada. O SCTP dele caía depois de ~15 s
           e derrubava a chamada inteira (o vídeo usa o mesmo transporte): recusa essa seção (porta 0)
           e tira ela do BUNDLE. A resposta continua com o mesmo número de seções, como o WebRTC exige. */
        static void RecusarDados(List<string> l)
        {
            var recusados = new List<string>();
            for (int i = 0; i < l.Count; i++)
            {
                if (!l[i].StartsWith("m=application ", StringComparison.Ordinal)) continue;
                var partes = l[i].Split(' ');
                partes[1] = "0";
                l[i] = string.Join(" ", partes);
                for (int j = i + 1; j < l.Count && !l[j].StartsWith("m="); j++)
                    if (l[j].StartsWith("a=mid:")) recusados.Add(l[j].Substring(6).Trim());
            }
            if (recusados.Count == 0) return;
            for (int i = 0; i < l.Count; i++)
            {
                if (!l[i].StartsWith("a=group:BUNDLE")) continue;
                var partes = new List<string>(l[i].Split(' '));
                partes.RemoveAll(x => recusados.Contains(x.Trim()));
                l[i] = string.Join(" ", partes);
            }
            Program.Log("NATIVO: data section rejected (mid " + string.Join(",", recusados) + ")");
        }

        /* Resposta para o iPhone: limite de bitrate e começo já perto dele (igual à página Guest). */
        public static string Bitrate(string sdp, int bps)
        {
            if (bps <= 0) return sdp;
            var l = new List<string>(sdp.Replace("\r\n", "\n").Split('\n'));
            var s = SecaoVideo(l);
            int ini = s[0], fim = s[1];
            if (ini < 0) return sdp;
            for (int i = fim - 1; i > ini; i--) if (l[i].StartsWith("b=AS:") || l[i].StartsWith("b=TIAS:")) { l.RemoveAt(i); fim--; }
            int pos = ini + 1;
            for (int i = ini + 1; i < fim; i++) if (l[i].StartsWith("c=")) { pos = i + 1; break; }
            l.Insert(pos, "b=TIAS:" + bps);
            l.Insert(pos, "b=AS:" + (bps / 1000));
            fim += 2;
            string inicio = "x-google-start-bitrate=" + (bps / 2000) + ";x-google-max-bitrate=" + (bps / 1000);
            for (int i = ini; i < fim; i++)
                if (l[i].StartsWith("a=fmtp:") && !l[i].Contains("apt=") && !l[i].Contains("x-google-")) l[i] += ";" + inicio;
            return string.Join("\r\n", l);
        }

        /* "a=mid" de cada linha m=, para mandar os candidatos com o sdpMid certo. */
        public static List<string> Mids(string sdp)
        {
            var r = new List<string>();
            foreach (var linha in sdp.Replace("\r\n", "\n").Split('\n'))
            {
                if (linha.StartsWith("m=")) r.Add(r.Count.ToString());
                else if (linha.StartsWith("a=mid:") && r.Count > 0) r[r.Count - 1] = linha.Substring(6).Trim();
            }
            return r;
        }
    }

    /* ---------- GStreamer (P/Invoke na API C) ---------- */
    static class Gst
    {
        const string Core = "gstreamer-1.0-0.dll", App = "gstapp-1.0-0.dll", Sdp = "gstsdp-1.0-0.dll", Rtc = "gstwebrtc-1.0-0.dll", GObj = "gobject-2.0-0.dll", GLib = "glib-2.0-0.dll";
        const CallingConvention C = CallingConvention.Cdecl;

        [DllImport(Core, CallingConvention = C)] public static extern void gst_init(IntPtr argc, IntPtr argv);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_version_string();
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_pipeline_new(string name);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_element_factory_make(string factory, string name);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_element_factory_find(string factory);
        [DllImport(Core, CallingConvention = C)] public static extern void gst_util_set_object_arg(IntPtr obj, string name, string value);
        [DllImport(Core, CallingConvention = C)] public static extern bool gst_bin_add(IntPtr bin, IntPtr element);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_bin_get_by_name(IntPtr bin, string name);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_parse_bin_from_description(string desc, bool ghost, out IntPtr error);
        [DllImport(Core, CallingConvention = C)] public static extern int gst_element_set_state(IntPtr element, int state);
        [DllImport(Core, CallingConvention = C)] public static extern bool gst_element_sync_state_with_parent(IntPtr element);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_element_get_static_pad(IntPtr element, string name);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_element_get_bus(IntPtr element);
        [DllImport(Core, CallingConvention = C)] public static extern int gst_pad_link(IntPtr src, IntPtr sink);
        [DllImport(Core, CallingConvention = C)] public static extern int gst_pad_get_direction(IntPtr pad);
        [DllImport(Core, CallingConvention = C)] public static extern void gst_object_unref(IntPtr obj);
        [DllImport(Core, CallingConvention = C)] public static extern void gst_mini_object_unref(IntPtr obj);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_bus_pop_filtered(IntPtr bus, int types);
        [DllImport(Core, CallingConvention = C)] public static extern void gst_message_parse_error(IntPtr msg, out IntPtr error, out IntPtr debug);
        [DllImport(Core, CallingConvention = C)] public static extern void gst_message_parse_warning(IntPtr msg, out IntPtr error, out IntPtr debug);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_promise_new_with_change_func(PromiseFunc func, IntPtr data, IntPtr notify);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_promise_get_reply(IntPtr promise);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_structure_get_value(IntPtr structure, string field);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_caps_get_structure(IntPtr caps, uint index);
        [DllImport(Core, CallingConvention = C)] public static extern bool gst_structure_get_int(IntPtr structure, string field, out int value);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_sample_get_buffer(IntPtr sample);
        [DllImport(Core, CallingConvention = C)] public static extern IntPtr gst_sample_get_caps(IntPtr sample);
        [DllImport(Core, CallingConvention = C)] public static extern bool gst_buffer_map(IntPtr buffer, ref MapInfo info, int flags);
        [DllImport(Core, CallingConvention = C)] public static extern void gst_buffer_unmap(IntPtr buffer, ref MapInfo info);
        [DllImport(App, CallingConvention = C)] public static extern IntPtr gst_app_sink_try_pull_sample(IntPtr sink, ulong timeoutNs);
        [DllImport(Sdp, CallingConvention = C)] public static extern int gst_sdp_message_new_from_text(string text, out IntPtr msg);
        [DllImport(Sdp, CallingConvention = C)] public static extern IntPtr gst_sdp_message_as_text(IntPtr msg);
        [DllImport(Rtc, CallingConvention = C)] public static extern IntPtr gst_webrtc_session_description_new(int type, IntPtr sdp);
        [DllImport(Rtc, CallingConvention = C)] public static extern void gst_webrtc_session_description_free(IntPtr desc);
        [DllImport(GObj, CallingConvention = C)] public static extern ulong g_signal_connect_data(IntPtr instance, string signal, Delegate handler, IntPtr data, IntPtr destroy, int flags);
        [DllImport(GObj, CallingConvention = C)] public static extern IntPtr g_value_get_boxed(IntPtr value);
        // g_signal_emit_by_name tem argumentos variáveis; no Windows x64 inteiros e ponteiros vão como argumentos comuns
        [DllImport(GObj, CallingConvention = C, EntryPoint = "g_signal_emit_by_name")] public static extern void Emitir(IntPtr instance, string signal, IntPtr a, IntPtr b);
        [DllImport(GObj, CallingConvention = C, EntryPoint = "g_signal_emit_by_name")] public static extern void Emitir(IntPtr instance, string signal, uint a, string b);
        [DllImport(GLib, CallingConvention = C)] public static extern void g_free(IntPtr p);
        [DllImport(GLib, CallingConvention = C)] public static extern void g_error_free(IntPtr e);

        [UnmanagedFunctionPointer(C)] public delegate void PromiseFunc(IntPtr promise, IntPtr data);
        [UnmanagedFunctionPointer(C)] public delegate void PadAdded(IntPtr element, IntPtr pad, IntPtr data);
        [UnmanagedFunctionPointer(C)] public delegate void IceCandidate(IntPtr element, uint mline, IntPtr candidate, IntPtr data);

        [StructLayout(LayoutKind.Sequential)]
        public struct MapInfo
        {
            public IntPtr Memory; public int Flags; public IntPtr Data; public UIntPtr Size; public UIntPtr MaxSize;
            public IntPtr U0, U1, U2, U3, R0, R1, R2, R3;
        }

        public const int Null = 1, Playing = 4;
        public const int MsgError = 1 << 1, MsgWarning = 1 << 2;
        public const int SdpOffer = 1, SdpAnswer = 2;

        public static string Texto(IntPtr p) { return p == IntPtr.Zero ? null : Marshal.PtrToStringAnsi(p); }
        public static string Erro(IntPtr gerror) { return gerror == IntPtr.Zero ? null : Texto(Marshal.ReadIntPtr(gerror, 8)); }

        static bool iniciado;
        static readonly object travaInit = new object();
        public static string Pasta;

        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetDllDirectory(string path);

        /* Carrega o GStreamer da pasta "gstreamer" do app. Devolve null se deu certo, ou o motivo. */
        public static string Iniciar()
        {
            lock (travaInit)
            {
                if (iniciado) return null;
                try
                {
                    if (Environment.OSVersion.Platform == PlatformID.Win32NT)
                    {
                        Pasta = Path.Combine(Program.Pasta, "gstreamer");
                        var bin = Path.Combine(Pasta, "bin");
                        if (!File.Exists(Path.Combine(bin, Core))) return "GStreamer files not found in " + bin;
                        SetDllDirectory(bin);
                        Environment.SetEnvironmentVariable("PATH", bin + ";" + Environment.GetEnvironmentVariable("PATH"));
                        Environment.SetEnvironmentVariable("GST_PLUGIN_SYSTEM_PATH_1_0", Path.Combine(Pasta, "lib", "gstreamer-1.0"));
                        Environment.SetEnvironmentVariable("GST_PLUGIN_PATH_1_0", "");
                        Environment.SetEnvironmentVariable("GST_REGISTRY_1_0", Path.Combine(Path.GetDirectoryName(Program.LogPath), "gst-registry.bin"));
                        Environment.SetEnvironmentVariable("GST_REGISTRY_FORK", "no");
                    }
                    gst_init(IntPtr.Zero, IntPtr.Zero);
                    iniciado = true;
                    Program.Log("NATIVO: " + Texto(gst_version_string()) + " loaded");
                    return null;
                }
                catch (Exception e) { return e.GetType().Name + ": " + e.Message; }
            }
        }

        public static bool Existe(string fabrica)
        {
            var f = gst_element_factory_find(fabrica);
            if (f == IntPtr.Zero) return false;
            gst_object_unref(f);
            return true;
        }
    }

    /* Uma chamada do iPhone: pipeline webrtcbin → decodificador → appsink. */
    sealed class ReceptorGst : IDisposable
    {
        public delegate void QuadroHandler(IntPtr bgra, int largura, int altura);

        public readonly string Origem, Conexao;
        readonly SinalPeerJs sinal;
        readonly QuadroHandler aoQuadro;
        readonly List<string> mids;
        readonly int bps;
        IntPtr pipeline, webrtc, bus;
        volatile IntPtr saida;
        volatile bool ativo = true;
        Thread laco;
        public DateTime UltimoQuadro = DateTime.UtcNow;
        public bool TeveQuadro;
        public long Quadros;
        // os delegates ficam guardados aqui: o GStreamer chama esses ponteiros enquanto o pipeline existir
        readonly Gst.PromiseFunc aoRemoto, aoResposta;
        readonly Gst.PadAdded aoPad;
        readonly Gst.IceCandidate aoCandidato;
        static string decodificador;

        public ReceptorGst(SinalPeerJs sinal, string origem, string conexao, string ofertaSdp, int bps, QuadroHandler aoQuadro)
        {
            this.sinal = sinal; Origem = origem; Conexao = conexao; this.bps = bps; this.aoQuadro = aoQuadro;
            aoRemoto = RemotoPronto; aoResposta = RespostaPronta; aoPad = PadNovo; aoCandidato = CandidatoLocal;
            var oferta = SdpNativo.LimparOferta(ofertaSdp);
            mids = SdpNativo.Mids(oferta);

            pipeline = Gst.gst_pipeline_new("inkdoshub");
            webrtc = Gst.gst_element_factory_make("webrtcbin", "w");
            if (webrtc == IntPtr.Zero) throw new InvalidOperationException("webrtcbin plugin missing");
            Gst.gst_util_set_object_arg(webrtc, "bundle-policy", "max-bundle");
            Gst.gst_util_set_object_arg(webrtc, "latency", "40"); // ms no buffer de rede: só o bastante para reordenar pacotes
            Gst.gst_util_set_object_arg(webrtc, "stun-server", "stun://stun.l.google.com:19302");
            Gst.gst_util_set_object_arg(webrtc, "turn-server", "turn://peerjs:peerjsp@eu-0.turn.peerjs.com:3478");
            Gst.gst_bin_add(pipeline, webrtc);
            Gst.g_signal_connect_data(webrtc, "pad-added", aoPad, IntPtr.Zero, IntPtr.Zero, 0);
            Gst.g_signal_connect_data(webrtc, "on-ice-candidate", aoCandidato, IntPtr.Zero, IntPtr.Zero, 0);
            bus = Gst.gst_element_get_bus(pipeline);
            Gst.gst_element_set_state(pipeline, Gst.Playing);

            IntPtr msg;
            if (Gst.gst_sdp_message_new_from_text(oferta, out msg) != 0 || msg == IntPtr.Zero) throw new InvalidOperationException("bad offer SDP");
            var desc = Gst.gst_webrtc_session_description_new(Gst.SdpOffer, msg);
            var p = Gst.gst_promise_new_with_change_func(aoRemoto, IntPtr.Zero, IntPtr.Zero);
            Gst.Emitir(webrtc, "set-remote-description", desc, p);
            Gst.gst_webrtc_session_description_free(desc);

            laco = new Thread(Laco) { IsBackground = true, Name = "receptor" };
            laco.Start();
        }

        void RemotoPronto(IntPtr promise, IntPtr data)
        {
            Gst.gst_mini_object_unref(promise);
            if (!ativo) return;
            var p = Gst.gst_promise_new_with_change_func(aoResposta, IntPtr.Zero, IntPtr.Zero);
            Gst.Emitir(webrtc, "create-answer", IntPtr.Zero, p);
        }

        void RespostaPronta(IntPtr promise, IntPtr data)
        {
            try
            {
                if (!ativo) return;
                var reply = Gst.gst_promise_get_reply(promise);
                var valor = reply == IntPtr.Zero ? IntPtr.Zero : Gst.gst_structure_get_value(reply, "answer");
                if (valor == IntPtr.Zero) { Program.Log("NATIVO: webrtcbin gave no answer"); return; }
                var desc = Gst.g_value_get_boxed(valor);              // GstWebRTCSessionDescription { type; sdp* }
                Gst.Emitir(webrtc, "set-local-description", desc, IntPtr.Zero);
                var txt = Gst.gst_sdp_message_as_text(Marshal.ReadIntPtr(desc, 8));
                var sdp = Gst.Texto(txt);
                Gst.g_free(txt);
                sinal.Resposta(Origem, Conexao, SdpNativo.Bitrate(sdp, bps));
                Program.Log("NATIVO: answer sent");
            }
            finally { Gst.gst_mini_object_unref(promise); }
        }

        void CandidatoLocal(IntPtr element, uint linha, IntPtr candidato, IntPtr data)
        {
            if (!ativo) return;
            var c = Gst.Texto(candidato);
            string mid = linha < mids.Count ? mids[(int)linha] : linha.ToString();
            sinal.MandarCandidato(Origem, Conexao, c, (int)linha, mid);
        }

        public void CandidatoRemoto(string candidato, int linha)
        {
            if (!ativo || webrtc == IntPtr.Zero) return;
            Gst.Emitir(webrtc, "add-ice-candidate", (uint)linha, candidato);
        }

        static string Ramo()
        {
            if (decodificador == null)
            {
                // placa de vídeo primeiro (Direct3D 11, Media Foundation); no Linux (testes) o FFmpeg
                if (Gst.Existe("d3d11h264dec") && Gst.Existe("d3d11download"))
                    decodificador = "d3d11h264dec ! d3d11convert ! video/x-raw(memory:D3D11Memory),format=BGRA ! d3d11download ! video/x-raw,format=BGRA";
                else if (Gst.Existe("mfh264dec"))
                    decodificador = "mfh264dec ! videoconvert ! video/x-raw,format=BGRA";
                else
                    decodificador = "avdec_h264 ! videoconvert ! video/x-raw,format=BGRA";
                Program.Log("NATIVO: decoder branch = " + decodificador);
            }
            return "rtph264depay request-keyframe=true wait-for-keyframe=true ! h264parse ! " + decodificador +
                " ! appsink name=saida sync=false max-buffers=1 drop=true";
        }

        void PadNovo(IntPtr element, IntPtr pad, IntPtr data)
        {
            if (!ativo || Gst.gst_pad_get_direction(pad) != 1 /* GST_PAD_SRC */) return;
            IntPtr erro;
            var ramo = Gst.gst_parse_bin_from_description(Ramo(), true, out erro);
            if (ramo == IntPtr.Zero) { Program.Log("NATIVO: branch error " + Gst.Erro(erro)); return; }
            Gst.gst_bin_add(pipeline, ramo);
            Gst.gst_element_sync_state_with_parent(ramo);
            var entrada = Gst.gst_element_get_static_pad(ramo, "sink");
            int r = Gst.gst_pad_link(pad, entrada);
            Gst.gst_object_unref(entrada);
            Program.Log("NATIVO: media pad linked result=" + r);
            saida = Gst.gst_bin_get_by_name(ramo, "saida");
        }

        void Laco()
        {
            while (ativo)
            {
                var s = saida;
                if (s == IntPtr.Zero) Thread.Sleep(50);
                else
                {
                    var amostra = Gst.gst_app_sink_try_pull_sample(s, 100UL * 1000 * 1000);
                    if (amostra != IntPtr.Zero)
                    {
                        try { Entregar(amostra); }
                        catch (Exception e) { Program.Log("NATIVO: frame error " + e.Message); }
                        Gst.gst_mini_object_unref(amostra);
                    }
                }
                LerBus();
            }
        }

        void Entregar(IntPtr amostra)
        {
            var caps = Gst.gst_sample_get_caps(amostra);
            var buf = Gst.gst_sample_get_buffer(amostra);
            if (caps == IntPtr.Zero || buf == IntPtr.Zero) return;
            var st = Gst.gst_caps_get_structure(caps, 0);
            int w, h;
            if (!Gst.gst_structure_get_int(st, "width", out w) || !Gst.gst_structure_get_int(st, "height", out h)) return;
            var info = new Gst.MapInfo();
            if (!Gst.gst_buffer_map(buf, ref info, 1 /* READ */)) return;
            try
            {
                if ((long)info.Size.ToUInt64() >= (long)w * h * 4)
                {
                    UltimoQuadro = DateTime.UtcNow;
                    TeveQuadro = true;
                    Quadros++;
                    aoQuadro(info.Data, w, h);
                }
            }
            finally { Gst.gst_buffer_unmap(buf, ref info); }
        }

        void LerBus()
        {
            if (bus == IntPtr.Zero) return;
            IntPtr m;
            while ((m = Gst.gst_bus_pop_filtered(bus, Gst.MsgError)) != IntPtr.Zero)
            {
                IntPtr e, d;
                Gst.gst_message_parse_error(m, out e, out d);
                Program.Log("NATIVO: GStreamer error: " + Gst.Erro(e) + " | " + Gst.Texto(d));
                if (e != IntPtr.Zero) Gst.g_error_free(e);
                if (d != IntPtr.Zero) Gst.g_free(d);
                Gst.gst_mini_object_unref(m);
            }
            while ((m = Gst.gst_bus_pop_filtered(bus, Gst.MsgWarning)) != IntPtr.Zero)
            {
                IntPtr e, d;
                Gst.gst_message_parse_warning(m, out e, out d);
                Program.Log("NATIVO: GStreamer warning: " + Gst.Erro(e));
                if (e != IntPtr.Zero) Gst.g_error_free(e);
                if (d != IntPtr.Zero) Gst.g_free(d);
                Gst.gst_mini_object_unref(m);
            }
        }

        public void Dispose()
        {
            if (!ativo) return;
            ativo = false;
            if (laco != null && Thread.CurrentThread != laco) laco.Join(2000);
            var s = saida; saida = IntPtr.Zero;
            if (pipeline != IntPtr.Zero)
            {
                Gst.gst_element_set_state(pipeline, Gst.Null);
                if (s != IntPtr.Zero) Gst.gst_object_unref(s);
                if (bus != IntPtr.Zero) Gst.gst_object_unref(bus);
                Gst.gst_object_unref(pipeline);
            }
            pipeline = webrtc = bus = IntPtr.Zero;
        }
    }

    /* Junta sinalização e chamadas: uma chamada por vez (a mais nova substitui a anterior). */
    sealed class ReceptorNativo : IDisposable
    {
        public event Action<string> Estado;
        public event Action<bool> Conectado;
        readonly SinalPeerJs sinal;
        readonly ReceptorGst.QuadroHandler aoQuadro;
        readonly object trava = new object();
        ReceptorGst chamada;
        public string Visualizacao = "preencher";
        readonly Timer vigia;
        bool conectado;

        public ReceptorNativo(string codigo, ReceptorGst.QuadroHandler aoQuadro)
        {
            this.aoQuadro = aoQuadro;
            sinal = new SinalPeerJs("inkdoshub-webcam-" + codigo);
            sinal.Estado += s => { if (!conectado && Estado != null) Estado(s); };
            sinal.Oferta += NovaOferta;
            sinal.Candidato += (origem, conexao, cand, linha) =>
            {
                ReceptorGst c;
                lock (trava) c = chamada;
                if (c != null && c.Conexao == conexao) c.CandidatoRemoto(cand, linha);
            };
            sinal.Saiu += origem =>
            {
                lock (trava) if (chamada != null && chamada.Origem == origem) Encerrar("The iPhone disconnected. Waiting for it again…");
            };
            vigia = new Timer(Vigiar, null, 1000, 1000);
            sinal.Iniciar();
        }

        void NovaOferta(string origem, string conexao, string sdp, Dictionary<string, object> meta)
        {
            var view = Json.Str(meta, "view");
            if (view == "preencher" || view == "ajustar" || view == "gira90" || view == "gira270") Visualizacao = view;
            int bps = (int)Math.Min(40e6, Math.Max(0, Json.Num(meta, "bps", 0)));
            if (bps < 1000000) bps = 0;
            Program.Log("NATIVO: offer from " + origem + " conn=" + conexao + " view=" + Visualizacao + " bps=" + bps);
            lock (trava)
            {
                if (chamada != null) { chamada.Dispose(); chamada = null; }
                try
                {
                    chamada = new ReceptorGst(sinal, origem, conexao, sdp, bps, aoQuadro);
                    if (Estado != null) Estado("Connecting to the iPhone…");
                }
                catch (Exception e)
                {
                    Program.Log("NATIVO: call setup failed: " + e);
                    if (Estado != null) Estado("Native receiver error: " + e.Message);
                }
            }
        }

        void Vigiar(object _)
        {
            lock (trava)
            {
                var c = chamada;
                if (c == null) return;
                if (c.TeveQuadro && !conectado)
                {
                    conectado = true;
                    if (Estado != null) Estado("Receiving from the iPhone (native receiver).");
                    if (Conectado != null) Conectado(true);
                }
                // sem quadro por 8 s (ou 20 s sem nunca ter chegado nenhum): a chamada morreu
                double parado = (DateTime.UtcNow - c.UltimoQuadro).TotalSeconds;
                if (parado > (c.TeveQuadro ? 8 : 20)) Encerrar("The iPhone disconnected. Waiting for it again…");
            }
        }

        void Encerrar(string texto)
        {
            if (chamada != null) { chamada.Dispose(); chamada = null; }
            if (conectado && Conectado != null) Conectado(false);
            conectado = false;
            if (Estado != null) Estado(texto);
        }

        public long Quadros { get { var c = chamada; return c == null ? 0 : c.Quadros; } }

        public void Dispose()
        {
            vigia.Dispose();
            sinal.Dispose();
            lock (trava) if (chamada != null) { chamada.Dispose(); chamada = null; }
        }
    }
}
