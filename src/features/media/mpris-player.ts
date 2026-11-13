import {
    reportError,
} from '../../core/log.js';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    DisposableStore,
    type Disposable,
} from '../../core/disposable.js';

const OBJECT_PATH = '/org/mpris/MediaPlayer2';

const PLAYER_INTERFACE =
    'org.mpris.MediaPlayer2.Player';

const PROPERTIES_INTERFACE =
    'org.freedesktop.DBus.Properties';

export type PlaybackStatus =
    | 'Playing'
    | 'Paused'
    | 'Stopped';

export interface MprisPlayerSnapshot {
    readonly serviceName: string;

    readonly playbackStatus: PlaybackStatus;

    readonly title: string;
    readonly artists: readonly string[];
    readonly album: string;

    readonly artUrl: string | null;
    readonly trackId: string | null;
    readonly lengthUs: number | null;
    readonly positionUs: number | null;

    readonly canControl: boolean;
    readonly canPlay: boolean;
    readonly canPause: boolean;
    readonly canGoNext: boolean;
    readonly canGoPrevious: boolean;
    readonly canSeek: boolean;
}

export type MprisPlayerListener =
    (snapshot: MprisPlayerSnapshot) => void;

type MutableMprisPlayerSnapshot = {
    -readonly [K in keyof MprisPlayerSnapshot]:
        MprisPlayerSnapshot[K];
};

interface PendingPropertiesChange {
    readonly changed: unknown;
    readonly invalidated: readonly string[];
}

/**
 * Represents one MPRIS player.
 *
 * Responsibilities:
 * - initial property discovery
 * - PropertiesChanged handling
 * - metadata normalization
 * - capability tracking
 * - playback commands
 * - cancellation and deterministic cleanup
 *
 * No GNOME Shell UI dependencies belong in this class.
 */
export class MprisPlayer implements Disposable {
    readonly serviceName: string;

    #lifetime = new DisposableStore();
    #cancellable = new Gio.Cancellable();

    #listeners = new Set<MprisPlayerListener>();
    #pendingChanges: PendingPropertiesChange[] = [];

    #started = false;
    #initializing = false;
    #ready = false;
    #disposed = false;

    #positionUpdatedAtUs = GLib.get_monotonic_time();

    #state: MprisPlayerSnapshot;

