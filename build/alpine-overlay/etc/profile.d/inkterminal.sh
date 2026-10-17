export PS1='\[\e[1;32m\]root@inkterminal\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]# '
export TERM=xterm-256color
alias ls='ls --color=auto'
alias ll='ls -la'
help() {
  echo "Comandos: ls cd cat vi top ps df free"
  echo "Instalar programas: apk add python3 git nano"
  echo "Arquivos do iPad: pasta ~/ipad"
  echo "Tela com tamanho errado? Digite: resize"
  echo "Toque em Salvar para guardar tudo."
}
[ -t 0 ] && resize >/dev/null
