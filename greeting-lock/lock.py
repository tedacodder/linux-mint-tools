#!/usr/bin/env python3
"""Greeting Card lock screen for Linux Mint (Cinnamon, X11).

    python3 lock.py          lock the screen (grabs keyboard and mouse)
    python3 lock.py --test   show the window without grabbing input; closes after 60 seconds

Exit status 0 means the correct password was entered. Any other exit means the
locker crashed, so lock.sh starts it again.
"""
import datetime
import io
import json
import math
import os
import pwd
import random
import subprocess
import sys
import time
import threading
import urllib.parse

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import Gdk, GdkPixbuf, GLib, Gtk

import PAM

import nexus
import nexus_game

try:
    from PIL import Image, ImageFilter
except ImportError:
    Image = None

TEST_MODE = "--test" in sys.argv
TEST_SECONDS = 60

# Rate limiting: after LOCKOUT_AFTER failed attempts, wait LOCKOUT_SECONDS between tries.
LOCKOUT_AFTER = 3
LOCKOUT_SECONDS = [5, 15, 60]
ATTEMPTS_FILE = os.path.join(os.path.expanduser("~"), ".cache", "greeting-lock", "attempts.json")
STAR_COUNT = 80     # set to 0 to turn the starfield off
FRAME_MS = 100       # animation runs 20 frames per second

# Shown in the greeting. None uses the first word of your full name from your account.
DISPLAY_NAME = None

BG_FALLBACK = (0.09, 0.10, 0.13)

# Aurora clouds: (x, y, radius, color, phase). Positions and sizes are fractions of the screen.
BLOBS = [
    (0.20, 0.30, 0.34, (0.25, 0.90, 0.50), 0.0),
    (0.82, 0.68, 0.30, (0.10, 0.70, 0.40), 2.1),
    (0.55, 0.12, 0.26, (0.55, 0.95, 0.35), 4.2),
]

CSS = """
.clock {
  color: #f2f4f8;
  font-size: 120px;
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
}
.date {
  color: rgba(242, 244, 248, 0.85);
  font-size: 26px;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
}
.greeting {
  color: #f2f4f8;
  font-size: 20px;
  font-weight: 600;
}
.card {
  background-color: rgba(20, 22, 28, 0.6);
  border-radius: 22px;
  border: 1px solid rgba(242, 244, 248, 0.12);
  padding: 24px 28px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.card-error {
  border: 1px solid rgba(255, 107, 107, 0.9);
  box-shadow: 0 0 30px rgba(255, 107, 107, 0.45), 0 12px 40px rgba(0, 0, 0, 0.5);
}
.avatar {
  background-image: linear-gradient(135deg, #7dff9b, #1fbf6a);
  color: #0b1020;
  border-radius: 50%;
  font-size: 18px;
  font-weight: 700;
}
.field {
  background-color: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(242, 244, 248, 0.35);
  border-radius: 14px;
  padding: 4px 8px;
  min-height: 48px;
}
.field-glow {
  border: 1px solid rgba(96, 245, 140, 0.95);
  box-shadow: 0 0 18px rgba(96, 245, 140, 0.45);
}
.field entry {
  background-color: transparent;
  background-image: none;
  border: none;
  box-shadow: none;
  color: #f2f4f8;
  font-size: 18px;
}
.field button {
  background-color: transparent;
  background-image: none;
  border: none;
  box-shadow: none;
  color: #f2f4f8;
  min-width: 36px;
  min-height: 36px;
  padding: 0;
}
.subtitle {
  color: rgba(242, 244, 248, 0.6);
  font-size: 14px;
}
.subtitle-error {
  color: #ff6b6b;
  font-size: 14px;
  font-weight: 600;
}
.hint {
  color: rgba(242, 244, 248, 0.55);
  font-size: 14px;
}
"""


