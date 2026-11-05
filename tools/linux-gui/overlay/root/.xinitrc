#!/bin/sh
# Emulator › Linux desktop: Openbox (windows), tint2 (taskbar), PCManFM (desktop icons and files)
xrandr -s 1280x720 2>/dev/null
xsetroot -solid "#3a6ea5"
export $(dbus-launch)
tint2 &
pcmanfm --desktop &
exec openbox-session