    constructor(serviceName: string) {
        this.serviceName = serviceName;

        this.#state = {
            serviceName,

            playbackStatus: 'Stopped',

            title: '',
            artists: [],
            album: '',

            artUrl: null,
            trackId: null,
            lengthUs: null,
            positionUs: null,

            canControl: false,
            canPlay: false,
            canPause: false,
            canGoNext: false,
            canGoPrevious: false,
            canSeek: false,
        };
    }

    get ready(): boolean {
        return this.#ready;
    }

    get snapshot(): MprisPlayerSnapshot {
        return {
            ...this.#state,
            artists: [...this.#state.artists],
        };
    }

    get estimatedPositionUs(): number | null {
        const positionUs = this.#state.positionUs;

        if (positionUs === null)
            return null;

        let estimated = positionUs;

        if (this.#state.playbackStatus === 'Playing') {
            estimated += Math.max(
                0,
                GLib.get_monotonic_time() - this.#positionUpdatedAtUs,
            );
        }

        const lengthUs = this.#state.lengthUs;

        if (lengthUs !== null)
            estimated = Math.min(estimated, lengthUs);

        return Math.max(0, estimated);
    }

    start(): void {
        this.#assertAlive();

        if (this.#started)
            return;

        this.#started = true;
        this.#initializing = true;

        this.#lifetime.defer(() => {
            this.#cancellable.cancel();
        });

        /*
         * Subscribe before GetAll so property changes occurring during
         * initial discovery cannot be silently lost.
         */
        const signalId = Gio.DBus.session.signal_subscribe(
            this.serviceName,
            PROPERTIES_INTERFACE,
            'PropertiesChanged',
            OBJECT_PATH,
            PLAYER_INTERFACE,
            Gio.DBusSignalFlags.NONE,
            (
                _connection,
                _senderName,
                _objectPath,
                _interfaceName,
                _signalName,
                parameters,
            ) => {
                this.#onPropertiesChanged(parameters);
            },
        );

        this.#lifetime.defer(() => {
            Gio.DBus.session.signal_unsubscribe(signalId);
        });

        const seekedSignalId = Gio.DBus.session.signal_subscribe(
            this.serviceName,
            PLAYER_INTERFACE,
            'Seeked',
            OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (
                _connection,
                _senderName,
                _objectPath,
                _interfaceName,
                _signalName,
                parameters,
            ) => {
                this.#onSeeked(parameters);
            },
        );

        this.#lifetime.defer(() => {
            Gio.DBus.session.signal_unsubscribe(seekedSignalId);
        });

        void this.#loadInitialProperties();
    }

    subscribe(listener: MprisPlayerListener): Disposable {
        this.#assertAlive();

        this.#listeners.add(listener);

        if (this.#ready)
            this.#notifyListener(listener);

        return {
            dispose: () => {
                this.#listeners.delete(listener);
            },
        };
    }

    async playPause(): Promise<void> {
        if (
            !this.#state.canControl ||
            (!this.#state.canPlay && !this.#state.canPause)
        ) {
            return;
        }

        await this.#callPlayerMethod('PlayPause');
    }

    async play(): Promise<void> {
        if (!this.#state.canControl || !this.#state.canPlay)
            return;

        await this.#callPlayerMethod('Play');
    }

    async pause(): Promise<void> {
        if (!this.#state.canControl || !this.#state.canPause)
            return;

        await this.#callPlayerMethod('Pause');
    }

    async next(): Promise<void> {
        if (
            !this.#state.canControl ||
            !this.#state.canGoNext
        ) {
            return;
        }

        await this.#callPlayerMethod('Next');
    }

    async previous(): Promise<void> {
        if (
            !this.#state.canControl ||
            !this.#state.canGoPrevious
        ) {
            return;
        }

        await this.#callPlayerMethod('Previous');
    }

    async seek(offsetUs: number): Promise<void> {
        if (
            !this.#state.canControl ||
            !this.#state.canSeek ||
            !Number.isFinite(offsetUs)
        ) {
            return;
        }

        const offset = Math.trunc(offsetUs);

        try {
            await Gio.DBus.session.call(
                this.serviceName,
                OBJECT_PATH,
                PLAYER_INTERFACE,
                'Seek',
                new GLib.Variant('(x)', [offset]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                this.#cancellable,
            );
        } catch (error) {
            this.#handleCallError('Seek', error);
        }
    }

    async setPosition(
        positionUs: number,
        expectedTrackId?: string,
    ): Promise<void> {
        const trackId = expectedTrackId ?? this.#state.trackId;
        const lengthUs = this.#state.lengthUs;

        if (
            !this.#state.canControl ||
            !this.#state.canSeek ||
            trackId === null ||
            (
                expectedTrackId !== undefined &&
                expectedTrackId !== this.#state.trackId
            ) ||
            !Number.isFinite(positionUs)
        ) {
            return;
        }

        const maximum = lengthUs ?? Number.MAX_SAFE_INTEGER;
        const position = Math.trunc(
            Math.max(0, Math.min(positionUs, maximum)),
        );

        try {
            await Gio.DBus.session.call(
                this.serviceName,
                OBJECT_PATH,
                PLAYER_INTERFACE,
                'SetPosition',
                new GLib.Variant('(ox)', [trackId, position]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                this.#cancellable,
            );

            if (!this.#disposed)
                this.#setPosition(position, true);
        } catch (error) {
            this.#handleCallError('SetPosition', error);
        }
    }

    dispose(): void {
        if (this.#disposed)
            return;

        this.#disposed = true;
        this.#initializing = false;
        this.#ready = false;

        this.#lifetime.dispose();

        this.#listeners.clear();
        this.#pendingChanges.length = 0;
    }

    async #loadInitialProperties(): Promise<void> {
        try {
            const reply = await this.#getAllProperties();

            if (this.#disposed)
                return;

            this.#applyProperties(reply);

            /*
             * Apply changes received while GetAll was pending.
             */
            let requiresRefresh = false;

            for (const pending of this.#pendingChanges) {
                this.#applyProperties(pending.changed);

                if (this.#hasRelevantInvalidation(pending.invalidated))
                    requiresRefresh = true;
            }

            this.#pendingChanges.length = 0;
            this.#initializing = false;
            this.#ready = true;

            this.#emit();

            if (requiresRefresh)
                void this.#refreshProperties();

            if (this.#state.positionUs === null)
                void this.#refreshPosition();
        } catch (error) {
            if (
                this.#disposed ||
                this.#cancellable.is_cancelled()
            ) {
                return;
            }

            this.#initializing = false;

            reportError(
                `[QSNG] media: failed loading MPRIS player ${this.serviceName}`,
                error,
            );
        }
    }

    #onPropertiesChanged(
        parameters: GLib.Variant,
    ): void {
        if (this.#disposed)
            return;

        const unpacked = parameters.deepUnpack();

        if (
            !Array.isArray(unpacked) ||
            unpacked.length < 3
        ) {
            return;
        }

        const [
            interfaceName,
            changed,
            invalidatedRaw,
        ] = unpacked;

        if (interfaceName !== PLAYER_INTERFACE)
            return;

        const invalidated =
            Array.isArray(invalidatedRaw)
                ? invalidatedRaw.filter(
                    (value): value is string =>
                        typeof value === 'string',
                )
                : [];

        if (this.#initializing) {
            this.#pendingChanges.push({
                changed,
                invalidated,
            });

            return;
        }

        const changedRecord = asRecord(changed);
        const shouldRefreshPosition =
            changedRecord !== null &&
            (
                'PlaybackStatus' in changedRecord ||
                'Metadata' in changedRecord
            );

        const changedState =
            this.#applyProperties(changed);

        if (changedState)
            this.#emit();

        if (this.#hasRelevantInvalidation(invalidated))
            void this.#refreshProperties();

        if (shouldRefreshPosition || invalidated.includes('Position'))
            void this.#refreshPosition();
    }

    #onSeeked(parameters: GLib.Variant): void {
        if (this.#disposed)
            return;

        const unpacked = parameters.deepUnpack();

        if (!Array.isArray(unpacked) || unpacked.length < 1)
            return;

        const positionUs = readFiniteNumber(unpacked[0]);

        if (positionUs !== null)
            this.#setPosition(positionUs, true);
    }

    async #refreshProperties(): Promise<void> {
        try {
            const properties =
                await this.#getAllProperties();

            if (this.#disposed)
                return;

            if (this.#applyProperties(properties))
                this.#emit();
        } catch (error) {
            if (
                this.#disposed ||
                this.#cancellable.is_cancelled()
            ) {
                return;
            }

            reportError(
                `[QSNG] media: failed refreshing MPRIS player ${this.serviceName}`,
                error,
            );
        }
    }

    async #refreshPosition(): Promise<void> {
        try {
            const reply = await Gio.DBus.session.call(
                this.serviceName,
                OBJECT_PATH,
                PROPERTIES_INTERFACE,
                'Get',
                new GLib.Variant(
                    '(ss)',
                    [PLAYER_INTERFACE, 'Position'],
                ),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                this.#cancellable,
            );

            if (this.#disposed)
                return;

            const unpacked = reply.deepUnpack();

            if (!Array.isArray(unpacked) || unpacked.length < 1)
                return;

            const positionUs = readFiniteNumber(unpacked[0]);

            if (positionUs !== null)
                this.#setPosition(positionUs, true);
        } catch (error) {
            if (
                this.#disposed ||
                this.#cancellable.is_cancelled()
            ) {
                return;
            }

            reportError(
                `[QSNG] media: failed refreshing position for ${this.serviceName}`,
                error,
            );
        }
    }

    async #getAllProperties(): Promise<unknown> {
        const reply = await Gio.DBus.session.call(
            this.serviceName,
            OBJECT_PATH,
            PROPERTIES_INTERFACE,
            'GetAll',
            new GLib.Variant(
                '(s)',
                [PLAYER_INTERFACE],
            ),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            this.#cancellable,
        );

        const unpacked = reply.deepUnpack();

        if (
            !Array.isArray(unpacked) ||
            unpacked.length < 1
        ) {
            throw new Error(
                'Unexpected org.freedesktop.DBus.Properties.GetAll reply',
            );
        }

        return unpacked[0];
    }

    #applyProperties(raw: unknown): boolean {
        const properties = asRecord(raw);

        if (properties === null)
            return false;

        const previousState = this.#state;
        const previousEstimatedPositionUs = this.estimatedPositionUs;

        const next: MutableMprisPlayerSnapshot = {
            ...previousState,
            artists: [...previousState.artists],
        };

        if ('PlaybackStatus' in properties) {
            next.playbackStatus =
                readPlaybackStatus(
                    properties.PlaybackStatus,
                );

            if (
                previousEstimatedPositionUs !== null &&
                previousState.playbackStatus !== next.playbackStatus
            ) {
                next.positionUs = previousEstimatedPositionUs;
            }
        }

        if ('CanControl' in properties) {
            next.canControl =
                readBoolean(properties.CanControl);
        }

        if ('CanPlay' in properties) {
            next.canPlay =
                readBoolean(properties.CanPlay);
        }

        if ('CanPause' in properties) {
            next.canPause =
                readBoolean(properties.CanPause);
        }

        if ('CanGoNext' in properties) {
            next.canGoNext =
                readBoolean(properties.CanGoNext);
        }

        if ('CanGoPrevious' in properties) {
            next.canGoPrevious =
                readBoolean(properties.CanGoPrevious);
        }

        if ('CanSeek' in properties) {
            next.canSeek =
                readBoolean(properties.CanSeek);
        }

        if ('Metadata' in properties) {
            const metadata =
                asRecord(
                    unpackValue(properties.Metadata),
                );

            next.title =
                readString(
                    metadata?.['xesam:title'],
                ) ?? '';

            next.artists =
                readStringArray(
                    metadata?.['xesam:artist'],
                );

            next.album =
                readString(
                    metadata?.['xesam:album'],
                ) ?? '';

            next.artUrl =
                readString(
                    metadata?.['mpris:artUrl'],
                );

            next.trackId =
                readString(
                    metadata?.['mpris:trackid'],
                );

            next.lengthUs =
                readFiniteNumber(
                    metadata?.['mpris:length'],
                );

            if (next.trackId !== previousState.trackId)
                next.positionUs = 0;
        }

        if ('Position' in properties) {
            next.positionUs =
                readFiniteNumber(properties.Position);
        }

        const changed =
            JSON.stringify(next) !==
            JSON.stringify(previousState);

        if (changed) {
            this.#state = next;

            if (next.positionUs !== previousState.positionUs ||
                next.playbackStatus !== previousState.playbackStatus ||
                next.trackId !== previousState.trackId) {
                this.#positionUpdatedAtUs = GLib.get_monotonic_time();
            }
        }

        return changed;
    }

    #hasRelevantInvalidation(
        invalidated: readonly string[],
    ): boolean {
        return invalidated.some(property =>
            property === 'PlaybackStatus' ||
            property === 'Metadata' ||
            property === 'CanControl' ||
            property === 'CanPlay' ||
            property === 'CanPause' ||
            property === 'CanGoNext' ||
            property === 'CanGoPrevious' ||
            property === 'CanSeek' ||
            property === 'Position'
        );
    }

    #setPosition(
        positionUs: number,
        emit: boolean,
    ): void {
        const lengthUs = this.#state.lengthUs;
        const clamped = Math.max(
            0,
            Math.min(positionUs, lengthUs ?? Number.MAX_SAFE_INTEGER),
        );

        const changed = this.#state.positionUs !== clamped;

        this.#state = {
            ...this.#state,
            positionUs: clamped,
        };
        this.#positionUpdatedAtUs = GLib.get_monotonic_time();

        if (changed && emit)
            this.#emit();
    }

    async #callPlayerMethod(
        method: string,
    ): Promise<void> {
        try {
            await Gio.DBus.session.call(
                this.serviceName,
                OBJECT_PATH,
                PLAYER_INTERFACE,
                method,
                null,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                this.#cancellable,
            );
        } catch (error) {
            this.#handleCallError(method, error);
        }
    }

    #handleCallError(
        method: string,
        error: unknown,
    ): void {
        if (
            this.#disposed ||
            this.#cancellable.is_cancelled()
        ) {
            return;
        }

        reportError(
            `[QSNG] media: MPRIS ${method} failed for ${this.serviceName}`,
            error,
        );
    }

    #emit(): void {
        for (const listener of this.#listeners)
            this.#notifyListener(listener);
    }

    #notifyListener(
        listener: MprisPlayerListener,
    ): void {
        try {
            listener(this.snapshot);
        } catch (error) {
            reportError(
                `[QSNG] media: player listener failed for ${this.serviceName}`,
                error,
            );
        }
    }

    #assertAlive(): void {
        if (this.#disposed) {
            throw new Error(
                `MprisPlayer has already been disposed: ${this.serviceName}`,
            );
        }
    }
}

