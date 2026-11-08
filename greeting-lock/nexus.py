"""NEXUS visuals for the Greeting Lock: Matrix rain, HUD panels, and live system readouts.

This module only draws. It never touches authentication, PAM, or the unlock path.
"""
import math
import os
import random

from gi.repository import GLib, Gtk

SHOW_WALLPAPER = False   # the Matrix replaces the wallpaper; True brings it back (costs CPU)
RAIN_SCALE = 0.6         # below 1.0 means fewer rain columns; about 0.6 is a good low-power setting

BG_COLOR = (0.008, 0.024, 0.016)   # #020604
NEON = (0.0, 1.0, 0.255)           # #00FF41
CYAN = (0.0, 0.898, 1.0)           # #00E5FF
HEAD = (0.910, 1.0, 0.910)         # #E8FFE8

GLYPHS = "01" * 6 + "0123456789ABCDEF" + "<>[]{}#%$/=+"

EXPRESSIONS = [
    "O(log N)", "O(N log N)", "DP[i][j]", "low = mid + 1", "gcd(a, b)", "2^k",
    "10110101", "while (left <= right)", "graph[u].append(v)",
    "dist[v] = min(dist[v], d + w)", "mid = (lo + hi) >> 1", "O(V + E)",
    "segment tree: O(log N)", "a ^ b & mask",
]

TERMINAL_LINES = [
    "[SYSTEM] Initializing interface...",
    "[CORE] Loading visual modules...",
    "[NETWORK] Mapping local interfaces...",
    "[AUTH] Awaiting credentials...",
    "[STATUS] Security environment active...",
    "[RENDER] Matrix layers online...",
]

NODES = [(0.5, 0.5), (0.18, 0.28), (0.82, 0.22), (0.14, 0.76), (0.86, 0.72), (0.5, 0.9)]
EDGES = [(0, 1), (0, 2), (0, 3), (0, 4), (2, 4), (3, 5), (4, 5)]

CSS = """
.card {
  background-color: rgba(2, 8, 5, 0.62);
  border: 1px solid rgba(0, 255, 65, 0.35);
  box-shadow: 0 0 36px rgba(0, 255, 65, 0.18), 0 12px 40px rgba(0, 0, 0, 0.6);
}
.card-error {
  border: 1px solid #ff304f;
  box-shadow: 0 0 30px rgba(255, 48, 79, 0.45), 0 12px 40px rgba(0, 0, 0, 0.6);
}
.field {
  border: 1px solid rgba(0, 255, 65, 0.45);
}
.field-glow {
  border: 1px solid rgba(0, 255, 65, 1.0);
  box-shadow: 0 0 18px rgba(0, 255, 65, 0.5);
}
.clock {
  color: #e8ffe8;
  text-shadow: 0 0 18px rgba(0, 255, 65, 0.45), 0 2px 8px rgba(0, 0, 0, 0.6);
}
.subtitle {
  color: rgba(0, 255, 65, 0.85);
  font-family: "JetBrains Mono", "IBM Plex Mono", monospace;
  font-size: 13px;
}
.subtitle-error {
  color: #ff304f;
  font-family: "JetBrains Mono", "IBM Plex Mono", monospace;
  font-size: 13px;
  font-weight: 700;
}
.hint {
  color: rgba(0, 255, 65, 0.6);
  font-family: "JetBrains Mono", "IBM Plex Mono", monospace;
  font-size: 12px;
}
.hud-panel {
  background-color: rgba(2, 6, 4, 0.55);
  border: 1px solid rgba(0, 255, 65, 0.25);
  border-radius: 10px;
  padding: 12px 14px;
}
.hud-title {
  color: #00ff41;
  font-size: 13px;
  font-weight: 700;
}
.hud-line {
  color: rgba(232, 255, 232, 0.8);
  font-family: "JetBrains Mono", "IBM Plex Mono", monospace;
  font-size: 12px;
}
"""


