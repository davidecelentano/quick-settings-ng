import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import type {
    MprisPlayer,
    MprisPlayerSnapshot,
} from './mpris-player.js';

export type MediaPlayerResolver =
    (serviceName: string) => MprisPlayer | null;

export type MediaPlaybackToggle =
    (serviceName: string) => Promise<void>;

const PROGRESS_TICK_MS = 250;
const SEEK_DEBOUNCE_MS = 120;

/**
 * A deliberately carousel-gesture-free media card for GNOME Quick Settings.
 *
 * Playback controls are independent St.Button instances. Seeking uses GNOME
 * Shell's native Slider widget; the card itself never grabs pointer/touch
 * input and never overrides Clutter button/motion vfuncs.
 */
export class MediaWidget {
    readonly actor: St.BoxLayout;

    #resolvePlayer: MediaPlayerResolver;
    #togglePlayback: MediaPlaybackToggle;
    #settings: Gio.Settings;
    #settingsSignalIds: number[] = [];
    #selectedServiceName: string | null = null;
    #snapshots: readonly MprisPlayerSnapshot[] = [];
    #manualSelection = false;

    #playerCountLabel: St.Label;
    #playerNavBox: St.BoxLayout;
    #previousPlayerButton: St.Button;
    #nextPlayerButton: St.Button;
    #artContainer: St.Widget;
    #artTexture: Clutter.Actor | null = null;
    #currentArtUrl: string | null = null;
    #titleLabel: St.Label;
    #artistLabel: St.Label;

    #progressBox: St.BoxLayout;
    #progressSlider: Slider.Slider;
    #progressChangedId: number;
    #currentTimeLabel: St.Label;
    #totalTimeLabel: St.Label;

    #previousButton: St.Button;
    #playPauseButton: St.Button;
    #playPauseIcon: St.Icon;
    #nextButton: St.Button;

    #progressTickId = 0;
    #seekTimeoutId = 0;
    #seeking = false;
    #destroyed = false;

