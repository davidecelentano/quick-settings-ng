import {
    DisposableStore,
    type Disposable,
} from '../../core/disposable.js';

import {
    MprisDiscovery,
} from './mpris-discovery.js';

import {
    MprisPlayer,
    type MprisPlayerSnapshot,
} from './mpris-player.js';

export type MprisPlayerStoreListener =
    (players: readonly MprisPlayerSnapshot[]) => void;

interface PlayerEntry {
    readonly player: MprisPlayer;
    readonly lifetime: DisposableStore;
}

/**
 * Owns the set of live MPRIS player models.
 *
 * Discovery and per-player state are deliberately separated:
 * - MprisDiscovery only tracks bus-name lifetime
 * - MprisPlayer owns one player's properties and commands
 * - MprisPlayerStore reconciles the two without leaking signals/calls
 */
export class MprisPlayerStore implements Disposable {
    #lifetime = new DisposableStore();

    #entries = new Map<string, PlayerEntry>();
    #snapshots = new Map<string, MprisPlayerSnapshot>();
    #listeners = new Set<MprisPlayerStoreListener>();

    #started = false;
    #ready = false;
    #disposed = false;

    get players(): readonly MprisPlayerSnapshot[] {
        return Array.from(this.#snapshots.values())
            .sort((a, b) =>
                a.serviceName.localeCompare(b.serviceName));
    }

    start(): void {
        this.#assertAlive();

        if (this.#started)
            return;

        this.#started = true;

        const discovery =
            this.#lifetime.add(new MprisDiscovery());

        this.#lifetime.add(
            discovery.subscribe(serviceNames => {
                this.#reconcile(serviceNames);
            }),
        );

        discovery.start();
    }

    subscribe(listener: MprisPlayerStoreListener): Disposable {
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

    getPlayer(serviceName: string): MprisPlayer | null {
        return this.#entries.get(serviceName)?.player ?? null;
    }

    /**
     * Toggle one player while keeping QSNG-initiated playback exclusive.
     *
     * If the target is already playing, it is paused. Otherwise every other
     * controllable player that is currently playing is paused first, then the
     * target is started. A player that cannot be paused is left untouched and
     * reported, rather than risking a destructive fallback such as Stop().
     */
    async toggleExclusivePlayback(serviceName: string): Promise<void> {
        this.#assertAlive();

        const targetEntry = this.#entries.get(serviceName);

        if (targetEntry === undefined)
            return;

        const target = targetEntry.player;
        const targetSnapshot = target.snapshot;

        if (targetSnapshot.playbackStatus === 'Playing') {
            await target.pause();
            return;
        }

        const pauses: Promise<void>[] = [];

        for (const [otherServiceName, entry] of this.#entries) {
            if (otherServiceName === serviceName)
                continue;

            const snapshot = entry.player.snapshot;

            if (snapshot.playbackStatus !== 'Playing')
                continue;

            if (!snapshot.canControl || !snapshot.canPause) {
                console.warn(
                    `[QSNG] media: cannot pause active player ${otherServiceName}`,
                );
                continue;
            }

            pauses.push(entry.player.pause());
        }

        if (pauses.length > 0)
            await Promise.allSettled(pauses);

        if (this.#disposed)
            return;

        const currentTarget = this.#entries.get(serviceName)?.player;

        if (currentTarget !== target)
            return;

        await target.play();
    }

    dispose(): void {
        if (this.#disposed)
            return;

        this.#disposed = true;
        this.#ready = false;

        this.#lifetime.dispose();

        for (const entry of this.#entries.values())
            entry.lifetime.dispose();

        this.#entries.clear();
        this.#snapshots.clear();
        this.#listeners.clear();
    }

    #reconcile(serviceNames: readonly string[]): void {
        if (this.#disposed)
            return;

        const wanted = new Set(serviceNames);
        let visibleChanged = false;

        for (const [serviceName, entry] of this.#entries) {
            if (wanted.has(serviceName))
                continue;

            entry.lifetime.dispose();
            this.#entries.delete(serviceName);

            if (this.#snapshots.delete(serviceName))
                visibleChanged = true;
        }

        for (const serviceName of serviceNames) {
            if (this.#entries.has(serviceName))
                continue;

            this.#addPlayer(serviceName);
        }

        const becameReady = !this.#ready;
        this.#ready = true;

        if (visibleChanged || becameReady)
            this.#emit();
    }

    #addPlayer(serviceName: string): void {
        const lifetime = new DisposableStore();
        const player = lifetime.add(new MprisPlayer(serviceName));

        lifetime.add(
            player.subscribe(snapshot => {
                if (this.#disposed)
                    return;

                this.#snapshots.set(serviceName, snapshot);
                this.#emit();
            }),
        );

        this.#entries.set(serviceName, {
            player,
            lifetime,
        });

        try {
            player.start();
        } catch (error) {
            this.#entries.delete(serviceName);
            lifetime.dispose();

            console.error(
                `[QSNG] media: failed starting MPRIS player ${serviceName}`,
                error,
            );
        }
    }

    #emit(): void {
        for (const listener of this.#listeners)
            this.#notifyListener(listener);
    }

    #notifyListener(listener: MprisPlayerStoreListener): void {
        try {
            listener(this.players);
        } catch (error) {
            console.error(
                '[QSNG] media: player-store listener failed',
                error,
            );
        }
    }

    #assertAlive(): void {
        if (this.#disposed) {
            throw new Error(
                'MprisPlayerStore has already been disposed',
            );
        }
    }
}
