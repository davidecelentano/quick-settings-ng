import Gio from 'gi://Gio';

import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {
    DisposableStore,
} from '../../core/disposable.js';

import {
    Feature,
} from '../../core/feature.js';

import {
    QUICK_SETTINGS_ORDER,
} from '../../core/quick-settings-order.js';

import {
    QuickSettingsHost,
} from '../../core/quick-settings-host.js';

import {
    MprisPlayerStore,
} from './mpris-player-store.js';

import {
    MediaWidget,
} from './media-widget.js';

export class MediaFeature extends Feature {
    override readonly id = 'media';

    #settings: Gio.Settings;
    #host: QuickSettingsHost;

    constructor(
        settings: Gio.Settings,
        host: QuickSettingsHost,
    ) {
        super();
        this.#settings = settings;
        this.#host = host;
    }

    protected override onEnable(
        lifetime: DisposableStore,
    ): void {
        const players =
            lifetime.add(new MprisPlayerStore());

        const widget = new MediaWidget(
            serviceName => players.getPlayer(serviceName),
            serviceName => players.toggleExclusivePlayback(serviceName),
            this.#settings,
        );

        const indicator = new QuickSettings.SystemIndicator();
        indicator.quickSettingsItems.push(widget.actor as never);

        lifetime.add(
            this.#host.addIndicator(
                indicator,
                QUICK_SETTINGS_ORDER.media,
                2,
            ),
        );

        lifetime.defer(() => {
            indicator.quickSettingsItems.length = 0;
            widget.destroy();
            indicator.destroy();
        });

        lifetime.add(
            players.subscribe(snapshots => {
                widget.update(snapshots);

            }),
        );

        players.start();
    }
}