    constructor(
        resolvePlayer: MediaPlayerResolver,
        togglePlayback: MediaPlaybackToggle,
        settings: Gio.Settings,
    ) {
        this.#resolvePlayer = resolvePlayer;
        this.#togglePlayback = togglePlayback;
        this.#settings = settings;

        this.actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            reactive: false,
            can_focus: false,
            visible: false,
            style_class: 'qsng-media-card',
        });

        const header = new St.BoxLayout({
            x_expand: true,
            style_class: 'qsng-media-header',
        });

        const heading = new St.Label({
            text: 'Media',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'qsng-media-heading',
        });

        this.#playerNavBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'qsng-media-player-nav',
        });

        this.#previousPlayerButton = this.#createControlButton(
            'go-previous-symbolic',
            'Previous media player',
            () => this.#cyclePlayer(-1),
        );
        this.#previousPlayerButton.add_style_class_name(
            'qsng-media-player-nav-button',
        );

        this.#playerCountLabel = new St.Label({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'qsng-media-player-count',
        });

        this.#nextPlayerButton = this.#createControlButton(
            'go-next-symbolic',
            'Next media player',
            () => this.#cyclePlayer(1),
        );
        this.#nextPlayerButton.add_style_class_name(
            'qsng-media-player-nav-button',
        );

        this.#playerNavBox.add_child(this.#previousPlayerButton);
        this.#playerNavBox.add_child(this.#playerCountLabel);
        this.#playerNavBox.add_child(this.#nextPlayerButton);

        header.add_child(heading);
        header.add_child(this.#playerNavBox);
        this.actor.add_child(header);

        const content = new St.BoxLayout({
            x_expand: true,
            style_class: 'qsng-media-content',
        });

        this.#artContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'qsng-media-art',
        });
        this.#artContainer.add_child(new St.Icon({
            gicon: new Gio.ThemedIcon({
                name: 'audio-x-generic-symbolic',
            }),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            icon_size: 40,
        }));

        const trackInfo = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'qsng-media-track-info',
        });

        this.#titleLabel = new St.Label({
            text: '',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            style_class: 'qsng-media-title',
        });
        this.#titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.#titleLabel.clutter_text.single_line_mode = true;

        this.#artistLabel = new St.Label({
            text: '',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            style_class: 'qsng-media-artist',
        });
        this.#artistLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.#artistLabel.clutter_text.single_line_mode = true;

        trackInfo.add_child(this.#titleLabel);
        trackInfo.add_child(this.#artistLabel);

        content.add_child(this.#artContainer);
        content.add_child(trackInfo);
        this.actor.add_child(content);

        this.#progressBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'qsng-media-progress-box',
        });

        this.#progressSlider = new Slider.Slider(0);
        this.#progressSlider.x_expand = true;
        this.#progressSlider.accessible_name = 'Playback position';
        this.#progressSlider.add_style_class_name('qsng-media-progress');
        this.#progressChangedId = this.#progressSlider.connect(
            'notify::value',
            () => {
                this.#onProgressChanged();
            },
        );
        this.#progressBox.add_child(this.#progressSlider);

        const timeRow = new St.BoxLayout({
            x_expand: true,
            style_class: 'qsng-media-time-row',
        });

        this.#currentTimeLabel = new St.Label({
            text: '0:00',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            style_class: 'qsng-media-time',
        });

        this.#totalTimeLabel = new St.Label({
            text: '0:00',
            x_align: Clutter.ActorAlign.END,
            style_class: 'qsng-media-time',
        });

        timeRow.add_child(this.#currentTimeLabel);
        timeRow.add_child(this.#totalTimeLabel);
        this.#progressBox.add_child(timeRow);
        this.actor.add_child(this.#progressBox);

        const controls = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            style_class: 'qsng-media-controls',
        });

        this.#previousButton = this.#createControlButton(
            'media-skip-backward-symbolic',
            'Previous track',
            () => {
                const player = this.#selectedPlayer();
                if (player !== null)
                    void player.previous();
            },
        );

        this.#playPauseIcon = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            style_class: 'popup-menu-icon',
        });
        this.#playPauseButton = new St.Button({
            can_focus: true,
            reactive: true,
            track_hover: true,
            accessible_name: 'Play',
            child: this.#playPauseIcon,
            style_class: 'icon-button qsng-media-control qsng-media-control-primary',
        });
        this.#playPauseButton.connect('clicked', () => {
            const snapshot = this.#selectedSnapshot();

            if (snapshot !== null)
                void this.#togglePlayback(snapshot.serviceName);
        });

        this.#nextButton = this.#createControlButton(
            'media-skip-forward-symbolic',
            'Next track',
            () => {
                const player = this.#selectedPlayer();
                if (player !== null)
                    void player.next();
            },
        );

        controls.add_child(this.#previousButton);
        controls.add_child(this.#playPauseButton);
        controls.add_child(this.#nextButton);
        this.actor.add_child(controls);

        for (const key of [
            'media-artwork-enabled',
            'media-progress-enabled',
            'media-player-navigation-enabled',
        ]) {
            this.#settingsSignalIds.push(
                this.#settings.connect(`changed::${key}`, () => {
                    const selected = this.#selectedSnapshot();
                    if (selected !== null)
                        this.#render(selected, this.#snapshots.length);
                }),
            );
        }
    }

    update(snapshots: readonly MprisPlayerSnapshot[]): void {
        if (this.#destroyed)
            return;

        this.#snapshots = snapshots;

        if (snapshots.length === 0) {
            this.#selectedServiceName = null;
            this.#manualSelection = false;
            this.#stopProgressTick();
            this.#cancelPendingSeek();
            this.actor.visible = false;
            return;
        }

        const current = this.#selectedServiceName === null
            ? null
            : snapshots.find(snapshot =>
                snapshot.serviceName === this.#selectedServiceName) ?? null;

        const playing = snapshots.find(snapshot =>
            snapshot.playbackStatus === 'Playing') ?? null;

        if (current === null && this.#selectedServiceName !== null)
            this.#manualSelection = false;

        /*
         * Manual player selection remains stable until that player disappears.
         * Otherwise prefer the currently-playing player.
         */
        const selected = this.#manualSelection && current !== null
            ? current
            : current?.playbackStatus === 'Playing'
                ? current
                : playing ?? current ?? snapshots[0];

        if (selected === undefined) {
            this.#selectedServiceName = null;
            this.#stopProgressTick();
            this.actor.visible = false;
            return;
        }

        if (this.#selectedServiceName !== selected.serviceName) {
            this.#cancelPendingSeek();
            this.#seeking = false;
        }

        this.#selectedServiceName = selected.serviceName;
        this.#render(selected, snapshots.length);
        this.actor.visible = true;
    }

    destroy(): void {
        if (this.#destroyed)
            return;

        this.#destroyed = true;
        this.#stopProgressTick();
        this.#cancelPendingSeek();

        this.#progressSlider.disconnect(this.#progressChangedId);

        for (const signalId of this.#settingsSignalIds)
            this.#settings.disconnect(signalId);
        this.#settingsSignalIds = [];

        this.#artTexture?.destroy();
        this.#artTexture = null;
        this.#currentArtUrl = null;

        this.#snapshots = [];
        this.#selectedServiceName = null;
        this.actor.destroy();
    }

    #render(
        snapshot: MprisPlayerSnapshot,
        playerCount: number,
    ): void {
        const playerIndex = Math.max(
            0,
            this.#snapshots.findIndex(player =>
                player.serviceName === snapshot.serviceName),
        );
        const navigationEnabled =
            this.#settings.get_boolean('media-player-navigation-enabled');

        this.#playerNavBox.visible = navigationEnabled && playerCount > 1;
        this.#playerCountLabel.text = `${playerIndex + 1} / ${playerCount}`;

        this.#titleLabel.text = snapshot.title || 'Unknown title';
        this.#artistLabel.text = snapshot.artists.length > 0
            ? snapshot.artists.join(', ')
            : snapshot.album || 'Unknown artist';

        this.#updateArtwork(snapshot.artUrl);

        const playing = snapshot.playbackStatus === 'Playing';
        this.#playPauseIcon.icon_name = playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this.#playPauseButton.accessible_name = playing
            ? 'Pause'
            : 'Play';

        this.#previousButton.reactive =
            snapshot.canControl && snapshot.canGoPrevious;
        this.#previousButton.can_focus = this.#previousButton.reactive;

        this.#nextButton.reactive =
            snapshot.canControl && snapshot.canGoNext;
        this.#nextButton.can_focus = this.#nextButton.reactive;

        const canToggle = snapshot.canControl &&
            (snapshot.canPlay || snapshot.canPause);
        this.#playPauseButton.reactive = canToggle;
        this.#playPauseButton.can_focus = canToggle;

        this.#configureProgress(snapshot);
    }

    #configureProgress(snapshot: MprisPlayerSnapshot): void {
        const lengthUs = snapshot.lengthUs;
        const hasDuration =
            this.#settings.get_boolean('media-progress-enabled') &&
            lengthUs !== null &&
            Number.isFinite(lengthUs) &&
            lengthUs > 0;

        this.#progressBox.visible = hasDuration;

        if (!hasDuration) {
            this.#stopProgressTick();
            this.#cancelPendingSeek();
            this.#seeking = false;
            return;
        }

        const canSeek =
            snapshot.canControl &&
            snapshot.canSeek &&
            snapshot.trackId !== null;

        this.#progressSlider.reactive = canSeek;
        this.#progressSlider.can_focus = canSeek;

        if (!this.#seeking)
            this.#refreshProgress(snapshot);

        if (snapshot.playbackStatus === 'Playing')
            this.#startProgressTick();
        else
            this.#stopProgressTick();
    }

    #refreshProgress(snapshot?: MprisPlayerSnapshot): void {
        if (this.#destroyed || this.#seeking)
            return;

        const selected = snapshot ?? this.#selectedSnapshot();
        const lengthUs = selected?.lengthUs ?? null;

        if (
            selected === null ||
            lengthUs === null ||
            !Number.isFinite(lengthUs) ||
            lengthUs <= 0
        ) {
            return;
        }

        const player = this.#resolvePlayer(selected.serviceName);
        const positionUs = player?.estimatedPositionUs ??
            selected.positionUs ??
            0;
        const clamped = Math.max(0, Math.min(positionUs, lengthUs));
        const value = clamped / lengthUs;

        this.#progressSlider.block_signal_handler(this.#progressChangedId);
        this.#progressSlider.value = value;
        this.#progressSlider.unblock_signal_handler(this.#progressChangedId);

        this.#currentTimeLabel.text = formatDuration(clamped);
        this.#totalTimeLabel.text = formatDuration(lengthUs);
    }

    #onProgressChanged(): void {
        if (this.#destroyed)
            return;

        const snapshot = this.#selectedSnapshot();
        const lengthUs = snapshot?.lengthUs ?? null;

        if (
            snapshot === null ||
            lengthUs === null ||
            lengthUs <= 0 ||
            !snapshot.canControl ||
            !snapshot.canSeek ||
            snapshot.trackId === null
        ) {
            return;
        }

        this.#seeking = true;

        const targetUs = Math.round(
            Math.max(0, Math.min(1, this.#progressSlider.value)) * lengthUs,
        );

        this.#currentTimeLabel.text = formatDuration(targetUs);
        this.#totalTimeLabel.text = formatDuration(lengthUs);

        this.#scheduleSeek(
            snapshot.serviceName,
            snapshot.trackId,
            targetUs,
        );
    }

    #scheduleSeek(
        serviceName: string,
        trackId: string,
        positionUs: number,
    ): void {
        this.#cancelPendingSeek();

        this.#seekTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            SEEK_DEBOUNCE_MS,
            () => {
                this.#seekTimeoutId = 0;

                const player = this.#resolvePlayer(serviceName);

                if (player === null) {
                    this.#seeking = false;
                    this.#refreshProgress();
                    return GLib.SOURCE_REMOVE;
                }

                void player
                    .setPosition(positionUs, trackId)
                    .finally(() => {
                        if (
                            this.#destroyed ||
                            this.#selectedServiceName !== serviceName
                        ) {
                            return;
                        }

                        this.#seeking = false;
                        this.#refreshProgress();
                    });

                return GLib.SOURCE_REMOVE;
            },
        );
    }

    #cancelPendingSeek(): void {
        if (this.#seekTimeoutId === 0)
            return;

        GLib.Source.remove(this.#seekTimeoutId);
        this.#seekTimeoutId = 0;
    }

    #startProgressTick(): void {
        if (this.#progressTickId !== 0)
            return;

        this.#progressTickId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            PROGRESS_TICK_MS,
            () => {
                if (this.#destroyed) {
                    this.#progressTickId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                const snapshot = this.#selectedSnapshot();

                if (
                    snapshot === null ||
                    snapshot.playbackStatus !== 'Playing'
                ) {
                    this.#progressTickId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                this.#refreshProgress(snapshot);
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    #stopProgressTick(): void {
        if (this.#progressTickId === 0)
            return;

        GLib.Source.remove(this.#progressTickId);
        this.#progressTickId = 0;
    }

    #updateArtwork(artUrl: string | null): void {
        const enabled = this.#settings.get_boolean('media-artwork-enabled');
        const nextUrl = enabled ? artUrl : null;

        if (this.#currentArtUrl === nextUrl)
            return;

        this.#currentArtUrl = nextUrl;
        this.#artTexture?.destroy();
        this.#artTexture = null;

        if (nextUrl === null)
            return;

        try {
            const file = Gio.File.new_for_uri(nextUrl);
            const texture = St.TextureCache.get_default().load_file_async(
                file,
                56,
                56,
                1,
                1,
            );

            texture.set_size(56, 56);
            texture.x_align = Clutter.ActorAlign.CENTER;
            texture.y_align = Clutter.ActorAlign.CENTER;

            this.#artTexture = texture;
            this.#artContainer.add_child(texture);
        } catch (error) {
            console.error(
                `[QSNG] media: failed to load artwork ${nextUrl}`,
                error,
            );
        }
    }

    #cyclePlayer(delta: number): void {
        if (this.#snapshots.length < 2)
            return;

        const currentIndex = this.#selectedServiceName === null
            ? 0
            : Math.max(0, this.#snapshots.findIndex(snapshot =>
                snapshot.serviceName === this.#selectedServiceName));

        const nextIndex = (
            currentIndex + delta + this.#snapshots.length
        ) % this.#snapshots.length;
        const selected = this.#snapshots[nextIndex];

        if (selected === undefined)
            return;

        this.#manualSelection = true;
        this.#selectedServiceName = selected.serviceName;
        this.#cancelPendingSeek();
        this.#seeking = false;
        this.#render(selected, this.#snapshots.length);
    }

    #selectedSnapshot(): MprisPlayerSnapshot | null {
        if (this.#selectedServiceName === null)
            return null;

        return this.#snapshots.find(snapshot =>
            snapshot.serviceName === this.#selectedServiceName) ?? null;
    }

    #selectedPlayer(): MprisPlayer | null {
        if (this.#selectedServiceName === null)
            return null;

        return this.#resolvePlayer(this.#selectedServiceName);
    }

    #createControlButton(
        iconName: string,
        accessibleName: string,
        callback: () => void,
    ): St.Button {
        const button = new St.Button({
            can_focus: true,
            reactive: true,
            track_hover: true,
            accessible_name: accessibleName,
            child: new St.Icon({
                icon_name: iconName,
                style_class: 'popup-menu-icon',
            }),
            style_class: 'icon-button qsng-media-control',
        });

        button.connect('clicked', callback);
        return button;
    }
}

function formatDuration(microseconds: number): string {
    if (!Number.isFinite(microseconds) || microseconds < 0)
        return '0:00';

    const totalSeconds = Math.floor(microseconds / 1_000_000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:` +
            seconds.toString().padStart(2, '0');
    }

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
