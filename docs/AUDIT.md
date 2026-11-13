# Compatibility audit

## Retained modules

- Core lifecycle: rewritten and idempotent
- Media: MPRIS discovery/player ownership, progress/seek and exclusive playback
- Privacy: TypeScript implementation without the legacy panel-private fields
- Application Volume: per-app Gvc sink-input controls inside the stock volume menu
- Layout: compact styling only
- Menu Effects: lightweight, reversible opening effect
- Preferences: libadwaita

## Removed as redundant

- Notifications: GNOME exposes notifications and DND in the date menu
- Weather: GNOME exposes weather in the date menu

Removing both also eliminates the old `MessageView._setupMpris()` compatibility
hook and the GWeather runtime/type surface.

## GNOME 51 private compatibility surface

One hook remains: `_volumeOutput` in `src/compat/gnome51-volume.ts`. GNOME Shell
51 creates the stock `OutputIndicator` internally and does not export that
instance. The bridge is runtime-guarded, contained in one file and audited so it
cannot spread through the codebase.

Everything after that lookup uses exported `QuickSlider`, PopupMenu, Gvc and
`Volume.getMixerControl()` APIs.

## Forbidden patterns

`npm run audit:source` rejects the legacy gesture path and invasive panel layout
fields (`global.stage.grab`, legacy button vfuncs, `_grid`, `_boxPointer`,
`_backgroundApps`, `_rightBox`). It also rejects `_volumeOutput` outside the
single compatibility bridge.