class Rain:
    """Falling glyph columns. Positions come from the clock, so each frame costs only the drawing."""

    # (font size, column spacing, trail length, brightness, speed factor)
    LAYERS = [
        (11, 22, 4, 0.30, 0.6),
        (15, 34, 7, 0.85, 1.0),
    ]

    def __init__(self):
        self.size = None
        self.layers = []

    def _build(self, w, h):
        self.size = (w, h)
        self.layers = []
        for size, spacing, trail, bright, speed in self.LAYERS:
            spacing = max(8, int(spacing / RAIN_SCALE))
            cols = max(1, w // spacing)
            seeds = [(random.random(), random.uniform(0.7, 1.4)) for _ in range(cols)]
            self.layers.append((size, spacing, trail, bright, speed, seeds))

    def draw(self, cr, w, h, t, px, py, boost):
        if self.size != (w, h):
            self._build(w, h)
        cr.select_font_face("Monospace")
        for size, spacing, trail, bright, speed, seeds in self.layers:
            cr.set_font_size(size)
            span = trail * size
            period = h + span
            for col, (offset, rate) in enumerate(seeds):
                x = col * spacing + px * 30
                head = (offset * period + t * 140.0 * speed * rate * boost) % period - span
                for k in range(trail):
                    y = head - k * size
                    if y < -size or y > h:
                        continue
                    glyph = GLYPHS[int(t * 3 + col * 7 + k * 13) % len(GLYPHS)]
                    if k == 0:
                        cr.set_source_rgba(HEAD[0], HEAD[1], HEAD[2], bright)
                    else:
                        fade = (1 - k / trail) * bright * 0.85
                        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], fade)
                    cr.move_to(x, y)
                    cr.show_text(glyph)


def draw_expressions(cr, w, h, t, px, py):
    """Floating algorithm expressions that fade in and out. They stay clear of the login card."""
    cr.select_font_face("Monospace")
    cr.set_font_size(14)
    for i, expr in enumerate(EXPRESSIONS):
        rnd = random.Random(i * 7919 + 3)
        fx = rnd.random()
        fy = rnd.random()
        cycle = rnd.uniform(9.0, 16.0)
        phase = ((t + i * 1.9) % cycle) / cycle
        alpha = (math.sin(math.pi * phase) ** 2) * 0.45
        if alpha < 0.02:
            continue
        x = fx * w + px * 60
        y = (fy * h + t * 3.0 + py * 40) % h
        if w * 0.26 < x < w * 0.74 and h * 0.10 < y < h * 0.90:
            continue
        color = CYAN if i % 5 == 0 else NEON
        cr.set_source_rgba(color[0], color[1], color[2], alpha)
        cr.move_to(x, y)
        cr.show_text(expr)


def draw_glitch(cr, w, h, t):
    """A rare horizontal glitch band."""
    burst = math.sin(t * 0.9) * math.sin(t * 2.3 + 1.0)
    if burst < 0.96:
        return
    band = (t * 977.0) % h
    cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.22)
    cr.rectangle(0, band, w, 6)
    cr.fill()
    cr.set_source_rgba(CYAN[0], CYAN[1], CYAN[2], 0.14)
    cr.rectangle(10, band + 9, w * 0.6, 2)
    cr.fill()


def draw_scanlines(cr, w, h):
    """CRT scanlines, batched into one fill so they cost one draw call."""
    cr.set_source_rgba(0, 0, 0, 0.22)
    y = 0
    while y < h:
        cr.rectangle(0, y, w, 1)
        y += 3
    cr.fill()


def draw_wave(cr, w, h, warp):
    """The green wave that expands while unlocking."""
    if warp <= 1.05:
        return
    progress = min(1.0, (warp - 1.0) / 7.0)
    cr.set_line_width(3)
    cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.6 * (1.0 - progress))
    cr.arc(w / 2.0, h / 2.0, progress * max(w, h) * 0.75, 0, math.tau)
    cr.stroke()


