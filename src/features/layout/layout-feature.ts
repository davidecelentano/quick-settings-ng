import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    DisposableStore,
} from '../../core/disposable.js';

import {
    Feature,
} from '../../core/feature.js';

export class LayoutFeature extends Feature {
    override readonly id = 'layout';

    #settings: Gio.Settings;

    constructor(settings: Gio.Settings) {
        super();
        this.#settings = settings;
    }

    protected override onEnable(lifetime: DisposableStore): void {
        const quickSettings = Main.panel.statusArea.quickSettings;

        if (quickSettings === undefined)
            throw new Error('GNOME Quick Settings area is unavailable');

        const box = quickSettings.menu.box;
        const sync = (): void => {
            if (this.#settings.get_boolean('layout-compact'))
                box.add_style_class_name('qsng-layout-compact');
            else
                box.remove_style_class_name('qsng-layout-compact');
        };

        const signalId = this.#settings.connect(
            'changed::layout-compact',
            sync,
        );
        sync();

        lifetime.defer(() => {
            this.#settings.disconnect(signalId);
            box.remove_style_class_name('qsng-layout-compact');
        });
    }
}
