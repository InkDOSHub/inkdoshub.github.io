export PS1='\[\e[1;32m\]root@inkdoshub\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]# '
export TERM=xterm-256color
alias ls='ls --color=auto'
alias ll='ls -la'
help() {
  echo "Commands: ls cd cat vi top ps df free"
  echo "Install programs: apk add python3 git nano (any Alpine package)"
  echo "No internet? Switch the network at the top (wisp or relay) and tap Restart."
  echo "Device files: the ~/files folder (Upload/Download buttons)"
  echo "Screen the wrong size? Type: resize"
  echo "Tap Save to keep everything."
}
[ -t 0 ] && resize >/dev/null
