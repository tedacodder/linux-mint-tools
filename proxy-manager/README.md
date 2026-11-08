# Proxy Manager

A Cinnamon applet with one switch to route your tools and system through a local proxy.
Part of [linux-mint-tools](https://github.com/tedacodder/linux-mint-tools).

## Features

- One switch to turn the proxy on or off, with a status pill.
- **Gateway check:** turning the proxy on first checks that a proxy answers. If none does,
  nothing changes.
- **Gateway change safety:** if the network moves to a machine that isn't a proxy, the proxy
  turns off, so your internet keeps working.
- **Automatic gateway detection,** with a "Use detected" button.
- Per-tool switches, plus "Turn all on" and "Turn all off" for each group.
- **Clean disable:** only the settings the applet wrote are removed.

## What it configures

| Tool | Where it writes |
|---|---|
| Shell | `~/.config/environment.d/proxy.conf`, plus a block at the top of `~/.bashrc` |
| Git | `git config --global http.proxy` and `https.proxy` |
| npm, yarn | their own config |
| pip | `~/.config/pip/pip.conf` |
| curl | `~/.curlrc` |
| wget | `~/.wgetrc` |
| Docker | `~/.docker/config.json` |
| VS Code | `http.proxy` in the settings file (comments are kept) |
| Chrome, Chromium | launchers that go through a wrapper reading the live gateway |
| Firefox | `user.js` in each profile |
| System | GNOME/Cinnamon proxy settings through `gsettings` |
| APT | `/etc/apt/apt.conf.d/95proxy-manager` (asks for your password when turned on) |

## Requirements

Linux Mint 22 with Cinnamon. The installer installs `jq`, `libnotify-bin`, and `iproute2`.

## Installation

```bash
git clone https://github.com/tedacodder/linux-mint-tools.git
cd linux-mint-tools/proxy-manager
bash tests/run-all.sh      # optional: runs the test suite
chmod +x install.sh uninstall.sh
./install.sh
```

The installer also adds a NetworkManager hook, which checks the proxy again when the network
changes. It asks for your password once.

Restart Cinnamon, then add **Proxy Manager** from the panel's Applets menu.

## Usage

Open the menu and turn on the switch. Choose the tools to route under the sections. If
auto-detect picks the wrong address, set the gateway under **Gateway**.

Command line:

```bash
APPLET=~/.local/share/cinnamon/applets/proxy-manager@tedacodder-linux
$APPLET/proxy-manager.sh status
$APPLET/proxy-manager.sh enable                  # refuses if no proxy answers
$APPLET/proxy-manager.sh enable --force          # enable even if nothing answers
$APPLET/proxy-manager.sh disable
$APPLET/proxy-manager.sh detect                  # what auto-detect sees now
$APPLET/proxy-manager.sh test                    # is the proxy forwarding traffic?
$APPLET/proxy-manager.sh set-gateway 192.168.1.10 8080
$APPLET/proxy-manager.sh set-integration docker on
```

Settings are stored in `~/.config/proxy-manager/proxy.json`.

> [!NOTE]
> Auto-detect usually picks your router, which is not a proxy. If your proxy runs on another
> machine, set its address with `set-gateway`.

> [!WARNING]
> A proxy that does not answer breaks your internet. Use `enable --force` only when you know
> the proxy is running.

## If your internet stops working

1. Turn the proxy off:

   ```bash
   $APPLET/proxy-manager.sh disable --no-check
   ```

2. Check for leftover settings:
   - proxy lines in `/etc/environment`
   - `/etc/apt/apt.conf.d/95proxy-manager`
   - `gsettings get org.gnome.system.proxy mode`, which should print `'none'`

## Tests

```bash
bash tests/run-all.sh
```

The tests run in a temporary home folder, with stub versions of `curl`, `ip`, `gsettings`,
`pkexec`, and `npm`, so they never change your real settings. The menu logic is tested with
`node tests/applet_logic.js`.

## Uninstall

Turn the proxy off first, so the settings it wrote are removed, then run:

```bash
./uninstall.sh
```
