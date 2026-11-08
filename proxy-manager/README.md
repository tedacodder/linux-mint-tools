# Proxy Manager for Linux Mint (Cinnamon)

A Cinnamon panel applet that routes your system, shell, and developer tools through a
local HTTP/HTTPS proxy, with one switch.

## Features

- **One switch** to turn the proxy on or off.
- **Gateway check:** turning the proxy on first checks that a proxy answers at the
  gateway. If nothing answers, nothing is changed. `enable --force` skips the check.
- **Gateway change safety:** if the network changes to a gateway that is not a proxy,
  the proxy turns off, so your internet keeps working, and you get a notification.
- **Automatic gateway detection:** the Gateway card shows the detected gateway, interface,
  and port. "Use detected" fills in the fields. Nothing is saved until you press
  "Save gateway".
- **Per-integration control:** turn each tool on or off separately, or use "Turn all on"
  and "Turn all off" for a group.
- **Clean disable:** turning the proxy off undoes only what the applet applied. Your own
  git, Docker, and system proxy settings are kept unless they point at this gateway.

## What it configures

| Integration | Where it writes |
|---|---|
| Shell | `~/.config/environment.d/proxy.conf`, plus a block at the top of `~/.bashrc` |
| Git | `git config --global http.proxy` and `https.proxy` |
| npm, yarn | their own config |
| pip | `~/.config/pip/pip.conf` |
| curl | `~/.curlrc` |
| wget | `~/.wgetrc` |
| Docker | `~/.docker/config.json` (proxy passed to containers) |
| VS Code | `http.proxy` in VS Code settings (comments are kept) |
| Chrome / Chromium | launchers that go through a wrapper reading the live gateway |
| Firefox | `user.js` in each profile |
| System settings | GNOME/Cinnamon proxy settings (`gsettings`) |
| APT | `/etc/apt/apt.conf.d/95proxy-manager` (asks for your password when turned on) |

## Requirements

Linux Mint 22 with Cinnamon. The installer installs `jq`, `libnotify-bin`, and `iproute2`.

## Install

    chmod +x install.sh uninstall.sh
    ./install.sh

Restart Cinnamon (Alt+F2, type `r`, press Enter), then add **Proxy Manager** from the
panel's Applets menu.

The installer also installs a NetworkManager hook, so the proxy is re-checked when the
network changes. It needs your password once.

## Command line

    APPLET=~/.local/share/cinnamon/applets/proxy-manager@tedacodder-linux
    $APPLET/proxy-manager.sh status
    $APPLET/proxy-manager.sh enable                 # refuses if no proxy answers
    $APPLET/proxy-manager.sh enable --force         # enable even if nothing answers
    $APPLET/proxy-manager.sh disable
    $APPLET/proxy-manager.sh detect                 # what auto-detect sees right now
    $APPLET/proxy-manager.sh test                   # is the proxy forwarding traffic?
    $APPLET/proxy-manager.sh set-gateway 192.168.137.1 8080
    $APPLET/proxy-manager.sh set-auto true
    $APPLET/proxy-manager.sh set-integration docker on

Settings live in `~/.config/proxy-manager/proxy.json`.

## If your internet stops working

1. Turn the proxy off: `$APPLET/proxy-manager.sh disable --no-check`
2. If that doesn't help, check the leftover settings:
   - `/etc/environment` for proxy lines
   - `/etc/apt/apt.conf.d/95proxy-manager`
   - `gsettings get org.gnome.system.proxy mode` (should be `'none'`)

## Tests

    bash tests/run-all.sh

The tests run in a temporary home folder, with stub versions of `curl`, `ip`,
`gsettings`, `pkexec`, and `npm`. They never change your real settings. The menu logic is
checked with `node tests/applet_logic.js` when Node is installed.

## Known issues

- Some reports from real use (the switch turning itself off, and "Turn all on" not
  applying) came from a Cinnamon function that does not pass command output back. The
  applet now reads output with `Gio.Subprocess`. Verify that behavior on your system
  before you rely on it.
- The proxy must actually run at the gateway address. Auto-detect usually picks your
  router, which is not a proxy. Set the address yourself with `set-gateway` if your proxy
  runs elsewhere.

## Uninstall

    ./uninstall.sh

Turn the proxy off first, so the settings it wrote are removed.
