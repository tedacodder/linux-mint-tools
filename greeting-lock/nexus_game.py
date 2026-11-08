"""Snake in the matrix for the NEXUS lock screen.

Ctrl+G starts the game. The snake waits for your first arrow key or W A S D.
Eat red diamonds to grow and score. Gold stars are worth 5 and vanish after a few
seconds. Cyan shields save you from one crash. Violet orbs slow time. Eat quickly in a
row for a combo multiplier. Every 6 red diamonds the level rises: the snake speeds up,
and from level 3 barriers appear.

P pauses, Space restarts after a crash, and Esc leaves the game. While the game runs,
every key goes to the game, so the password field never receives keystrokes.
This module never touches authentication, PAM, or the lockout counter.
"""
import json
import math
import os
import random
from collections import deque

from gi.repository import Gdk

CELL = 22
START_LENGTH = 4
LEVEL_EVERY = 6          # red diamonds per level
COMBO_WINDOW = 3.0       # seconds allowed between eats to keep a combo going
GOLD_EVERY = 9           # a gold star appears after this many red diamonds
GOLD_LIFE = 6.0          # seconds before a gold star disappears
SHIELD_CHANCE = 0.12
SLOW_CHANCE = 0.10
SLOW_TIME = 5.0
SHIELD_MAX = 1
SCORE_FILE = os.path.join(os.path.expanduser("~"), ".cache", "greeting-lock", "snake-best.json")

NEON = (0.0, 1.0, 0.255)
HEAD = (0.910, 1.0, 0.910)
RED = (1.0, 0.25, 0.32)
AMBER = (1.0, 0.75, 0.2)
COLORS = {
    "red": (1.0, 0.42, 0.42),
    "gold": (1.0, 0.82, 0.25),
    "shield": (0.0, 0.9, 1.0),
    "slow": (0.72, 0.45, 1.0),
}
POINTS = {"red": 1, "gold": 5, "shield": 2, "slow": 2}
GROW = {"red": 1, "gold": 2, "shield": 0, "slow": 0}

TURNS = {
    Gdk.KEY_Left: (-1, 0), Gdk.KEY_Right: (1, 0), Gdk.KEY_Up: (0, -1), Gdk.KEY_Down: (0, 1),
    Gdk.KEY_a: (-1, 0), Gdk.KEY_d: (1, 0), Gdk.KEY_w: (0, -1), Gdk.KEY_s: (0, 1),
    Gdk.KEY_A: (-1, 0), Gdk.KEY_D: (1, 0), Gdk.KEY_W: (0, -1), Gdk.KEY_S: (0, 1),
}


def _load_best():
    try:
        with open(SCORE_FILE) as f:
            return int(json.load(f).get("best", 0))
    except (OSError, ValueError, TypeError, AttributeError):
        return 0


def _save_best(best):
    try:
        os.makedirs(os.path.dirname(SCORE_FILE), mode=0o700, exist_ok=True)
        with open(SCORE_FILE, "w") as f:
            json.dump({"best": int(best)}, f)
    except OSError:
        pass


