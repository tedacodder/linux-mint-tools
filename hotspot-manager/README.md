# Hotspot Manager

A Cinnamon applet that runs a Wi-Fi hotspot from the panel. Part of
[linux-mint-tools](https://github.com/tedacodder/linux-mint-tools).

It runs the same command you would type by hand:

```bash
nmcli device wifi hotspot ifname wlp2s0 ssid NAME password PASSWORD
```

## Features

- One switch to start and stop the hotspot, with a status pill (ON AIR, OFFLINE, WORKING).
- Connected devices, with the name each device sent, its IP address, and its state.
- Notifications when a device joins or leaves.
- A QR code to join from a phone camera.
- Copy or reveal the network name and password.
- Change the name or password. A running hotspot restarts with the change.
- Auto-off after 30, 60, or 120 minutes.

## Requirements

- Linux Mint 22 with Cinnamon, and NetworkManager (the default).
- A Wi-Fi adapter that supports access-point mode. Check with:

  ```bash
  iw list | grep -A12 "Supported interface modes" | grep AP
  ```

  If `AP` is listed, the adapter can host a hotspot.
- `jq` and `qrencode`. The installer installs both.

## Installation

```bash
git clone https://github.com/tedacodder/linux-mint-tools.git
cd linux-mint-tools/hotspot-manager
bash tests/run-all.sh      # optional: runs the test suite
./install.sh
```

Restart Cinnamon, then add **Hotspot Manager** from the panel's Applets menu.

## Usage

Click the icon and turn the switch on. To change the name or password, open
**Settings**, edit the fields, and press **Save & apply**.

To join from a phone, choose the network name and type the password, or press
**Show QR to join** and scan the code.

The same script works from the command line:

```bash
APP=~/.local/share/cinnamon/applets/hotspot-manager@tedacodder-linux/hotspot-manager.sh
$APP status
$APP start
$APP stop
$APP set-ssid NAME
$APP set-password PASSWORD
$APP qr
```

Other commands: `restart`, `ifaces`, `show-password`, `generate-password`, and `set-iface`.
Every command prints JSON.

> [!IMPORTANT]
> The password is stored in plain text in `~/.config/hotspot-manager/config.json`,
> readable only by you. The QR image also contains it, at
> `~/.config/hotspot-manager/qr/join.png`. Delete the image when you no longer need it.

## How it works

- `hotspot-manager.sh` wraps `nmcli` and `ip`, and prints JSON.
- `applet.js` polls the script every 5 seconds and runs commands without blocking the desktop.
- Connected devices come from `ip neigh`. Names come from NetworkManager's DHCP lease file,
  `/var/lib/NetworkManager/dnsmasq-<adapter>.leases`.

## Limits

- The Wi-Fi card limits the number of devices, usually to 10 to 30. Five to ten phones
  browse comfortably.
- Many cards cannot be a hotspot and a Wi-Fi client at once. Starting the hotspot can
  disconnect your normal Wi-Fi.
- Some phones use a random name or address, so they appear as `unknown device`.
- Auto-off runs only while Cinnamon is running.

## Troubleshooting

**The switch turns back off.** Read the applet log:

```bash
grep "hotspot-manager" ~/.xsession-errors | tail -20
```

**"no Wi-Fi adapter found".** Run `$APP ifaces`. If it's empty, check `nmcli device`.

**"Connection activation failed".** The adapter may not support hotspot mode, or it's busy.
Try `nmcli device disconnect wlp2s0` first.

**The installer can't download `qrencode`.** An apt proxy may be blocking downloads. Remove
the proxy setting, then run `sudo apt-get update` and install again.

## Tests

```bash
bash tests/run-all.sh
```

The tests run in a temporary home folder with stub `nmcli`, `ip`, and `qrencode`, so they
never start a real hotspot. The menu tests need `node`.

## Uninstall

```bash
./uninstall.sh
```

This stops the hotspot and removes the applet. Settings stay in `~/.config/hotspot-manager`
until you delete that folder.
