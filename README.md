# Quick Settings NG

Quick Settings NG extends the GNOME Shell 51 Quick Settings panel with a small set of features that fit naturally into the stock interface.

It keeps GNOME's own controls in place and adds the pieces that are missing: a richer media card, privacy controls, per-application volume, compact layout options, and a few focused UI refinements.

## Features

| Area | What Quick Settings NG adds |
| --- | --- |
| Media | MPRIS media card with artwork, metadata, playback controls, progress, seeking, and multi-player navigation |
| Privacy | Location, camera, and microphone controls, available as grouped or individual Quick Settings items |
| Application volume | Per-application volume and mute controls inside the stock GNOME volume menu |
| Layout | Optional compact spacing for the Quick Settings panel |
| Effects | Lightweight Quick Settings opening animation that follows GNOME's animation preference |
| Preferences | Native libadwaita settings window |

### Media

The media card is built around MPRIS and supports:

- artwork, title, artist, and album metadata;
- previous, play/pause, and next controls;
- live playback progress;
- absolute seeking;
- multiple active MPRIS players;
- player switching from the card;
- exclusive playback switching when starting another player through QSNG.

The interaction model uses regular GNOME Shell controls and does not use the old stage-grab gesture path that caused stuck pointer/drag behaviour in older implementations.

### Privacy

QSNG can expose quick access to:

- Location;
- Camera;
- Microphone.

Privacy controls can be shown as separate items or grouped together from Preferences.

### Application Volume

Application Volume lives inside GNOME's existing volume control instead of adding a second master-volume panel.

When applications expose active audio streams, the stock volume menu gains an `Application Volume` section with per-application sliders and mute controls. When there is nothing to mix, the section stays out of the way.

### Layout and effects

QSNG can tighten the spacing of the Quick Settings panel and add a subtle opening animation. Both changes are reversible, and the animation follows GNOME's global animation setting.

## Scope

Quick Settings NG is deliberately focused on the Quick Settings panel.

Notifications and weather are not duplicated because GNOME already exposes them through the date and calendar menu. QSNG also avoids replacing the complete Quick Settings panel when a smaller integration can do the job.

## Requirements

- GNOME Shell 51
- A GNOME session with user extensions enabled

For building from source:

- Node.js and npm
- `glib-compile-schemas`

## Install

Download the extension ZIP from the Releases page, then install it with:

```bash
gnome-extensions install --force quick-settings-ng@local.shell-extension.zip
gnome-extensions enable quick-settings-ng@local
```

Open Preferences with:

```bash
gnome-extensions prefs quick-settings-ng@local
```

When replacing an already loaded development build, a logout/login may be required for GNOME Shell to discard previously imported extension modules.

## Build from source

```bash
git clone https://github.com/davidecelentano/quick-settings-ng.git
cd quick-settings-ng
npm ci
npm run check
```

The packaged extension is written to:

```text
build/quick-settings-ng@local.shell-extension.zip
```

Useful development commands:

```bash
npm run typecheck
npm run test:mpris
npm run test:ui
npm run audit:source
```

## Project layout

```text
src/
  compat/          Narrow GNOME Shell integration bridges
  core/            Feature lifecycle, settings, ordering, and host integration
  features/
    layout/
    media/
    menu-effects/
    privacy/
    volume-mixer/
  extension.ts     Extension entry point
  prefs.ts         libadwaita Preferences

schemas/           GSettings schema
styles/            Shell stylesheet
tools/             Build, audit, and test helpers
docs/              Architecture, development, audit, and upstream notes
```

## Development notes

The extension is split into independent features with explicit enable/disable lifecycles. Shell-specific integration is kept narrow so individual features can be changed without turning the extension into a replacement Quick Settings implementation.

More detail is available in:

- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Source audit](docs/AUDIT.md)
- [Upstream provenance](docs/UPSTREAM.md)

## Upstream projects

Quick Settings NG builds on ideas and selected implementation work from:

- [Quick Settings Tweaks](https://github.com/jstockdale/quick-settings-tweaks)
- [Privacy Menu Extension](https://github.com/stuarthayhurst/privacy-menu-extension)

See [docs/UPSTREAM.md](docs/UPSTREAM.md) for provenance and porting notes.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