def _multiplier(combo):
    return min(5, 1 + max(0, combo - 1) // 3)


class Snake:
    def __init__(self):
        self.rng = random.Random()
        self.best = _load_best()
        self.active = False
        self.cols = 0
        self.rows = 0
        self._clear()

    def _clear(self):
        self.body = deque()
        self.dir = (1, 0)
        self.pending = deque()
        self.foods = []
        self.walls = set()
        self.popups = []
        self.particles = []
        self.banner = None
        self.score = 0
        self.eats = 0
        self.level = 1
        self.combo = 0
        self.combo_t = -99.0
        self.shield = 0
        self.slow_until = -1.0
        self.grow = 0
        self.next_gold = GOLD_EVERY
        self.over = False
        self.paused = False
        self.started = False
        self.acc = 0.0
        self.last_t = None
        self.now = 0.0
        self.death_t = None
        self.death_cell = None
        self.eat_pos = None
        self.eat_t = None
        self.best_at_start = self.best

    def start(self, w, h):
        # Leave margins above and below the board for the HUD text.
        self.cols = max(12, (w - 120) // CELL)
        self.rows = max(10, (h - 150) // CELL)
        self.active = True
        self.reset()

    def stop(self):
        self.active = False

    def reset(self):
        self._clear()
        cx, cy = self.cols // 2, self.rows // 2
        self.body = deque((cx - i, cy) for i in range(START_LENGTH))
        self._spawn("red")

    # ----- food, levels, barriers -----

    def _taken(self):
        return set(self.body) | self.walls | {f["cell"] for f in self.foods}

    def _free_cell(self):
        taken = self._taken()
        if len(taken) >= self.cols * self.rows:
            return None
        while True:
            cell = (self.rng.randrange(self.cols), self.rng.randrange(self.rows))
            if cell not in taken:
                return cell

    def _spawn(self, kind, life=None):
        cell = self._free_cell()
        if cell is not None:
            self.foods.append({"cell": cell, "kind": kind, "born": self.now, "life": life})

    def _maybe_special(self):
        if any(f["kind"] != "red" for f in self.foods):
            return
        if self.eats >= self.next_gold:
            self.next_gold += GOLD_EVERY
            self._spawn("gold", GOLD_LIFE)
            return
        roll = self.rng.random()
        if roll < SHIELD_CHANCE and self.shield < SHIELD_MAX:
            self._spawn("shield")
        elif roll < SHIELD_CHANCE + SLOW_CHANCE:
            self._spawn("slow")

    def _add_barriers(self, count):
        head = self.body[0]
        taken = self._taken()
        added = 0
        tries = 0
        while added < count and tries < 500:
            tries += 1
            cell = (self.rng.randrange(self.cols), self.rng.randrange(self.rows))
            if cell in taken or abs(cell[0] - head[0]) + abs(cell[1] - head[1]) < 6:
                continue
            self.walls.add(cell)
            taken.add(cell)
            added += 1

    def _set_level(self, level):
        self.level = level
        text = f"LEVEL {level}"
        if level >= 3:
            text += "  //  BARRIERS ONLINE"
            self._add_barriers(2 + level)
        self.banner = (text, self.now)

    # ----- eating and movement -----

    def _eat(self, food):
        kind = food["kind"]
        if self.now - self.combo_t <= COMBO_WINDOW:
            self.combo += 1
        else:
            self.combo = 1
        self.combo_t = self.now
        mult = _multiplier(self.combo)
        points = POINTS[kind] * mult
        self.score += points
        self.best = max(self.best, self.score)
        self.grow += GROW[kind]
        cell = food["cell"]
        self.eat_pos = cell
        self.eat_t = self.now
        label = f"+{points}" + (f"  x{mult}" if mult > 1 else "")
        self.popups.append({"cell": cell, "text": label, "born": self.now, "kind": kind})
        if kind == "shield":
            self.shield = min(SHIELD_MAX, self.shield + 1)
        elif kind == "slow":
            self.slow_until = self.now + SLOW_TIME
        elif kind == "red":
            self.eats += 1
            new_level = 1 + self.eats // LEVEL_EVERY
            if new_level != self.level:
                self._set_level(new_level)
            self._spawn("red")
            self._maybe_special()

    def _die(self):
        self.over = True
        self.death_t = self.now
        self.death_cell = self.body[0]
        self.particles = [(self.rng.uniform(0, math.tau), self.rng.uniform(40, 150)) for _ in range(18)]
        _save_best(self.best)

    def _move(self):
        if self.pending:
            self.dir = self.pending.popleft()
        hx, hy = self.body[0]
        nx, ny = hx + self.dir[0], hy + self.dir[1]
        if not (0 <= nx < self.cols and 0 <= ny < self.rows):
            if self.shield:
                self.shield -= 1
                nx %= self.cols
                ny %= self.rows
            else:
                return self._die()
        if (nx, ny) in self.walls:
            if self.shield:
                self.shield -= 1
            else:
                return self._die()
        if (nx, ny) in self.body and (nx, ny) != self.body[-1]:
            if self.shield:
                self.shield -= 1
            else:
                return self._die()
        self.body.appendleft((nx, ny))
        food = next((f for f in self.foods if f["cell"] == (nx, ny)), None)
        if food is not None:
            self.foods.remove(food)
            self._eat(food)
        if self.grow > 0:
            self.grow -= 1
        else:
            self.body.pop()

    def step_time(self):
        step = max(0.06, 0.15 - 0.012 * (self.level - 1))
        if self.now < self.slow_until:
            step *= 1.9
        return step

    def turn(self, d):
        last = self.pending[-1] if self.pending else self.dir
        if d == last or d == (-last[0], -last[1]):
            return
        if len(self.pending) < 2:
            self.pending.append(d)

    def update(self, now):
        self.now = now
        if self.last_t is None or not self.active:
            self.last_t = now
            return
        dt = min(now - self.last_t, 0.5)
        self.last_t = now
        if self.over or self.paused:
            return
        self.popups = [p for p in self.popups if now - p["born"] < 1.0]
        self.foods = [f for f in self.foods if f["life"] is None or now - f["born"] < f["life"]]
        if not any(f["kind"] == "red" for f in self.foods):
            self._spawn("red")
        if self.combo and now - self.combo_t > COMBO_WINDOW:
            self.combo = 0
        if not self.started:
            return
        self.acc += dt
        step = self.step_time()
        while self.acc >= step and not self.over:
            self.acc -= step
            self._move()

    def handle_key(self, keyval):
        """Game keys only. The caller has already handled Esc and Ctrl+G."""
        if keyval in TURNS:
            d = TURNS[keyval]
            if not self.over and d != (-self.dir[0], -self.dir[1]):
                self.turn(d)
                self.started = True
        elif keyval in (Gdk.KEY_p, Gdk.KEY_P) and self.started and not self.over:
            self.paused = not self.paused
        elif keyval == Gdk.KEY_space and self.over:
            self.reset()
        # Every other key is ignored, so typing never reaches the password field.

    # ----- drawing -----

    def _draw_head(self, cr, cx, cy):
        dx, dy = self.dir
        size = CELL / 2.0 - 1
        px, py = -dy, dx
        tip = (cx + dx * size, cy + dy * size)
        left = (cx - dx * size * 0.6 + px * size * 0.7, cy - dy * size * 0.6 + py * size * 0.7)
        right = (cx - dx * size * 0.6 - px * size * 0.7, cy - dy * size * 0.6 - py * size * 0.7)
        cr.move_to(*tip)
        cr.line_to(*left)
        cr.line_to(*right)
        cr.close_path()
        cr.set_source_rgba(HEAD[0], HEAD[1], HEAD[2], 1.0)
        cr.fill()

    def _draw_food(self, cr, f, ox, oy, t):
        x, y = f["cell"]
        fx = ox + x * CELL + CELL / 2.0
        fy = oy + y * CELL + CELL / 2.0
        pulse = 0.5 + 0.5 * math.sin(t * 6.0 + x + y)
        kind = f["kind"]
        r, g, b = COLORS[kind]
        if kind == "red":
            for i in range(5):
                cr.set_source_rgba(r, g, b, 0.10 - i * 0.015)
                cr.arc(fx, fy, 14 - i * 2 + pulse * 2, 0, math.tau)
                cr.fill()
            size = 6 + pulse * 1.5
            cr.move_to(fx, fy - size)
            cr.line_to(fx + size, fy)
            cr.line_to(fx, fy + size)
            cr.line_to(fx - size, fy)
            cr.close_path()
            cr.set_source_rgba(1.0, 0.42, 0.42, 1.0)
            cr.fill()
        elif kind == "gold":
            spin = t * 2.5
            pts = []
            for k in range(8):
                a = spin + k * math.pi / 4
                rad = 10 + pulse * 2 if k % 2 == 0 else 4
                pts.append((fx + rad * math.cos(a), fy + rad * math.sin(a)))
            cr.move_to(*pts[0])
            for p in pts[1:]:
                cr.line_to(*p)
            cr.close_path()
            cr.set_source_rgba(r, g, b, 1.0)
            cr.fill()
            left = max(0.0, 1 - (t - f["born"]) / f["life"]) if f["life"] else 1.0
            cr.set_line_width(2)
            cr.set_source_rgba(r, g, b, 0.7)
            cr.arc(fx, fy, 16, -math.pi / 2, -math.pi / 2 + left * math.tau)
            cr.stroke()
        elif kind == "shield":
            cr.set_source_rgba(r, g, b, 0.9)
            cr.arc(fx, fy, 5 + pulse, 0, math.tau)
            cr.fill()
            cr.set_line_width(2)
            cr.set_source_rgba(r, g, b, 0.6)
            cr.arc(fx, fy, 11 + pulse * 2, 0, math.tau)
            cr.stroke()
        else:  # slow orb: two rings that breathe in and out
            cr.set_source_rgba(r, g, b, 0.9)
            cr.arc(fx, fy, 5, 0, math.tau)
            cr.fill()
            cr.set_line_width(1.5)
            cr.set_source_rgba(r, g, b, 0.7)
            cr.arc(fx, fy, 9 + pulse * 3, 0, math.tau)
            cr.stroke()
            cr.arc(fx, fy, 15 - pulse * 3, 0, math.tau)
            cr.stroke()

    def _draw_burst(self, cr, ox, oy, t):
        if self.eat_t is None or self.eat_pos is None:
            return
        age = (t - self.eat_t) / 0.5
        if not 0 <= age < 1:
            return
        ex = ox + self.eat_pos[0] * CELL + CELL / 2.0
        ey = oy + self.eat_pos[1] * CELL + CELL / 2.0
        cr.set_line_width(2)
        cr.set_source_rgba(RED[0], RED[1], RED[2], 0.9 * (1 - age))
        cr.arc(ex, ey, 8 + 30 * age, 0, math.tau)
        cr.stroke()
        cr.set_source_rgba(AMBER[0], AMBER[1], AMBER[2], 0.9 * (1 - age))
        for k in range(8):
            a = k * math.tau / 8
            r0 = 6 + 18 * age
            r1 = 10 + 34 * age
            cr.move_to(ex + r0 * math.cos(a), ey + r0 * math.sin(a))
            cr.line_to(ex + r1 * math.cos(a), ey + r1 * math.sin(a))
            cr.stroke()

    def _draw_death(self, cr, w, h, ox, oy, t):
        if self.death_t is None or self.death_cell is None:
            return
        age = t - self.death_t
        if age > 1.2:
            return
        if age < 0.25:
            cr.set_source_rgba(RED[0], RED[1], RED[2], 0.25 * (1 - age / 0.25))
            cr.rectangle(0, 0, w, h)
            cr.fill()
        cx = ox + self.death_cell[0] * CELL + CELL / 2.0
        cy = oy + self.death_cell[1] * CELL + CELL / 2.0
        for angle, speed in self.particles:
            r = speed * age
            cr.set_source_rgba(RED[0], RED[1], RED[2], max(0.0, 1 - age / 1.2))
            cr.arc(cx + math.cos(angle) * r, cy + math.sin(angle) * r, 2.2, 0, math.tau)
            cr.fill()

    def _draw_popups(self, cr, ox, oy, t):
        cr.set_font_size(13)
        for p in self.popups:
            age = (t - p["born"]) / 1.0
            if not 0 <= age < 1:
                continue
            x, y = p["cell"]
            r, g, b = COLORS[p["kind"]]
            cr.set_source_rgba(r, g, b, 1 - age)
            cr.move_to(ox + x * CELL + CELL / 2.0 - 10, oy + y * CELL - 6 - age * 34)
            cr.show_text(p["text"])

    def _center(self, cr, text, y, size, w, r, g, b, a):
        cr.set_font_size(size)
        width = len(text) * size * 0.62
        cr.set_source_rgba(r, g, b, a)
        cr.move_to(w / 2.0 - width / 2.0, y)
        cr.show_text(text)

    def _draw_hud(self, cr, w, h, ox, oy, t):
        cr.select_font_face("Monospace")
        mult = _multiplier(self.combo)
        cr.set_font_size(15)
        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.95)
        cr.move_to(ox, oy - 16)
        cr.show_text(f"SCORE {self.score}   BEST {self.best}   LEVEL {self.level}   COMBO x{mult}")
        # combo bar: fills toward the next multiplier
        fill = (self.combo % 3) / 3.0 if self.combo else 0.0
        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.2)
        cr.rectangle(ox, oy - 8, self.cols * CELL, 3)
        cr.fill()
        cr.set_source_rgba(AMBER[0], AMBER[1], AMBER[2], 0.9)
        cr.rectangle(ox, oy - 8, self.cols * CELL * fill, 3)
        cr.fill()

        status = []
        if self.shield:
            status.append("SHIELD READY")
        if t < self.slow_until:
            status.append(f"SLOW {self.slow_until - t:.1f}s")
        cr.set_font_size(13)
        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.8)
        cr.move_to(ox, oy + self.rows * CELL + 22)
        cr.show_text(("   ".join(status) + "   " if status else "") + "ARROWS / WASD steer   P pause   ESC leave")

        if self.banner and 0 <= t - self.banner[1] < 1.6:
            fade = 1 - (t - self.banner[1]) / 1.6
            self._center(cr, self.banner[0], h * 0.22, 20, w, NEON[0], NEON[1], NEON[2], fade)

        if not self.started and not self.over:
            pulse = 0.5 + 0.5 * math.sin(t * 4)
            self._center(cr, "PRESS AN ARROW KEY TO JACK IN", h * 0.5 + 60, 18, w,
                         NEON[0], NEON[1], NEON[2], 0.5 + 0.5 * pulse)
        elif self.paused:
            self._center(cr, "PAUSED", h * 0.5, 24, w, 0.0, 0.9, 1.0, 1.0)
        if self.over:
            self._center(cr, "SNAKE DOWN", h * 0.5 - 24, 28, w, RED[0], RED[1], RED[2], 1.0)
            self._center(cr, f"SCORE {self.score}   BEST {self.best}", h * 0.5 + 10, 16, w,
                         NEON[0], NEON[1], NEON[2], 0.95)
            if self.score > 0 and self.score > self.best_at_start:
                self._center(cr, "NEW BEST", h * 0.5 + 38, 16, w, AMBER[0], AMBER[1], AMBER[2], 1.0)
            self._center(cr, "SPACE run it back   ESC leave", h * 0.5 + 66, 14, w,
                         NEON[0], NEON[1], NEON[2], 0.8)

    def draw(self, cr, w, h, t):
        ox = (w - self.cols * CELL) / 2.0
        oy = (h - self.rows * CELL) / 2.0
        if self.death_t is not None and 0 <= t - self.death_t < 0.35:
            amp = 6 * (1 - (t - self.death_t) / 0.35)
            ox += math.sin(t * 90) * amp
            oy += math.cos(t * 75) * amp

        cr.set_source_rgba(0, 0, 0, 0.55)
        cr.rectangle(0, 0, w, h)
        cr.fill()

        cr.set_line_width(1)
        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.07)
        for c in range(self.cols + 1):
            cr.move_to(ox + c * CELL, oy)
            cr.line_to(ox + c * CELL, oy + self.rows * CELL)
        for r in range(self.rows + 1):
            cr.move_to(ox, oy + r * CELL)
            cr.line_to(ox + self.cols * CELL, oy + r * CELL)
        cr.stroke()
        cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.45)
        cr.rectangle(ox, oy, self.cols * CELL, self.rows * CELL)
        cr.stroke()

        cr.set_line_width(1.5)
        for x, y in self.walls:
            px = ox + x * CELL
            py = oy + y * CELL
            cr.set_source_rgba(0.0, 0.3, 0.1, 0.9)
            cr.rectangle(px + 1, py + 1, CELL - 2, CELL - 2)
            cr.fill()
            cr.set_source_rgba(NEON[0], NEON[1], NEON[2], 0.8)
            cr.rectangle(px + 1.5, py + 1.5, CELL - 3, CELL - 3)
            cr.stroke()

        for f in self.foods:
            self._draw_food(cr, f, ox, oy, t)
        self._draw_burst(cr, ox, oy, t)

        n = len(self.body)
        for i, (x, y) in enumerate(self.body):
            if i == 0:
                self._draw_head(cr, ox + x * CELL + CELL / 2.0, oy + y * CELL + CELL / 2.0)
                if self.shield:
                    cr.set_line_width(2)
                    cr.set_source_rgba(COLORS["shield"][0], COLORS["shield"][1], COLORS["shield"][2], 0.9)
                    cr.arc(ox + x * CELL + CELL / 2.0, oy + y * CELL + CELL / 2.0, CELL * 0.75, 0, math.tau)
                    cr.stroke()
            else:
                fade = 1.0 - 0.7 * (i / max(1, n))
                cr.set_source_rgba(NEON[0], NEON[1], NEON[2], fade)
                cr.rectangle(ox + x * CELL + 2, oy + y * CELL + 2, CELL - 4, CELL - 4)
                cr.fill()

        self._draw_death(cr, w, h, ox, oy, t)
        cr.select_font_face("Monospace")
        self._draw_popups(cr, ox, oy, t)
        self._draw_hud(cr, w, h, ox, oy, t)


def _state(lock):
    game = getattr(lock, "_snake", None)
    if game is None:
        game = lock._snake = Snake()
    return game


def game_key(lock, event):
    """Return True if the game used this key, so the lock ignores it."""
    game = _state(lock)
    keyval = event.keyval
    ctrl = bool(event.state & Gdk.ModifierType.CONTROL_MASK)
    if not game.active:
        if ctrl and keyval in (Gdk.KEY_g, Gdk.KEY_G):
            game.start(lock.get_allocated_width(), lock.get_allocated_height())
            lock.column.set_visible(False)
            return True
        return False
    if keyval == Gdk.KEY_Escape:
        game.stop()
        lock.column.set_visible(True)
        lock.entry.grab_focus()
        return True
    game.handle_key(keyval)
    return True


def draw(lock, cr, w, h):
    game = getattr(lock, "_snake", None)
    if game is None or not game.active:
        return
    game.update(lock.world_t)
    game.draw(cr, w, h, lock.world_t)
