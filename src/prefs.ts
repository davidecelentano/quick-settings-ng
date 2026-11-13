import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {
    ExtensionPreferences,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class QuickSettingsNGPreferences extends ExtensionPreferences {
    override async fillPreferencesWindow(
        window: Adw.PreferencesWindow,
    ): Promise<void> {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Quick Settings NG',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const modules = new Adw.PreferencesGroup({
            title: 'Modules',
            description: 'Modules can be enabled and disabled without restarting GNOME Shell.',
        });
        page.add(modules);

        for (const [key, title, subtitle] of [
            ['privacy-enabled', 'Privacy', 'Location, camera and microphone controls.'],
            ['media-enabled', 'Media', 'MPRIS controls, artwork, progress and multiple players.'],
            ['volume-mixer-enabled', 'Application Volume', 'Add per-application sliders inside the expandable GNOME system-volume menu.'],
            ['layout-enabled', 'Layout', 'Compact, reversible Quick Settings spacing.'],
            ['menu-effects-enabled', 'Menu Effects', 'Lightweight opening effect that respects reduced animations.'],
        ] as const) {
            modules.add(createSwitchRow(settings, key, title, subtitle));
        }

        const media = new Adw.PreferencesGroup({
            title: 'Media',
        });
        page.add(media);

        media.add(createSwitchRow(
            settings,
            'media-artwork-enabled',
            'Artwork',
            'Show MPRIS artwork using GNOME Shell shared texture caching.',
        ));
        media.add(createSwitchRow(
            settings,
            'media-progress-enabled',
            'Progress and seek',
            'Show playback position and allow seeking when supported.',
        ));
        media.add(createSwitchRow(
            settings,
            'media-player-navigation-enabled',
            'Multi-player navigation',
            'Cycle between multiple players; QSNG keeps playback exclusive.',
        ));

        const privacy = new Adw.PreferencesGroup({
            title: 'Privacy',
        });
        page.add(privacy);

        privacy.add(createSwitchRow(
            settings,
            'privacy-grouped',
            'Group privacy controls',
            'Use one Privacy tile with a submenu instead of three separate tiles.',
        ));

        const clickRow = createSwitchRow(
            settings,
            'privacy-click-to-toggle',
            'Click tile to toggle all',
            'When grouped, clicking the main tile changes every privacy control.',
        );
        privacy.add(clickRow);
        settings.bind(
            'privacy-grouped',
            clickRow,
            'sensitive',
            Gio.SettingsBindFlags.DEFAULT,
        );

        const layout = new Adw.PreferencesGroup({
            title: 'Layout and effects',
        });
        page.add(layout);

        const compactRow = createSwitchRow(
            settings,
            'layout-compact',
            'Compact spacing',
            'Reduce Quick Settings row and column spacing without touching Shell internals.',
        );
        layout.add(compactRow);
        settings.bind(
            'layout-enabled',
            compactRow,
            'sensitive',
            Gio.SettingsBindFlags.DEFAULT,
        );


        window.set_search_enabled(true);
    }
}

function createSwitchRow(
    settings: Gio.Settings,
    key: string,
    title: string,
    subtitle: string,
): Adw.SwitchRow {
    const row = new Adw.SwitchRow({
        title,
        subtitle,
    });

    settings.bind(
        key,
        row,
        'active',
        Gio.SettingsBindFlags.DEFAULT,
    );

    return row;
}