def draw_matrix(lock, cr, w, h):
    """Draws the whole background for the lock window. Called from GreetingLock.draw_background."""
    t = lock.world_t
    rain = getattr(lock, "_rain", None)
    if rain is None:
        rain = lock._rain = Rain()
    cr.set_source_rgb(*BG_COLOR)
    cr.paint()
    rain.draw(cr, w, h, t, lock.par_x, lock.par_y, lock.warp)
    draw_expressions(cr, w, h, t, lock.par_x, lock.par_y)
    draw_glitch(cr, w, h, t)
    draw_wave(cr, w, h, lock.warp)
    if SCANLINES:
        draw_scanlines(cr, w, h)


# ---------- real system readings (from /proc and /sys, no extra packages) ----------

def read_cpu_times():
    with open("/proc/stat") as f:
        parts = f.readline().split()
    vals = [int(x) for x in parts[1:8]]
    idle = vals[3] + vals[4]
    return idle, sum(vals)


def cpu_percent(prev, cur):
    total = cur[1] - prev[1]
    if total <= 0:
        return 0.0
    return 100.0 * (1.0 - (cur[0] - prev[0]) / total)


def read_mem():
    """Return (percent used, used GiB, total GiB), using MemAvailable like free(1) does."""
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            key, _, value = line.partition(":")
            info[key] = int(value.split()[0])
    total = info["MemTotal"]
    avail = info.get("MemAvailable", info.get("MemFree", 0))
    used = total - avail
    return used * 100.0 / total, used / 1048576.0, total / 1048576.0


def format_uptime():
    with open("/proc/uptime") as f:
        secs = int(float(f.read().split()[0]))
    hours, rem = divmod(secs, 3600)
    return f"{hours}h {rem // 60:02d}m"


def network_summary():
    try:
        names = sorted(os.listdir("/sys/class/net"))
    except OSError:
        return "unknown"
    parts = []
    for name in names:
        if not name.startswith(("en", "wl")):
            continue
        try:
            with open(f"/sys/class/net/{name}/operstate") as f:
                state = f.read().strip()
        except OSError:
            state = "unknown"
        parts.append(f"{name} {state}")
    return ", ".join(parts) if parts else "no physical link"


# ---------- HUD widgets ----------

def _label(text, css_class):
    lab = Gtk.Label(label=text)
    lab.get_style_context().add_class(css_class)
    lab.set_xalign(0.0)
    lab.set_halign(Gtk.Align.START)
    return lab


def _panel(title):
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
    box.get_style_context().add_class("hud-panel")
    box.pack_start(_label(title, "hud-title"), False, False, 0)
    return box


def _draw_network(widget, cr):
    w = widget.get_allocated_width()
    h = widget.get_allocated_height()
    t = GLib.get_monotonic_time() / 1000000.0
    pts = [(x * w, y * h) for x, y in NODES]
    cx, cy = pts[0]
    radius = min(w, h) * 0.42

    cr.set_line_width(1)
    for ring in (0.4, 0.7, 1.0):
        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.12)
        cr.arc(cx, cy, radius * ring, 0, math.tau)
        cr.stroke()

    for a, b in EDGES:
        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.30)
        cr.move_to(pts[a][0], pts[a][1])
        cr.line_to(pts[b][0], pts[b][1])
        cr.stroke()

    cr.select_font_face("Monospace")
    cr.set_font_size(9)
    for j, (a, b) in enumerate(EDGES):
        p = (t * 0.35 + j * 0.17) % 1.0
        x = pts[a][0] + (pts[b][0] - pts[a][0]) * p
        y = pts[a][1] + (pts[b][1] - pts[a][1]) * p
        cr.set_source_rgba(CYAN[0], CYAN[1], CYAN[2], 0.9)
        cr.arc(x, y, 2, 0, math.tau)
        cr.fill()

    angle = (t * 1.1) % math.tau
    for i in range(14):
        a = angle - i * 0.06
        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.30 * (1 - i / 14.0))
        cr.move_to(cx, cy)
        cr.line_to(cx + radius * math.cos(a), cy + radius * math.sin(a))
        cr.stroke()

    for i, (x, y) in enumerate(pts):
        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.95)
        cr.arc(x, y, 3, 0, math.tau)
        cr.fill()
        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.6)
        cr.move_to(x + 6, y - 4)
        cr.show_text(f"0x{(i * 37 + 11) % 256:02X}")
    return True


