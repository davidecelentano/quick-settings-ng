import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import {
    getStockOutputVolumeSlider,
} from '../../compat/gnome51-volume.js';

import {
    DisposableStore,
} from '../../core/disposable.js';

import {
    Feature,
} from '../../core/feature.js';

const ATTACH_RETRY_MS = 100;
const ATTACH_RETRY_LIMIT = 50;
const APPLICATION_SECTION_POSITION = 2;

class AppVolumeMenuRow {
    readonly item: PopupMenu.PopupBaseMenuItem;

    #control: Gvc.MixerControl;
    #stream: Gvc.MixerStream;
    #slider: Slider.Slider;
    #sliderSignalId: number;
    #streamSignalIds: number[] = [];
    #icon: St.Icon;
    #label: St.Label;
    #muteButton: St.Button;
    #destroyed = false;

    constructor(
        control: Gvc.MixerControl,
        stream: Gvc.MixerStream,
    ) {
        this.#control = control;
        this.#stream = stream;

        this.item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'qsng-volume-menu-item',
        });

        const content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'qsng-volume-menu-row',
        });
        this.item.add_child(content);

        const header = new St.BoxLayout({
            x_expand: true,
            style_class: 'qsng-volume-menu-header',
        });
        content.add_child(header);

        this.#icon = new St.Icon({
            gicon: stream.get_gicon(),
            icon_size: 18,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this.#icon);

        this.#label = new St.Label({
            text: streamLabel(stream),
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'qsng-volume-label',
        });
        header.add_child(this.#label);

        this.#muteButton = new St.Button({
            toggleMode: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
            accessible_name: 'Mute application',
            child: new St.Icon({
                icon_name: 'audio-volume-muted-symbolic',
            }),
            style_class: 'icon-button flat qsng-volume-mute',
        });
        this.#muteButton.connect('clicked', () => {
            this.#stream.change_is_muted(!this.#stream.is_muted);
        });
        header.add_child(this.#muteButton);

        this.#slider = new Slider.Slider(0);
        this.#slider.x_expand = true;
        this.#slider.accessible_name = `Volume for ${streamLabel(stream)}`;
        this.#sliderSignalId = this.#slider.connect(
            'notify::value',
            () => this.#onSliderChanged(),
        );
        content.add_child(this.#slider);

        this.#streamSignalIds.push(
            this.#stream.connect('notify::volume', () => this.#sync()),
            this.#stream.connect('notify::is-muted', () => this.#sync()),
        );

        this.#sync();
    }

    refresh(): void {
        if (this.#destroyed)
            return;

        this.#icon.gicon = this.#stream.get_gicon();
        this.#label.text = streamLabel(this.#stream);
        this.#slider.accessible_name = `Volume for ${streamLabel(this.#stream)}`;
        this.#sync();
    }

    destroy(): void {
        if (this.#destroyed)
            return;

        this.#destroyed = true;
        this.#slider.disconnect(this.#sliderSignalId);

        for (const signalId of this.#streamSignalIds)
            this.#stream.disconnect(signalId);
        this.#streamSignalIds = [];

        this.item.destroy();
    }

    #onSliderChanged(): void {
        if (this.#destroyed)
            return;

        const volume = Math.round(
            this.#slider.value * this.#control.get_vol_max_norm(),
        );

        if (volume <= 0) {
            this.#stream.set_volume(0);
            this.#stream.change_is_muted(true);
        } else {
            this.#stream.set_volume(volume);
            if (this.#stream.is_muted)
                this.#stream.change_is_muted(false);
        }

        this.#stream.push_volume();
    }

    #sync(): void {
        if (this.#destroyed)
            return;

        const value = this.#stream.is_muted
            ? 0
            : this.#stream.volume / this.#control.get_vol_max_norm();

        this.#slider.block_signal_handler(this.#sliderSignalId);
        this.#slider.value = Math.max(0, Math.min(1, value));
        this.#slider.unblock_signal_handler(this.#sliderSignalId);

        this.#muteButton.accessible_name = this.#stream.is_muted
            ? 'Unmute application'
            : 'Mute application';
        this.#muteButton.checked = this.#stream.is_muted;
    }
}

class VolumeMixerMenu {
    #outputSlider: QuickSettings.QuickSlider;
    #control: Gvc.MixerControl;
    #expander: PopupMenu.PopupSubMenuMenuItem;
    #rows = new Map<number, AppVolumeMenuRow>();
    #controlSignalIds: number[] = [];
    #destroyed = false;

    constructor(outputSlider: QuickSettings.QuickSlider) {
        this.#outputSlider = outputSlider;
        this.#control = Volume.getMixerControl();

        this.#expander = new PopupMenu.PopupSubMenuMenuItem(
            'Application Volume',
            false,
        );
        this.#expander.visible = false;

        this.#outputSlider.menu.addMenuItem(
            this.#expander,
            APPLICATION_SECTION_POSITION,
        );

        this.#controlSignalIds.push(
            this.#control.connect('stream-added', (_control, id) => {
                this.#addStream(Number(id));
            }),
            this.#control.connect('stream-removed', (_control, id) => {
                this.#removeStream(Number(id));
            }),
            this.#control.connect('stream-changed', (_control, id) => {
                this.#refreshStream(Number(id));
            }),
            this.#control.connect('output-added', () => {
                this.#syncMenuEnabled();
            }),
            this.#control.connect('output-removed', () => {
                this.#syncMenuEnabled();
            }),
            this.#control.connect('default-sink-changed', () => {
                this.#syncMenuEnabled();
            }),
            this.#control.connect('state-changed', () => {
                this.#syncMenuEnabled();
            }),
        );

        for (const stream of this.#control.get_streams())
            this.#addStream(stream.get_id());

        this.#syncVisibility();
    }

    destroy(): void {
        if (this.#destroyed)
            return;

        this.#destroyed = true;

        for (const signalId of this.#controlSignalIds)
            this.#control.disconnect(signalId);
        this.#controlSignalIds = [];

        for (const row of this.#rows.values())
            row.destroy();
        this.#rows.clear();

        this.#expander.destroy();

        this.#outputSlider.menuEnabled = this.#stockNeedsMenu();
    }

    #addStream(id: number): void {
        if (this.#destroyed || this.#rows.has(id))
            return;

        const stream = this.#control.lookup_stream_id(id);

        if (!isApplicationStream(stream))
            return;

        const row = new AppVolumeMenuRow(this.#control, stream);
        this.#rows.set(id, row);
        this.#expander.menu.addMenuItem(row.item);
        this.#syncVisibility();
    }

    #removeStream(id: number): void {
        const row = this.#rows.get(id);

        if (row === undefined)
            return;

        this.#rows.delete(id);
        row.destroy();
        this.#syncVisibility();
    }

    #refreshStream(id: number): void {
        const stream = this.#control.lookup_stream_id(id);
        const isApp = isApplicationStream(stream);
        const row = this.#rows.get(id);

        if (isApp && row === undefined)
            this.#addStream(id);
        else if (!isApp && row !== undefined)
            this.#removeStream(id);
        else if (isApp && row !== undefined)
            row.refresh();
    }

    #syncVisibility(): void {
        const hasApplications = this.#rows.size > 0;

        this.#expander.visible = hasApplications;
        if (!hasApplications)
            this.#expander.setSubmenuShown(false);
        this.#syncMenuEnabled();
    }

    #syncMenuEnabled(): void {
        if (this.#destroyed)
            return;

        this.#outputSlider.menuEnabled =
            this.#rows.size > 0 || this.#stockNeedsMenu();
    }

    #stockNeedsMenu(): boolean {
        const firstItem = this.#outputSlider.menu.firstMenuItem;

        return firstItem instanceof PopupMenu.PopupMenuSection &&
            firstItem.numMenuItems > 1;
    }
}

