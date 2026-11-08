# Hotspot Manager for Linux Mint (Cinnamon)

Start and stop a Wi-Fi hotspot from the panel. It runs the same command you
type by hand:

    nmcli device wifi hotspot ifname wlp2s0 ssid cody password "testpass1"

## What it does

- **Switch** the hotspot on or off from the panel.
- **Live status:** SSID, address, adapter, uptime, and the devices connected.
- **Copy** the SSID or password, or reveal the password for 8 seconds.
- **Settings:** change the SSID or password, or generate a 12-character password
  with no look-alike characters. If the hotspot is on, it restarts with the change.
- **Safety:** refuses an SSID over 32 characters or a password under 8 characters,
  never starts the hotspot on boot, and reports errors from NetworkManager.

- **Device names:** each connected device is shown with the name it sent to the
  hotspot (for example `Galaxy-S24`). Devices that send no name show as `unknown device`.
  Some phones use a random address and a different name for each network; those may
  show as unknown.
- **Join and leave alerts:** a notification when a device connects or disconnects.
- **Show QR to join:** a QR code with the name and password. Scan it with a phone camera.
  The image holds your password, so it is kept private in `~/.config/hotspot-manager/qr/`.
- **Auto-off:** turn the hotspot off after 30, 60, or 120 minutes. This timer runs only
  while Cinnamon is running.

## Install

    chmod +x install.sh uninstall.sh
    ./install.sh

Restart Cinnamon (Alt+F2, type `r`, Enter), then add **Hotspot Manager** from the
panel's Applets menu.

## Command line

    APP=~/.local/share/cinnamon/applets/hotspot-manager@tedacodder-linux/hotspot-manager.sh
    $APP status
    $APP set-ssid cody
    $APP set-password testpass1
    $APP start
    $APP stop
    $APP show-password

Settings live in `~/.config/hotspot-manager/config.json`, readable only by you.
The password is stored there and also by NetworkManager for the hotspot.

## Notes

- Many Wi-Fi cards cannot be a hotspot and a Wi-Fi client at the same time. If
  you are connected to Wi-Fi, starting the hotspot may disconnect that connection.
- The first start may ask for permission through a system dialog. That is
  NetworkManager's policy, not this app.

## Uninstall

    ./uninstall.sh