def build_hud(lock):
    """Build the four corner panels. Returns one widget that covers the whole window."""
    grid = Gtk.Grid()
    grid.set_column_homogeneous(True)
    grid.set_row_homogeneous(True)
    grid.set_hexpand(True)
    grid.set_vexpand(True)
    grid.set_margin_start(28)
    grid.set_margin_end(28)
    grid.set_margin_top(24)
    grid.set_margin_bottom(24)

    # Top left: decorative status, but only facts that are true.
    status = _panel("SYSTEM STATUS")
    for line in ("NEXUS ONLINE", "PAM AUTH: ACTIVE", "SESSION LOCKED", "RATE LIMIT: ON", "CTRL+G  SNAKE"):
        status.pack_start(_label(line, "hud-line"), False, False, 0)
    status.set_halign(Gtk.Align.START)
    status.set_valign(Gtk.Align.START)

    # Top right: real system telemetry.
    monitor = _panel("SYSTEM MONITOR")
    cpu_label = _label("CPU   --", "hud-line")
    ram_label = _label("RAM   --", "hud-line")
    up_label = _label("UPTIME  --", "hud-line")
    net_label = _label("NET   --", "hud-line")
    for lab in (cpu_label, ram_label, up_label, net_label):
        monitor.pack_start(lab, False, False, 0)
    monitor.set_halign(Gtk.Align.END)
    monitor.set_valign(Gtk.Align.START)

    prev = {"cpu": None}

    def tick_monitor():
        try:
            cur = read_cpu_times()
            if prev["cpu"] is None:
                prev["cpu"] = cur
            cpu = cpu_percent(prev["cpu"], cur)
            prev["cpu"] = cur
            pct, used, total = read_mem()
            cpu_label.set_text(f"CPU   {cpu:5.1f}%")
            ram_label.set_text(f"RAM   {pct:5.1f}%  {used:.1f} / {total:.1f} GiB")
            up_label.set_text(f"UPTIME  {format_uptime()}")
            net_label.set_text(f"NET   {network_summary()}")
        except (OSError, ValueError, KeyError, ZeroDivisionError):
            cpu_label.set_text("CPU   unavailable")
        return True

    tick_monitor()
    GLib.timeout_add(1000, tick_monitor)

    # Bottom left: decorative terminal output, labeled as simulated.
    terminal = _panel("TERMINAL OUTPUT  (SIMULATED)")
    term_labels = [_label("", "hud-line") for _ in range(5)]
    for lab in term_labels:
        terminal.pack_start(lab, False, False, 0)
    terminal.set_halign(Gtk.Align.START)
    terminal.set_valign(Gtk.Align.END)
    shown = []

    def tick_terminal():
        shown.append(TERMINAL_LINES[len(shown) % len(TERMINAL_LINES)])
        del shown[:-5]
        for i, lab in enumerate(term_labels):
            text = shown[i] if i < len(shown) else ""
            lab.set_text(text + ("_" if i == len(shown) - 1 else ""))
        return True

    tick_terminal()
    GLib.timeout_add(900, tick_terminal)

    # Bottom right: animated network radar.
    network = _panel("DIGITAL NETWORK")
    radar = Gtk.DrawingArea()
    radar.set_size_request(240, 150)
    radar.connect("draw", _draw_network)
    network.pack_start(radar, False, False, 0)
    network.set_halign(Gtk.Align.END)
    network.set_valign(Gtk.Align.END)

    def tick_radar():
        radar.queue_draw()
        return True

    GLib.timeout_add(250, tick_radar)

    grid.attach(status, 0, 0, 1, 1)
    grid.attach(monitor, 2, 0, 1, 1)
    grid.attach(terminal, 0, 2, 1, 1)
    grid.attach(network, 2, 2, 1, 1)
    return grid


# Low-power settings for this laptop. Set LOW_POWER to False for the full effects.
LOW_POWER = True
SCANLINES = not LOW_POWER
if LOW_POWER:
    CSS += "\n* { box-shadow: none; text-shadow: none; }\n"
