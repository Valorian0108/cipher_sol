#!/usr/bin/env bash
for c in cc gcc make pkg-config curl git; do
  printf "%s: " "$c"
  command -v "$c" || echo MISSING
done
printf "libssl-dev: "
dpkg -s libssl-dev >/dev/null 2>&1 && echo present || echo missing
printf "sudo-nopasswd: "
sudo -n true >/dev/null 2>&1 && echo yes || echo no
printf "cargo: "
command -v cargo || echo MISSING
printf "rustup: "
command -v rustup || echo MISSING
