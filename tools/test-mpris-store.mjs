import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    MprisPlayerStore,
} from '../dist/features/media/mpris-player-store.js';

Gio._promisify(
    Gio.DBusConnection.prototype,
    'call',
    'call_finish',
);

const FIRST = 'org.mpris.MediaPlayer2.QSNGTest';
const SECOND = 'org.mpris.MediaPlayer2.QSNGTestTwo';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function waitUntil(predicate, description, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const startedUs = GLib.get_monotonic_time();

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 25, () => {
            try {
                if (predicate()) {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                }
            } catch (error) {
                reject(error);
                return GLib.SOURCE_REMOVE;
            }

            const elapsedMs =
                (GLib.get_monotonic_time() - startedUs) / 1000;

            if (elapsedMs >= timeoutMs) {
                reject(new Error(`Timed out waiting for ${description}`));
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        });
    });
}

const store = new MprisPlayerStore();
let snapshots = [];

const subscription = store.subscribe(next => {
    snapshots = next;
});

try {
    store.start();

    await waitUntil(
        () => snapshots.length === 2,
        'two ready MPRIS players',
    );

    if (store.getPlayer(FIRST)?.snapshot.playbackStatus !== 'Playing') {
        await store.toggleExclusivePlayback(FIRST);
        await waitUntil(
            () => store.getPlayer(FIRST)?.snapshot.playbackStatus === 'Playing',
            'first player playing',
        );
    }

    await store.toggleExclusivePlayback(SECOND);
    await waitUntil(
        () =>
            store.getPlayer(FIRST)?.snapshot.playbackStatus === 'Paused' &&
            store.getPlayer(SECOND)?.snapshot.playbackStatus === 'Playing',
        'exclusive switch to second player',
    );

    await store.toggleExclusivePlayback(FIRST);
    await waitUntil(
        () =>
            store.getPlayer(FIRST)?.snapshot.playbackStatus === 'Playing' &&
            store.getPlayer(SECOND)?.snapshot.playbackStatus === 'Paused',
        'exclusive switch back to first player',
    );

    await store.toggleExclusivePlayback(FIRST);
    await waitUntil(
        () => store.getPlayer(FIRST)?.snapshot.playbackStatus === 'Paused',
        'first player paused',
    );

    assert(
        store.getPlayer(SECOND)?.snapshot.playbackStatus === 'Paused',
        'second player should remain paused',
    );

    print('[TEST] PASS: MPRIS exclusive playback switching');
} finally {
    subscription.dispose();
    store.dispose();
}
