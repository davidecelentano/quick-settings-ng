import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    DisposableStore,
} from '../../core/disposable.js';

import {
    Feature,
} from '../../core/feature.js';

const OPEN_DURATION_MS = 140;

export class MenuEffectsFeature extends Feature {
    override readonly id = 'menu-effects';

    protected override onEnable(lifetime: DisposableStore): void {
        const quickSettings = Main.panel.statusArea.quickSettings;

        if (quickSettings === undefined)
            throw new Error('GNOME Quick Settings area is unavailable');

        const menu = quickSettings.menu;
        const box = menu.box;
        const interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });

        const signalId = menu.connect(
            'open-state-changed',
            (_menu, isOpen: boolean) => {
                if (!isOpen ||
                    !interfaceSettings.get_boolean('enable-animations')) {
                    return;
                }

                box.remove_all_transitions();
                box.opacity = 0;
                box.scale_x = 0.985;
                box.scale_y = 0.985;
                box.ease({
                    opacity: 255,
                    scaleX: 1,
                    scaleY: 1,
                    duration: OPEN_DURATION_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            },
        );

        lifetime.defer(() => {
            menu.disconnect(signalId);
            box.remove_all_transitions();
            box.opacity = 255;
            box.scale_x = 1;
            box.scale_y = 1;
        });
    }
}
