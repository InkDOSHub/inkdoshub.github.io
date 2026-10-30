# Testes de desempenho

- `windows/teste-desempenho.bat`: memória e CPU da tela inicial e de 7 apps abertos em Edge, WebView2, Brave e Electron.
- `windows/teste-arquivos.bat`: baixa os arquivos de teste para `Downloads\InkDOSHub-arquivos-teste\` e abre cada um no app dele em cada motor. Mede o tempo para abrir o app e o arquivo, a memória, a CPU e o tempo para fechar. Relatório em `Área de Trabalho\InkDOSHub-teste\relatorio-arquivos.txt`.

Os arquivos (simples, médio e complexo: PDF, DOCX, XLSX, PPTX, TXT, EPUB, JPG, MP4, MP3, JS e Excalidraw) são gerados por `tools/gerar_arquivos_teste.py`. A action `arquivos-teste` publica-os na release `arquivos-teste` com a `lista.txt` (nível, SHA-256, nome). Ficam fora do git para o clone não crescer. Para mudar os arquivos, edite o gerador; a action roda sozinha no push.
