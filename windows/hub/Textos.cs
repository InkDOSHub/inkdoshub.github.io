// Textos da interface: português do Brasil (o texto do código) e inglês para Windows em outros idiomas.
using System.Collections.Generic;
using System.Globalization;

namespace InkDOSHub
{
    static class T
    {
        public static readonly bool Pt = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "pt";
        static readonly Dictionary<string, string> En = new Dictionary<string, string>
        {
            { "Ferramentas guardadas", "Saved tools" }, { "Procurar atualizações", "Check for updates" },
            { "Editor de código: VS Code", "Code editor: VS Code" }, { "Editor de código: Zed (leve)", "Code editor: Zed (light)" },
            { "Segurança e privacidade", "Security and privacy" }, { "Abrir o InkDOS Hub no navegador", "Open InkDOS Hub in the browser" },
            { "Linux", "Linux" }, { "Código", "Code" }, { "Documentos", "Documents" }, { "PDF", "PDF" }, { "Cortar vídeo", "Cut video" },
            { "Webcam", "Webcam" }, { "Transferir", "Transfer" }, { "Mais apps", "More apps" },
            { "Abrir", "Open" }, { "Baixar · {0}", "Download · {0}" }, { "no navegador", "in the browser" },
            { "Instalar {0}?", "Install {0}?" }, { "De onde vem", "Where it comes from" }, { "Quem publica", "Publisher" },
            { "Licença", "License" }, { "Versão", "Version" }, { "Download", "Download" }, { "No disco (aprox.)", "On disk (approx.)" },
            { "Livre no PC", "Free on this PC" }, { "O que acessa", "What it accesses" }, { "Segurança", "Security" },
            { "Antes de instalar, o InkDOS Hub confere a impressão digital (SHA-256) do arquivo e a assinatura digital de {0}.", "Before installing, InkDOS Hub checks the file's fingerprint (SHA-256) and the digital signature of {0}." },
            { "Antes de instalar, o InkDOS Hub confere a impressão digital (SHA-256) do arquivo. Este fabricante não assina o programa.", "Before installing, InkDOS Hub checks the file's fingerprint (SHA-256). This publisher does not sign the program." },
            { "Cancelar", "Cancel" }, { "Baixar e instalar", "Download and install" }, { "Verificado ✓", "Verified ✓" },
            { "Baixando de {0}…", "Downloading from {0}…" }, { "Conferindo a impressão digital (SHA-256)…", "Checking the fingerprint (SHA-256)…" },
            { "Abrindo o instalador de {0}…", "Opening the installer from {0}…" }, { "Extraindo…", "Extracting…" },
            { "Criando o Linux no WSL…", "Creating Linux in WSL…" },
            { "O arquivo baixado não é o publicado pelo fabricante (SHA-256 diferente). Nada foi instalado.", "The downloaded file is not the one the publisher released (SHA-256 mismatch). Nothing was installed." },
            { "A instalação não terminou. Se o instalador foi cancelado, tente de novo.", "Installation did not finish. If the installer was canceled, try again." },
            { "A assinatura digital de {0} não é válida. Nada foi instalado.", "The digital signature of {0} is not valid. Nothing was installed." },
            { "{0} foi assinado por \"{1}\", e não por \"{2}\". Nada foi instalado.", "{0} was signed by \"{1}\", not by \"{2}\". Nothing was installed." },
            { "{0} não está instalado.", "{0} is not installed." },
            { "O WSL do Windows ainda não está ligado. Toque em \"Ligar o WSL\" e, se o Windows pedir, reinicie o PC.", "Windows WSL is not turned on yet. Tap \"Turn on WSL\" and restart the PC if Windows asks." },
            { "O WSL não conseguiu criar o Linux: {0}", "WSL could not create Linux: {0}" },
            { "Ligar o WSL", "Turn on WSL" },
            { "O Linux roda no WSL, que vem com o Windows mas precisa ser ligado uma vez (pede permissão de administrador e, às vezes, reiniciar).", "Linux runs in WSL, which comes with Windows but must be turned on once (asks for administrator permission and sometimes a restart)." },
            { "Pronto.", "Done." }, { "Falhou: {0}", "Failed: {0}" }, { "Fechar", "Close" },
            { "Remover", "Remove" }, { "Remover {0} deste PC?", "Remove {0} from this PC?" },
            { "Nenhuma ferramenta guardada ainda.", "No tools saved yet." }, { "Total no disco: {0}", "Total on disk: {0}" },
            { "Programas com instalador próprio também aparecem em Configurações > Apps do Windows.", "Programs with their own installer also appear in Windows Settings > Apps." },
            { "Tudo atualizado.", "Everything is up to date." }, { "Atualização disponível", "Update available" }, { "Atualizar", "Update" },
            { "Atualizar {0} ({1} → {2})", "Update {0} ({1} → {2})" },
            { "Juntar PDFs", "Merge PDFs" }, { "Comprimir PDF", "Compress PDF" }, { "Girar páginas", "Rotate pages" },
            { "Escolha os PDFs na ordem em que devem ficar.", "Choose the PDFs in the order they should be." },
            { "Salvo: {0}", "Saved: {0}" }, { "Trabalhando…", "Working…" },
            { "Início (mm:ss)", "Start (mm:ss)" }, { "Fim (mm:ss)", "End (mm:ss)" }, { "Escolher vídeo", "Choose video" }, { "Cortar", "Cut" },
            { "Corta sem recompactar: é rápido e não perde qualidade (o corte cai no quadro-chave mais próximo).", "Cuts without re-encoding: fast and lossless (the cut lands on the nearest keyframe)." },
            { "Fotos, música, gravador, quadro e os documentos rápidos continuam no InkDOS Hub do navegador.", "Photos, music, recorder, whiteboard and quick documents stay in the browser version of InkDOS Hub." },
            { "Atualizar o InkDOS Hub", "Update InkDOS Hub" },
        };

        public static string Tx(string s, params object[] a)
        {
            string r = s;
            if (!Pt) { string e; if (En.TryGetValue(s, out e)) r = e; }
            return a.Length > 0 ? string.Format(r, a) : r;
        }
    }
}
