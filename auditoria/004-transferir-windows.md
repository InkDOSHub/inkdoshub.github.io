# 004 · Transferir Windows (2026-10-29)

**Lido:** `windows/transferir/Program.cs` (servidor HTTP local, Wi-Fi direto), `web/pc.html` (painel do PC),
`web/celular.html` (página do celular). `web/qrcode.js` é de terceiros (é a mesma biblioteca da Webcam, embutida no .exe).

## Mudanças feitas

1. **Escape de HTML mais seguro (`pc.html`, `celular.html`):** o `esc()` antigo (via `div.innerHTML`) não escapava
   aspas, e o nome do arquivo entra num atributo (`download="..."`). No Windows um nome não pode ter `"`, então
   não havia falha explorável, mas a proteção agora não depende disso.
2. **Painel do PC:** os números do diagnóstico vêm do celular. Agora são convertidos para número antes de usar,
   então um valor inválido não quebra o painel nem divide por zero.
3. **Servidor:** cada conexão tinha uma thread esperando o cabeçalho sem prazo. Um aparelho da rede podia abrir muitas
   conexões e não mandar nada. Agora o cabeçalho tem 15 s para chegar; depois disso a leitura volta a ser sem prazo (envios longos não são afetados).

## Segurança conferida (sem mudança)

- O celular só acessa com a chave do QR (8 caracteres de gerador criptográfico, comparação em tempo constante).
- O painel do PC (`localhost`) exige um token de 24 caracteres, para que sites abertos no navegador do PC não usem as rotas.
- O cabeçalho `Host` precisa ser um IP ou `localhost`, o que bloqueia DNS rebinding.
- O nome dos arquivos recebidos é limpo (`Limpar`: sem pastas, sem caracteres proibidos) e nunca sobrescreve um arquivo
  (cria "nome (2)"). Há conferência de espaço livre, mantendo 1 GB de folga.
- O celular só baixa arquivos que a pessoa escolheu no PC (pelo id da lista), nunca por caminho.
- O Wi-Fi direto usa uma senha aleatória de 10 caracteres e não pede administrador.
- Nada sai da rede local; não há servidor externo.

## Achados sem mudança

- A conexão é HTTP sem TLS: na rede do próprio Wi-Fi direto (com senha) o risco é baixo; pelo roteador, outro aparelho da mesma rede poderia ver o tráfego. Para TLS seria preciso um certificado local, o que é complexo para um app de teste.
- `diagCelular` (JSON do celular) entra cru no JSON do estado depois de um teste simples (`{...}` e sem `<`). Só quem tem a chave consegue mandar. Aceitável.
- O comentário do topo ainda diz "protótipo" e descreve o modo pelo roteador, que o painel ainda aceita.
- O `.exe` continua sem assinatura digital (adiado).

## Commit

Ver `git log -- auditoria/004-transferir-windows.md`. O build roda sozinho na action `transferir-windows`.
