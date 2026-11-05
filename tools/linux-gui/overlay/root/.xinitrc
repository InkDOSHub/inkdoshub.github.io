#!/bin/sh
# Terminal › Desktop: Xfce with the Arc theme and Papirus icons (all ready-made Alpine packages)
xrandr -s 1280x720 2>/dev/null
xrdb -merge /root/.Xresources 2>/dev/null
exec dbus-launch --exit-with-session startxfce4
