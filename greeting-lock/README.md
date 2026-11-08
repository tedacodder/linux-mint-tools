# Greeting Lock

A lock screen for Linux Mint (Cinnamon, X11). It checks your real password through PAM,
and has a Matrix background and a Snake game. Part of
[linux-mint-tools](https://github.com/tedacodder/linux-mint-tools).

> [!WARNING]
> This is a personal project and is not hardened. Someone with physical access can switch to
> a text console and stop it. Don't rely on it where that matters. See [Security](#security).

## Features

- A real password check through PAM, against your own account.
- A Matrix background with falling glyphs, a clock, and a corner panel with CPU, memory,
  uptime, and network status.
- **Lockout:** after 3 wrong passwords the screen waits 5 seconds, then 15, then 60. The
  count survives restarts.
- **Snake game** with **Ctrl+G**: power-ups, combos, levels, and a saved best score.
- Low-power mode is on by default, to keep CPU use low on older laptops.
- **Test mode** shows the window without locking, so you can check the look.

## Requirements

Linux Mint 22 with Cinnamon on X11:

```bash
sudo apt install python3-gi gir1.2-gtk-3.0 python3-pam python3-pil xss-lock
```

`xss-lock` is only needed to lock on suspend or idle.

## Usage

```bash
cd linux-mint-tools/greeting-lock
./lock.sh --test       # show the window without locking
./lock.sh              # lock the screen
```

Press **Ctrl+Q**, or wait 60 seconds, to close test mode.

To lock on suspend and idle, start `xss-lock` at login with the full path to `lock.sh`:

```bash
xss-lock -- /full/path/to/linux-mint-tools/greeting-lock/lock.sh
```

For a keyboard shortcut, add the same command under Settings > Keyboard > Application shortcuts.

## Controls

| Key | Action |
|---|---|
| Type, then Enter | enter the password and unlock |
| Esc | clear the password field |
| Ctrl+G | start Snake |
| Arrow keys or W A S D | steer Snake |
| P | pause Snake |
| Space | restart Snake after a crash |
| Esc, during Snake | leave the game and return to the login |

## Configuration

Edit the constants at the top of `lock.py`:

- `DISPLAY_NAME`: the name in the greeting. `None` uses your account's full name.
- `LOCKOUT_AFTER` and `LOCKOUT_SECONDS`: how many failures trigger a delay, and how long.
- `STAR_COUNT` and `FRAME_MS`: background star count and animation speed.

Edit `nexus.py` for the visuals:

- `LOW_POWER`: `True` turns off blur, glow, and scanlines. Set `False` for the full look.
- `RAIN_SCALE`: rain density. Lower is lighter.
- `SHOW_WALLPAPER`: show your wallpaper behind the Matrix.

## How it works

| File | Purpose |
|---|---|
| `lock.py` | the window, the PAM check, lockout, and the unlock path |
| `lock.sh` | runs the lock and restarts it if it crashes; it stops only after a correct password |
| `nexus.py` | the Matrix background, the corner panel, and the system readouts |
| `nexus_game.py` | the Snake game |
| `measure.sh` | measures the lock's CPU use (10 seconds idle, then 10 seconds playing) |

## Security

- The password check is done by PAM against your own account. Nothing is stored or compared
  locally.
- The lockout counter is kept in `~/.cache/greeting-lock/`.
- The Snake high score is saved in `~/.cache/greeting-lock/snake-best.json`.
- `lock.sh` restarts the lock if it stops, so killing only `lock.py` does not unlock the
  screen.

## Stopping a stuck lock

Switch to a text console with **Ctrl+Alt+F3**, log in, then run:

```bash
pkill -f lock.sh; pkill -f lock.py
```

Return to the desktop with **Ctrl+Alt+F7** (or **F2**).

## Performance

Run `./measure.sh` to measure CPU use: 10 seconds idle, then 10 seconds while you play.
Low-power mode is the first thing to try if the laptop runs warm.

## Limitations

- Password unlock only. Fingerprint is not supported.
- Designed for X11. It has not been tested on Wayland.