def check_password(user, password):
    """Check the password through PAM, using the same calls as the working pamtest example."""
    if not password:
        return False

    def conversation(auth, query_list, user_data):
        replies = []
        for _prompt, kind in query_list:
            if kind in (PAM.PAM_PROMPT_ECHO_OFF, PAM.PAM_PROMPT_ECHO_ON):
                replies.append((password, 0))
            else:
                replies.append(("", 0))
        return replies

    try:
        auth = PAM.pam()
        auth.start("passwd")
        auth.set_item(PAM.PAM_USER, user)
        auth.set_item(PAM.PAM_CONV, conversation)
        auth.authenticate()
        auth.acct_mgmt()
        return True
    except PAM.error:
        return False
    except Exception as exc:
        print(f"PAM check failed: {exc}", file=sys.stderr)
        return False


def load_attempts():
    """Return (failed_count, locked_until_timestamp). Missing or bad data means no lockout."""
    try:
        with open(ATTEMPTS_FILE) as f:
            data = json.load(f)
        return int(data.get("failed", 0)), float(data.get("locked_until", 0.0))
    except (OSError, ValueError, TypeError, AttributeError):
        return 0, 0.0


def save_attempts(failed, locked_until):
    try:
        os.makedirs(os.path.dirname(ATTEMPTS_FILE), mode=0o700, exist_ok=True)
        tmp = ATTEMPTS_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"failed": failed, "locked_until": locked_until}, f)
        os.replace(tmp, ATTEMPTS_FILE)
    except OSError as exc:
        print(f"Could not save attempt counter: {exc}", file=sys.stderr)


def lockout_seconds(failed):
    """Seconds to wait after this many failures. Zero until LOCKOUT_AFTER is reached."""
    if failed < LOCKOUT_AFTER:
        return 0
    index = min(failed - LOCKOUT_AFTER, len(LOCKOUT_SECONDS) - 1)
    return LOCKOUT_SECONDS[index]


def display_name():
    if DISPLAY_NAME:
        return DISPLAY_NAME
    entry = pwd.getpwuid(os.getuid())
    full = entry.pw_gecos.split(",")[0].strip()
    return (full.split() or [entry.pw_name])[0]


def greeting():
    hour = datetime.datetime.now().hour
    if hour < 12:
        return "Good morning"
    if hour < 18:
        return "Good afternoon"
    return "Good evening"


def ease_out(t):
    return 1 - (1 - t) ** 3


def wallpaper_path():
    try:
        uri = subprocess.check_output(
            ["gsettings", "get", "org.cinnamon.desktop.background", "picture-uri"],
            text=True,
        ).strip().strip("'")
    except (OSError, subprocess.CalledProcessError):
        return None
    if uri.startswith("file://"):
        return urllib.parse.unquote(uri[len("file://"):])
    return None


