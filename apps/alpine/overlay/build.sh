#!/bin/sh
# Packs overlay/ into ../overlay.tar (files the terminal adds on top of Alpine). Run from apps/alpine/.
cd "$(dirname "$0")" && tar --owner=0 --group=0 --format=ustar -cf ../overlay.tar --exclude=build.sh etc usr
