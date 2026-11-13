# Development

## Requirements

The primary development target is GNOME Shell 51 with GJS and Mutter DevKit.

```bash
npm ci
npm run check
```

`npm run check` runs the source compatibility audit, strict TypeScript check,
build, schema compilation and packaging.

## MPRIS regression

```bash
npm run test:mpris
```

The deterministic mock validates metadata, commands, position/seek and exclusive
playback switching.

## Full nested-Shell test

```bash
npm run test:ui
```

The test packages and installs the development UUID, starts GNOME Shell through
Mutter DevKit on a private D-Bus session, launches two mock MPRIS players and
restores QSNG GSettings when the test exits.

Validate:

- Privacy remains above Media
- media buttons, artwork, progress/seek and player switching
- no mouse-follow/drag regression after media or seek interaction
- Application Volume: start an audio-producing app in the nested session, open
  the arrow on the **stock GNOME volume row**, and verify that the Application
  Volume section appears with per-app slider and mute controls
- Application Volume disappears when no application streams remain
- compact spacing and menu effect remain reversible
- repeated Quick Settings open/close does not duplicate actors

Notifications and Weather are intentionally left to GNOME's date menu.

## Compatibility review for a future GNOME release

1. Run `npm run check` against that release's GIR packages.
2. Review `src/compat/gnome51-volume.ts` against `panel.js`/`volume.js`.
3. Re-run MPRIS and full nested-Shell tests.
4. Keep any new private compatibility lookup isolated under `src/compat/`.