export class VolumeMixerFeature extends Feature {
    override readonly id = 'volume-mixer';

    protected override onEnable(lifetime: DisposableStore): void {
        let retryId = 0;
        let attempts = 0;
        let mixer: VolumeMixerMenu | null = null;

        const attach = (): boolean => {
            const outputSlider = getStockOutputVolumeSlider();

            if (outputSlider === null)
                return false;

            mixer = new VolumeMixerMenu(outputSlider);
            lifetime.defer(() => {
                mixer?.destroy();
                mixer = null;
            });
            return true;
        };

        if (attach())
            return;

        retryId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            ATTACH_RETRY_MS,
            () => {
                attempts++;

                if (lifetime.disposed) {
                    retryId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                if (attach()) {
                    retryId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                if (attempts >= ATTACH_RETRY_LIMIT) {
                    console.error(
                        '[QSNG] volume mixer: stock output volume control unavailable',
                    );
                    retryId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                return GLib.SOURCE_CONTINUE;
            },
        );

        lifetime.defer(() => {
            if (retryId !== 0) {
                GLib.source_remove(retryId);
                retryId = 0;
            }
        });
    }
}

function isApplicationStream(
    stream: Gvc.MixerStream | null,
): stream is Gvc.MixerSinkInput {
    return stream instanceof Gvc.MixerSinkInput &&
        !stream.is_event_stream;
}

function streamLabel(stream: Gvc.MixerStream): string {
    const name = stream.get_name();
    const description = stream.get_description();

    if (name && description && name !== description)
        return `${name} - ${description}`;

    return description || name || 'Application';
}
