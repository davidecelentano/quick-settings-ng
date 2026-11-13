# Quick Settings NG

Quick Settings NG is a GNOME Shell 51 extension focused on making the stock
Quick Settings panel more capable without replacing the panel itself.

## Features

- Privacy controls for Location, Camera, and Microphone
- Hardened MPRIS media card with artwork, progress/seek, multi-player navigation,
  and exclusive playback switching
- Per-application volume mixer integrated into the expandable **stock GNOME
  volume menu** (no duplicate master-volume card)
- Compact Quick Settings spacing
- Lightweight menu opening effect respecting GNOME animation preferences
- libadwaita Preferences window

Notifications and Weather are intentionally not duplicated: GNOME already
provides them in the clock/date menu.

## Compatibility policy

The extension targets GNOME Shell 51 first. Runtime features avoid `_grid`,
`_boxPointer`, `global.stage.grab()`, and legacy button-event vfuncs.

Application Volume has one isolated GNOME 51 compatibility bridge in
`src/compat/gnome51-volume.ts`: GNOME does not export the stock OutputIndicator
instance, so the bridge locates `_volumeOutput` and immediately returns only the
exported `QuickSlider` API. The private lookup is runtime-guarded and forbidden
anywhere else by `npm run audit:source`.

The legacy overlay-menu replacement and arbitrary reordering of stock GNOME
items are intentionally omitted because they require invasive private Shell
internals.

## Development

```bash
npm ci
npm run check
npm run test:mpris
npm run test:ui
```

See `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, and `docs/AUDIT.md` for the
runtime and compatibility details.