function unpackValue(value: unknown): unknown {
    if (
        typeof value === 'object' &&
        value !== null &&
        'deepUnpack' in value
    ) {
        const unpack =
            (value as {
                deepUnpack?: () => unknown;
            }).deepUnpack;

        if (typeof unpack === 'function')
            return unpack.call(value);
    }

    return value;
}

function asRecord(
    value: unknown,
): Record<string, unknown> | null {
    const unpacked = unpackValue(value);

    if (
        typeof unpacked !== 'object' ||
        unpacked === null ||
        Array.isArray(unpacked)
    ) {
        return null;
    }

    return unpacked as Record<string, unknown>;
}

function readString(
    value: unknown,
): string | null {
    const unpacked = unpackValue(value);

    return typeof unpacked === 'string'
        ? unpacked
        : null;
}

function readBoolean(value: unknown): boolean {
    return unpackValue(value) === true;
}

function readStringArray(
    value: unknown,
): readonly string[] {
    const unpacked = unpackValue(value);

    if (!Array.isArray(unpacked))
        return [];

    return unpacked.filter(
        (item): item is string =>
            typeof item === 'string',
    );
}

function readFiniteNumber(
    value: unknown,
): number | null {
    const unpacked = unpackValue(value);

    if (typeof unpacked === 'number')
        return Number.isFinite(unpacked)
            ? unpacked
            : null;

    if (typeof unpacked === 'bigint') {
        const result = Number(unpacked);

        return Number.isSafeInteger(result)
            ? result
            : null;
    }

    return null;
}

function readPlaybackStatus(
    value: unknown,
): PlaybackStatus {
    const unpacked = unpackValue(value);

    switch (unpacked) {
        case 'Playing':
        case 'Paused':
        case 'Stopped':
            return unpacked;

        default:
            return 'Stopped';
    }
}
