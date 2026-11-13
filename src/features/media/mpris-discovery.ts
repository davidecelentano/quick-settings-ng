import Gio from 'gi://Gio';

import {
    DisposableStore,
    type Disposable,
} from '../../core/disposable.js';

const DBUS_SERVICE = 'org.freedesktop.DBus';
const DBUS_PATH = '/org/freedesktop/DBus';
const DBUS_INTERFACE = 'org.freedesktop.DBus';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

export type MprisPlayersListener =
    (players: readonly string[]) => void;

/**
 * Discovers MPRIS players on the session bus.
 *
 * This class deliberately has no dependency on GNOME Shell UI internals.
 *
 * Startup is race-safe:
 * - NameOwnerChanged is subscribed before ListNames
 * - ownership changes received during initial discovery are remembered
 * - the pending state is reconciled after ListNames completes
 */
export class MprisDiscovery implements Disposable {
    #lifetime = new DisposableStore();
    #cancellable = new Gio.Cancellable();

    #players = new Set<string>();
    #listeners = new Set<MprisPlayersListener>();

    #pendingOwnership = new Map<string, boolean>();

    #started = false;
    #initializing = false;
    #ready = false;
    #disposed = false;

    get players(): readonly string[] {
        return Array.from(this.#players).sort();
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

        const signalId = Gio.DBus.session.signal_subscribe(
            DBUS_SERVICE,
            DBUS_INTERFACE,
            'NameOwnerChanged',
            DBUS_PATH,
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
                this.#onNameOwnerChanged(parameters);
            },
        );

        this.#lifetime.defer(() => {
            Gio.DBus.session.signal_unsubscribe(signalId);
        });

        void this.#loadInitialPlayers();
    }

    subscribe(listener: MprisPlayersListener): Disposable {
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

    dispose(): void {
        if (this.#disposed)
            return;

        this.#disposed = true;
        this.#initializing = false;
        this.#ready = false;

        this.#lifetime.dispose();

        this.#listeners.clear();
        this.#pendingOwnership.clear();
        this.#players.clear();
    }

    async #loadInitialPlayers(): Promise<void> {
        try {
            const reply = await Gio.DBus.session.call(
                DBUS_SERVICE,
                DBUS_PATH,
                DBUS_INTERFACE,
                'ListNames',
                null,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                this.#cancellable,
            );

            if (this.#disposed)
                return;

            const unpacked = reply.deepUnpack();

            if (
                !Array.isArray(unpacked) ||
                !Array.isArray(unpacked[0])
            ) {
                throw new Error(
                    'Unexpected org.freedesktop.DBus.ListNames reply',
                );
            }

            this.#players.clear();

            for (const name of unpacked[0]) {
                if (
                    typeof name === 'string' &&
                    name.startsWith(MPRIS_PREFIX)
                ) {
                    this.#players.add(name);
                }
            }

            /*
             * Reconcile NameOwnerChanged events that happened after
             * subscribing but before ListNames returned.
             */
            for (const [name, present] of this.#pendingOwnership) {
                if (present)
                    this.#players.add(name);
                else
                    this.#players.delete(name);
            }

            this.#pendingOwnership.clear();
            this.#initializing = false;
            this.#ready = true;

            this.#emit();
        } catch (error) {
            if (this.#disposed || this.#cancellable.is_cancelled())
                return;

            this.#initializing = false;

            console.error(
                '[QSNG] media: MPRIS discovery failed',
                error,
            );
        }
    }

    #onNameOwnerChanged(parameters: import('gi://GLib').default.Variant): void {
        if (this.#disposed)
            return;

        const unpacked = parameters.deepUnpack();

        if (
            !Array.isArray(unpacked) ||
            unpacked.length < 3
        ) {
            return;
        }

        const [name, oldOwner, newOwner] = unpacked;

        if (
            typeof name !== 'string' ||
            typeof oldOwner !== 'string' ||
            typeof newOwner !== 'string' ||
            !name.startsWith(MPRIS_PREFIX)
        ) {
            return;
        }

        const present = newOwner.length > 0;

        if (this.#initializing) {
            this.#pendingOwnership.set(name, present);
            return;
        }

        /*
         * A well-known name can move directly from one unique owner to
         * another without becoming unowned. Force a remove/add cycle so
         * consumers recreate any per-owner D-Bus state instead of keeping
         * a stale player model alive.
         */
        if (
            oldOwner.length > 0 &&
            newOwner.length > 0 &&
            this.#players.has(name)
        ) {
            this.#players.delete(name);
            this.#emit();

            this.#players.add(name);
            this.#emit();
            return;
        }

        const changed = present
            ? this.#add(name)
            : this.#remove(name);

        if (changed)
            this.#emit();
    }

    #add(name: string): boolean {
        if (this.#players.has(name))
            return false;

        this.#players.add(name);
        return true;
    }

    #remove(name: string): boolean {
        return this.#players.delete(name);
    }

    #emit(): void {
        for (const listener of this.#listeners)
            this.#notifyListener(listener);
    }

    #notifyListener(listener: MprisPlayersListener): void {
        try {
            listener(this.players);
        } catch (error) {
            console.error(
                '[QSNG] media: MPRIS listener failed',
                error,
            );
        }
    }

    #assertAlive(): void {
        if (this.#disposed)
            throw new Error('MprisDiscovery has already been disposed');
    }
}