def blurred_wallpaper(width, height):
    """Return a blurred copy of the wallpaper, or None to use the plain background color."""
    path = wallpaper_path()
    if not path or Image is None:
        return None
    try:
        img = Image.open(path).convert("RGB")
    except Exception:
        # Dynamic (.xml) wallpapers and unreadable files fall back to a plain color.
        return None
    small = img.resize((max(1, width // 4), max(1, height // 4)), Image.BILINEAR)
    small = small.filter(ImageFilter.GaussianBlur(radius=6))
    img = small.resize((width, height), Image.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    loader = GdkPixbuf.PixbufLoader.new_with_type("png")
    loader.write(buf.getvalue())
    loader.close()
    return loader.get_pixbuf()


def draw_glow(cr, cx, cy, radius, rgb, strength):
    """Soft glow from stacked translucent circles. Brighter toward the center."""
    for i in range(6):
        r = radius * (1 - i / 6.0)
        cr.arc(cx, cy, r, 0, 2 * math.pi)
        cr.set_source_rgba(rgb[0], rgb[1], rgb[2], strength)
        cr.fill()


def styled(text, css_class, xalign=0.5):
    label = Gtk.Label(label=text)
    label.get_style_context().add_class(css_class)
    label.set_xalign(xalign)
    label.set_halign(Gtk.Align.CENTER)
    return label


def make_icon(icon_name, fallback_text):
    """Use a theme icon if this system has it, otherwise a plain text label."""
    if Gtk.IconTheme.get_default().has_icon(icon_name):
        return Gtk.Image.new_from_icon_name(icon_name, Gtk.IconSize.BUTTON)
    return Gtk.Label(label=fallback_text)


def apply_css():
    provider = Gtk.CssProvider()
    provider.load_from_data((CSS + nexus.CSS).encode())
    Gtk.StyleContext.add_provider_for_screen(
        Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    )


class GreetingLock(Gtk.Window):
    def __init__(self):
        super().__init__(title="Locked")
        self.user = pwd.getpwuid(os.getuid()).pw_name
        self.name = display_name()
        self.failed, self.locked_until = load_attempts()
        self.checking = False
        self.check_dots = 0
        self.typing = False
        self.world_t = 0.0        # animation clock, speeds up on unlock
        self.warp = 1.0           # 1 = normal, higher = stars stretch into streaks
        self.par_x = self.par_y = 0.0
        self.target_x = self.target_y = 0.0
        self._bg = None
        self._bg_scaled = None
        self._bg_size = None
        # Each star: x, y, radius, twinkle speed, twinkle phase, drift speed
        self.stars = [
            (random.random(), random.random(), random.uniform(0.6, 1.8),
             random.uniform(0.4, 1.6), random.uniform(0, 2 * math.pi), random.uniform(0.004, 0.02))
            for _ in range(STAR_COUNT)
        ]

        self.set_decorated(False)
        self.set_keep_above(True)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        self.set_default_size(1280, 800)
        self.add_events(Gdk.EventMask.POINTER_MOTION_MASK)

        geo = Gdk.Display.get_default().get_monitor(0).get_geometry()
        self._bg = blurred_wallpaper(geo.width, geo.height)

        self.connect("delete-event", self.on_delete)
        self.connect("destroy", Gtk.main_quit)
        self.connect("key-press-event", self.on_key)
        self.connect("button-press-event", self.on_click)
        self.connect("motion-notify-event", self.on_motion)

        self.background = Gtk.DrawingArea()
        self.background.connect("draw", self.draw_background)

        self.clock_label = Gtk.Label()
        self.clock_label.get_style_context().add_class("clock")
        self.clock_label.set_halign(Gtk.Align.CENTER)
        self.date_label = styled("", "date")
        self.greeting_label = styled("", "greeting")
        self.greeting_label.set_margin_top(10)

        # Username header. Inline Pango styling, so it doesn't depend on the stylesheet.
        header_label = Gtk.Label()
        header_label.set_markup(
            '<span foreground="#f2f4f8" weight="bold" size="x-large">\u25b8  '
            + GLib.markup_escape_text(self.user)
            + "</span>"
        )
        header_label.set_xalign(0)
        header_label.set_hexpand(True)

        # Avatar: a pulsing glow behind a round label with the first letter of your name.
        self.glow = Gtk.DrawingArea()
        self.glow.set_size_request(60, 60)
        self.glow.connect("draw", self.draw_avatar_glow)
        avatar = Gtk.Label(label=self.user[:1].upper())
        avatar.get_style_context().add_class("avatar")
        avatar.set_size_request(40, 40)
        avatar.set_halign(Gtk.Align.CENTER)
        avatar.set_valign(Gtk.Align.CENTER)
        avatar_stack = Gtk.Overlay()
        avatar_stack.set_size_request(60, 60)
        avatar_stack.set_valign(Gtk.Align.CENTER)
        avatar_stack.add(self.glow)
        avatar_stack.add_overlay(avatar)

        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        header.pack_start(header_label, True, True, 0)
        header.pack_end(avatar_stack, False, False, 0)

        self.entry = Gtk.Entry()
        self.entry.set_has_frame(False)
        self.entry.set_visibility(False)
        self.entry.set_invisible_char("\u25cf")
        self.entry.set_input_purpose(Gtk.InputPurpose.PASSWORD)
        self.entry.set_hexpand(True)
        self.entry.connect("activate", self.on_submit)
        self.entry.connect("changed", self.on_changed)

        self.eye = Gtk.ToggleButton()
        self.eye.add(make_icon("view-reveal-symbolic", "Show"))
        self.eye.set_tooltip_text("Show password")
        self.eye.set_can_focus(False)
        self.eye.connect("toggled", self.on_eye_toggled)

        self.arrow = Gtk.Button()
        self.arrow.add(make_icon("go-next-symbolic", "\u203a"))
        self.arrow.set_tooltip_text("Unlock")
        self.arrow.set_can_focus(False)
        self.arrow.connect("clicked", self.on_submit)

        self.field = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        self.field.get_style_context().add_class("field")
        self.field.set_size_request(400, -1)
        self.field.set_halign(Gtk.Align.CENTER)
        self.field.pack_start(self.eye, False, False, 0)
        self.field.pack_start(self.entry, True, True, 0)
        self.field.pack_start(self.arrow, False, False, 0)

        self.subtitle = styled("", "subtitle")

        self.card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
        self.card.get_style_context().add_class("card")
        self.card.set_halign(Gtk.Align.CENTER)
        self.card.set_margin_top(28)
        self.card.pack_start(header, False, False, 0)
        self.card.pack_start(self.field, False, False, 0)
        self.card.pack_start(self.subtitle, False, False, 0)

        self.column = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        self.column.set_halign(Gtk.Align.CENTER)
        self.column.set_valign(Gtk.Align.CENTER)
        self.column.set_margin_top(120)
        self.column.pack_start(self.clock_label, False, False, 0)
        self.column.pack_start(self.date_label, False, False, 0)
        self.column.pack_start(self.greeting_label, False, False, 0)
        self.column.pack_start(self.card, False, False, 0)
        self.column.set_opacity(0.0)

        self.hint = styled("", "hint")
        self.hint.set_valign(Gtk.Align.END)
        self.hint.set_margin_bottom(36)

        overlay = Gtk.Overlay()
        overlay.add(self.background)
        self.hud = nexus.build_hud(self)
        overlay.add_overlay(self.hud)
        overlay.add_overlay(self.column)
        overlay.add_overlay(self.hint)
        self.add(overlay)

        self.update_clock()
        self.refresh_subtitle()
        GLib.timeout_add(1000, self.update_clock)
        GLib.timeout_add(FRAME_MS, self.tick)

    # ---------- animation helpers ----------

    def animate(self, duration_ms, on_frame, on_done=None):
        """Call on_frame(t) from 0 to 1 over duration_ms, then on_done()."""
        start = GLib.get_monotonic_time()

        def tick():
            t = min(1.0, (GLib.get_monotonic_time() - start) / (duration_ms * 1000.0))
            on_frame(t)
            if t >= 1.0:
                if on_done:
                    on_done()
                return False
            return True

        GLib.timeout_add(16, tick)

    def play_entrance(self):
        def frame(t):
            e = ease_out(t)
            self.column.set_opacity(e)
            self.column.set_margin_top(int(120 - 60 * e))

        self.animate(700, frame)

    def type_greeting(self):
        """Type the greeting out one letter at a time."""
        full = f"{greeting()}, {self.name}"
        self.typing = True
        count = [0]

        def step():
            count[0] += 1
            self.greeting_label.set_text(full[:count[0]])
            if count[0] >= len(full):
                self.typing = False
                return False
            return True

        GLib.timeout_add(45, step)

    def tick(self):
        """Runs every frame: advances the animation clock and eases the parallax."""
        self.world_t += (FRAME_MS / 1000.0) * self.warp
        self.par_x += (self.target_x - self.par_x) * 0.08
        self.par_y += (self.target_y - self.par_y) * 0.08
        self.background.queue_draw()
        self.glow.queue_draw()
        return True

    def update_clock(self):
        now = datetime.datetime.now()
        colon = '<span alpha="35%">:</span>' if now.second % 2 else ":"
        self.clock_label.set_markup(now.strftime("%H") + colon + now.strftime("%M"))
        self.date_label.set_text(now.strftime("%A, %-d %B"))
        if not self.typing:
            self.greeting_label.set_text(f"{greeting()}, {self.name}")
        keymap = Gdk.Keymap.get_for_display(Gdk.Display.get_default())
        caps_on = keymap.get_caps_lock_state()
        self.hint.set_text("CAPS LOCK ON" if caps_on else "NEXUS SYSTEM // ACCESS RESTRICTED  \u00b7  LOCKED \u00b7 ESC CLEARS INPUT")
        return True

    # ---------- visual feedback ----------

    def refresh_subtitle(self):
        if self.failed == 0:
            text = "AWAITING AUTHENTICATION..."
        elif self.failed == 1:
            text = "ACCESS DENIED // INVALID CREDENTIALS"
        else:
            text = "ACCESS DENIED // INVALID CREDENTIALS"
        self.subtitle.set_text(text)
        ctx = self.subtitle.get_style_context()
        if self.failed:
            ctx.remove_class("subtitle")
            ctx.add_class("subtitle-error")
        else:
            ctx.remove_class("subtitle-error")
            ctx.add_class("subtitle")

    def set_checking(self, on):
        self.checking = on
        if on:
            self.check_dots = 0
            GLib.timeout_add(260, self.tick_checking)
        else:
            self.refresh_subtitle()

    def tick_checking(self):
        if not self.checking:
            return False
        self.subtitle.set_text("VERIFYING CREDENTIALS" + "." * (self.check_dots % 4))
        self.check_dots += 1
        return True

    def shake(self):
        """Move the field left and right briefly after a wrong password."""
        steps = iter([-12, 12, -9, 9, -5, 5, 0])

        def step():
            offset = next(steps, None)
            if offset is None:
                self.field.set_margin_start(0)
                self.field.set_margin_end(0)
                return False
            self.field.set_margin_start(max(offset, 0))
            self.field.set_margin_end(max(-offset, 0))
            return True

        GLib.timeout_add(35, step)

    def flash_card(self):
        self.card.get_style_context().add_class("card-error")
        GLib.timeout_add(600, self.end_flash)

    def end_flash(self):
        self.card.get_style_context().remove_class("card-error")
        return False

    def on_changed(self, entry):
        """Light up the field briefly each time a key changes the text."""
        self.field.get_style_context().add_class("field-glow")
        GLib.timeout_add(220, self.end_field_glow)

    def end_field_glow(self):
        self.field.get_style_context().remove_class("field-glow")
        return False

    # ---------- drawing ----------

    def draw_background(self, widget, cr):
        w = widget.get_allocated_width()
        h = widget.get_allocated_height()
        if w <= 0 or h <= 0:
            return True
        if self._bg is not None and nexus.SHOW_WALLPAPER:
            if self._bg_size != (w, h):
                self._bg_scaled = self._bg.scale_simple(w, h, GdkPixbuf.InterpType.BILINEAR)
                self._bg_size = (w, h)
            Gdk.cairo_set_source_pixbuf(cr, self._bg_scaled, 0, 0)
        else:
            cr.set_source_rgb(*BG_FALLBACK)
        cr.paint()
        nexus.draw_matrix(self, cr, w, h)
        nexus_game.draw(self, cr, w, h)
        return True

    def draw_stars(self, cr, w, h):
        for x0, y0, radius, speed, phase, drift in self.stars:
            x = ((x0 + self.world_t * drift + self.par_x * 0.02) % 1.0) * w
            y = ((y0 + self.par_y * 0.02) % 1.0) * h
            alpha = 0.25 + 0.55 * (0.5 + 0.5 * math.sin(self.world_t * speed + phase))
            if self.warp > 1.05:
                stretch = min(260.0, (self.warp - 1.0) * 40.0)
                cr.set_line_width(radius * 1.6)
                cr.move_to(x - stretch, y)
                cr.line_to(x, y)
                cr.set_source_rgba(1, 1, 1, alpha)
                cr.stroke()
            else:
                cr.arc(x, y, radius, 0, 2 * math.pi)
                cr.set_source_rgba(1, 1, 1, alpha)
                cr.fill()

    def draw_avatar_glow(self, widget, cr):
        w = widget.get_allocated_width()
        h = widget.get_allocated_height()
        pulse = 0.5 + 0.5 * math.sin(self.world_t * 2.0)
        base = min(w, h) / 2.0 * 0.8
        for i in range(6):
            r = base + pulse * 3 + i * 2.2
            alpha = (0.07 + 0.05 * pulse) * (1 - i / 6.0)
            cr.arc(w / 2.0, h / 2.0, r, 0, 2 * math.pi)
            cr.set_source_rgba(0.35, 0.95, 0.55, alpha)
            cr.fill()
        return True

    # ---------- input ----------

    def on_motion(self, widget, event):
        w = max(1, self.get_allocated_width())
        h = max(1, self.get_allocated_height())
        self.target_x = event.x / w - 0.5
        self.target_y = event.y / h - 0.5
        return False

    def on_eye_toggled(self, button):
        self.entry.set_visibility(button.get_active())

    def on_submit(self, _widget=None):
        if self.checking:
            return
        if time.time() < self.locked_until:
            self.show_lockout()
            if not getattr(self, "_lock_timer", False):
                self._lock_timer = True
                GLib.timeout_add(1000, self.lockout_tick)
            return
        password = self.entry.get_text()
        self.entry.set_text("")
        if not password:
            return
        self.field.set_sensitive(False)
        self.set_checking(True)
        threading.Thread(target=self._verify, args=(password,), daemon=True).start()

    def _verify(self, password):
        # Runs off the GTK thread so the window keeps animating during the check.
        ok = check_password(self.user, password)
        GLib.idle_add(self.on_verified, ok)

    def on_verified(self, ok):
        self.set_checking(False)
        if ok:
            save_attempts(0, 0.0)
            self.subtitle.set_text("IDENTITY VERIFIED // ACCESS GRANTED")
            self.unlock()
            return False
        self.failed += 1
        wait = lockout_seconds(self.failed)
        self.locked_until = time.time() + wait
        save_attempts(self.failed, self.locked_until)
        self.refresh_subtitle()
        self.shake()
        self.flash_card()
        GLib.timeout_add(1000, self.reenable)
        if wait:
            self.show_lockout()
            if not getattr(self, "_lock_timer", False):
                self._lock_timer = True
                GLib.timeout_add(1000, self.lockout_tick)
        return False

    def show_lockout(self):
        remaining = self.locked_until - time.time()
        if remaining <= 0:
            self.refresh_subtitle()
            return False
        self.subtitle.set_text(f"LOCKED OUT // RETRY IN {int(remaining) + 1}S")
        return True

    def lockout_tick(self):
        keep_going = self.show_lockout()
        if not keep_going:
            self._lock_timer = False
        return keep_going

    def reenable(self):
        self.field.set_sensitive(True)
        self.entry.grab_focus()
        return False

    def unlock(self):
        if not TEST_MODE:
            Gdk.Display.get_default().get_default_seat().ungrab()

        def frame(t):
            self.warp = 1.0 + 7.0 * ease_out(t)
            self.column.set_opacity(1 - ease_out(t))

        self.animate(450, frame, Gtk.main_quit)

    def grab_input(self):
        if TEST_MODE:
            return False
        seat = Gdk.Display.get_default().get_default_seat()
        status = seat.grab(self.get_window(), Gdk.SeatCapabilities.ALL, False, None, None, None, None)
        if status == Gdk.GrabStatus.SUCCESS:
            self.entry.grab_focus()
            return False
        return True  # keep trying until the grab succeeds

    def on_key(self, widget, event):
        if nexus_game.game_key(self, event):
            return True
        if event.keyval == Gdk.KEY_Escape:
            self.entry.set_text("")
            return True
        if TEST_MODE and event.keyval == Gdk.KEY_q and event.state & Gdk.ModifierType.CONTROL_MASK:
            Gtk.main_quit()
            return True
        if not self.entry.has_focus():
            self.entry.grab_focus()
        return False

    def on_click(self, widget, event):
        self.entry.grab_focus()
        return False

    def on_delete(self, widget, event):
        # Blocks window close (including Alt+F4) while locked. Test mode can be closed normally.
        return not TEST_MODE


def close_test():
    print("TEST MODE: closing.", file=sys.stderr)
    Gtk.main_quit()
    return False


def main():
    apply_css()
    win = GreetingLock()
    win.fullscreen()
    win.show_all()
    win.play_entrance()
    win.type_greeting()
    if TEST_MODE:
        print("TEST MODE: input is not grabbed. Ctrl+Q or wait 60 seconds to close.", file=sys.stderr)
        GLib.timeout_add_seconds(TEST_SECONDS, close_test)
    else:
        GLib.idle_add(win.grab_input)
    Gtk.main()
    sys.exit(0)


if __name__ == "__main__":
    main()
