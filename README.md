# Linux Mint tools

Desktop tools for Linux Mint with Cinnamon: a Wi-Fi hotspot manager, a one-switch
proxy, and a lock screen.

| Tool | What it does |
| --- | --- |
| [hotspot-manager](hotspot-manager/) | Runs a Wi-Fi hotspot from the panel, shows connected devices, and makes a QR code to join |
| [proxy-manager](proxy-manager/) | Routes your shell, Git, npm, pip, browsers and more through a local proxy |
| [greeting-lock](greeting-lock/) | A lock screen that checks your real password, with a Matrix background and a Snake game |

## Quick start

Each tool is a Cinnamon applet with its own installer:

```bash
git clone https://github.com/tedacodder/linux-mint-tools.git
cd linux-mint-tools/hotspot-manager
./install.sh
```

Restart Cinnamon (Alt+F2, type `r`, press Enter), then add the applet from the
panel's Applets menu.

## Requirements

- Linux Mint 22 with Cinnamon on X11. Wayland is not tested.
- Each tool lists its own packages in its README.

> [!NOTE]
> Each folder has its own README with installation, configuration, and troubleshooting.
