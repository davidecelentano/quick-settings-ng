# Architecture

Quick Settings NG uses independently owned features managed by `FeatureManager`
and `FeatureRegistry`. Every feature owns its signals, timers, actors and async
resources through a deterministic lifecycle.

## Shell integration

`QuickSettingsHost` uses GNOME's `addExternalIndicator()` entry point for QSNG
items such as Privacy and Media. Ordering applies only between QSNG
actors and does not reorder stock Shell items.

## Media

MPRIS discovery, per-player state, UI and player ownership are separate layers.
The widget does not use the legacy `global.stage.grab()` gesture code. The native
GNOME slider handles seeking, while QSNG uses MPRIS `SetPosition` and `Seeked`.

## Application Volume

Application Volume does not create another master-volume card. It attaches a
section to the existing stock output-volume menu and creates rows only for real
`Gvc.MixerSinkInput` application streams. The shared mixer control comes from
GNOME Shell's exported `Volume.getMixerControl()` singleton.

GNOME Shell 51 does not export the stock OutputIndicator instance. The only
private integration is therefore isolated in `src/compat/gnome51-volume.ts`,
which resolves `_volumeOutput` and returns its exported `QuickSlider`. The
feature retries briefly during Shell startup and fails closed if the stock
control is unavailable.

## Privacy

Privacy owns its Quick Settings actors and GSettings connections. It does not
reach into `_backgroundApps`, `_settingsActions`, `_rightBox` or `_grid`.

## Deliberately omitted

Notifications and Weather remain in GNOME's date menu and are not duplicated.
The legacy overlay-menu replacement and stock-item reordering are omitted because
they require private layout internals and significantly increase upgrade risk.
