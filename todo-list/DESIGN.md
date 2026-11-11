# Design brief: Todo List applet

## What this is
A small Cinnamon applet. A panel icon with a count badge opens one centred
window with four tabs (Daily, Backlog, Ongoing, Completed), a search field, a
task list and an add form. Its users are one person on a laptop, working in
short bursts with the keyboard.

## Goal
The window should be calm, fast to scan, and easy to use from the keyboard.
Every control should look like what it does. The neon-green accent should
mark what matters now, and nothing else.

## Direction: instrument panel
Precise, technical and quiet. The accent is used sparingly, and priority is
read from a coloured left edge on each task. Tabs are marked by an underline,
not a filled box. Counts and labels use a monospace font. There is no glow,
gradient or animation.

## Rules
1. **One accent.** `#39FF14` marks the selected tab, focus, primary buttons and
   the badge. Priority colours (`#E24B4A`, `#E8892D`, `#D4B43C`, `#3D8FD9`)
   appear only on priority pills and chips.
2. **Hierarchy.** The title is the brightest text. Tasks are next. Hints and
   empty messages are the dimmest.
3. **Focus is always visible.** Any focused field or button shows an accent
   border. Keyboard users must never lose their place.
4. **Touch-sized targets.** Buttons keep at least 20 px height.
5. **No motion.** The window uses Cinnamon's own open and close animation.
   The applet adds none, so reduced-motion settings are respected.
6. **Consistent scale.** Spacing is 4, 6, 8, 12 px. Corners are 4 px for
   controls and 6 px for rows and the window.
7. **Empty states explain themselves.** Each empty tab says why it is empty.

## Colour tokens
| Token | Value | Used for |
|---|---|---|
| background | `#000000` | window |
| surface | `#050505` | fields, rows |
| border | `#1F6B12` | dividers, idle outlines |
| accent | `#39FF14` | focus, selected tab, primary button, badge |
| text | `#B9FFA6` | body text |
| muted | `#4FA33A` | hints, secondary buttons |
| danger | `#E24B4A` | hover on Delete and remove |

The same accent is the `accent` value in `THEMES` in `applet/applet.js`. Keep the two in step.

## States
Every control has: idle, hover, focus, active, and disabled. Focus is an
accent border. Hover brightens the border. Disabled controls are muted.

## Out of scope
Cinnamon's theme controls the window frame and title bar, so this design does
not restyle them. Animations, gradients and glow are deliberately not used.
