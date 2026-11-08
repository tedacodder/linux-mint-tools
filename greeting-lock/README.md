# Greeting Lock

A lock screen for Linux Mint (Cinnamon, X11). It unlocks with your normal login
password, checked through PAM, and shows a Matrix-style background, a clock, and a
small game.

> **Personal project, not hardened.** Read "Security" before you rely on it.

## Features

- **Real password check:** the password is checked through PAM, the same way the
  login does. Nothing is stored or compared locally.
- **Matrix background:** falling glyphs, algorithm expressions, scanlines, and a
  corner HUD with live CPU, memory, uptime, and network status.
- **Lockout:** after 3 wrong passwords the screen waits 5 seconds before the next try,
  then 15, then 60. The count survives restarts.
- **Snake game:** press **Ctrl+G** on the lock screen. Power-ups, combos, levels, and a
  saved best score.
- **Low-power mode:** on by default, to keep CPU use low on older laptops.
- **Test mode:** `--test` shows the window without locking, so you can check the look.

## Requirements

Linux Mint 22 with Cinnamon on X11. Install the packages:

    sudo apt install python3-gi gir1.2-gtk-3.0 python3-pam python3-pil xss-lock

`python3-pam` provides the `PAM` module that the lock uses.

## Usage

    ./lock.sh --test      # open the window without locking, to check the look
    ./lock.sh             # lock the screen

Press **Ctrl+Q** or wait 60 seconds to close test mode.

To lock on suspend or idle, start `xss-lock` at login with the full path to `lock.sh`:

    xss-lock -- /full/path/to/greeting-lock/lock.sh

For a keyboard shortcut, bind the same command in Settings > Keyboard.

## Controls

| Key | Action |
|---|---|
| Type, Enter | enter the password and unlock |
| Esc | clear the password field |
| Ctrl+G | start Snake (on the lock screen) |
| Arrow keys or W A S D | steer Snake |
| P | pause Snake |
| Space | restart Snake after a crash |
| Esc (in Snake) | leave the game and return to the login |

## Settings

Edit the constants at the top of `lock.py`:

- `DISPLAY_NAME`: the name in the greeting. `None` uses your account's full name.
- `LOCKOUT_AFTER`, `LOCKOUT_SECONDS`: how many failures trigger a delay, and how long.
- `STAR_COUNT`, `FRAME_MS`: background star count and animation speed.

Edit `nexus.py` for the visuals:

- `LOW_POWER`: `True` turns off blur, glow, and scanlines. Set `False` for the full look.
- `RAIN_SCALE`: rain density (lower is lighter).
- `SHOW_WALLPAPER`: show your wallpaper behind the Matrix.

## How it works

| File | Purpose |
|---|---|
| `lock.py` | the window, the PAM check, lockout, and the unlock path |
| `lock.sh` | runs the lock and restarts it if it crashes. It stops only after a correct password. |
| `nexus.py` | the Matrix background, the HUD, and the system readouts |
| `nexus_game.py` | the Snake game |
| `measure.sh` | measures the lock's CPU use (10 seconds idle, then 10 seconds playing) |

The lock is a single process. `lock.sh` restarts it if it stops, so killing only
`lock.py` does not unlock the screen.

## Security

- The password check is done by PAM, against your own account.
- The lockout counter is a file in `~/.cache/greeting-lock/`.
- This is not a hardened lock screen. Someone with physical access can switch to a text
  console (Ctrl+Alt+F3) and stop the process. Do not rely on it where that matters.
- The Snake high score is saved in `~/.cache/greeting-lock/snake-best.json`.

## Stopping a stuck lock

Switch to a text console with **Ctrl+Alt+F3**, log in, and stop the wrapper first, then
the locker:

    pkill -f lock.sh; pkill -f lock.py

Then return to the desktop with Ctrl+Alt+F7 (or F2).

## Known limits

- Only password unlock. Fingerprint is not supported.
- Designed for X11. It has not been tested on Wayland.
- The background uses a fair amount of CPU on older hardware. Low-power mode is the first
  thing to try if the laptop runs warm.
