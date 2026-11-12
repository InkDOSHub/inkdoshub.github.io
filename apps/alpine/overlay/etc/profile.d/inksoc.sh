# InkSoC terminal: the guide replaces the shell's built-in help; colors in ls and the prompt
alias help=inksoc-help
alias ls='ls --color=auto'
if [ "$(id -u)" -eq 0 ]; then PS1='\[\033[1;31m\]\u@\h\[\033[0m\]:\[\033[1;34m\]\w\[\033[0m\]# '
else PS1='\[\033[1;32m\]\u@\h\[\033[0m\]:\[\033[1;34m\]\w\[\033[0m\]$ '; fi
