import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    MprisPlayer,
} from '../dist/features/media/mpris-player.js';

const SERVICE_NAME = 'org.mpris.MediaPlayer2.QSNGTest';

/*
 * GNOME Shell promisifies Gio.DBusConnection.call() during environment
 * initialization. Standalone gjs does not, so mirror the Shell environment
 * here before the model performs asynchronous D-Bus calls.
 */
Gio._promisify(
    Gio.DBusConnection.prototype,
    'call',
    'call_finish',
);

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function waitUntil(predicate, description, timeoutMs = 3000) {
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

const player = new MprisPlayer(SERVICE_NAME);
let snapshot = null;

const subscription = player.subscribe(next => {
    snapshot = next;

    print(
        `[TEST] ${next.playbackStatus} | ` +
        `${next.title} | ${next.artists.join(', ')}`,
    );
});

try {
    player.start();

    await waitUntil(
        () => snapshot !== null,
        'initial MPRIS snapshot',
    );

    assert(snapshot.title === 'QSNG Mock Track 1', 'initial title mismatch');
    assert(snapshot.playbackStatus === 'Paused', 'initial playback state mismatch');
    assert(snapshot.canControl, 'CanControl should be true');
    assert(snapshot.canPlay, 'CanPlay should be true');
    assert(snapshot.canPause, 'CanPause should be true');
    assert(snapshot.canGoNext, 'CanGoNext should be true');
    assert(snapshot.canGoPrevious, 'CanGoPrevious should be true');
    assert(snapshot.canSeek, 'CanSeek should be true');
    assert(snapshot.lengthUs === 180_000_000, 'track length mismatch');
    assert(snapshot.positionUs === 12_000_000, 'initial position mismatch');
    assert(player.estimatedPositionUs === 12_000_000, 'estimated initial position mismatch');

    await player.playPause();
    await waitUntil(
        () => snapshot?.playbackStatus === 'Playing',
        'PlayPause -> Playing',
    );

    const playingPositionUs = player.estimatedPositionUs;
    await new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
    assert(
        player.estimatedPositionUs !== null &&
        playingPositionUs !== null &&
        player.estimatedPositionUs > playingPositionUs,
        'playing position should advance locally',
    );

    await player.next();
    await waitUntil(
        () => snapshot?.title === 'QSNG Mock Track 2',
        'Next metadata update',
    );

    await player.previous();
    await waitUntil(
        () => snapshot?.title === 'QSNG Mock Track 1',
        'Previous metadata update',
    );

    await player.setPosition(90_000_000);
    await waitUntil(
        () => snapshot?.positionUs === 90_000_000,
        'SetPosition -> 90 seconds',
    );

    await player.seek(5_000_000);
    await waitUntil(
        () => snapshot?.positionUs !== null &&
            snapshot.positionUs >= 95_000_000 &&
            snapshot.positionUs < 96_000_000,
        'Seek +5 seconds',
    );

    print('[TEST] PASS: MPRIS player model, position tracking and commands');
} finally {
    subscription.dispose();
    player.dispose();
}
