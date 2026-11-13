import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';

const MOCK_SUFFIX = GLib.getenv('QSNG_MOCK_SUFFIX') ?? '';
const SERVICE_NAME = `org.mpris.MediaPlayer2.QSNGTest${MOCK_SUFFIX}`;
const DISPLAY_SUFFIX = MOCK_SUFFIX ? ` ${MOCK_SUFFIX}` : '';
const OBJECT_PATH = '/org/mpris/MediaPlayer2';

const PLAYER_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek">
      <arg direction="in" name="Offset" type="x"/>
    </method>
    <method name="SetPosition">
      <arg direction="in" name="TrackId" type="o"/>
      <arg direction="in" name="Position" type="x"/>
    </method>

    <signal name="Seeked">
      <arg name="Position" type="x"/>
    </signal>

    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>`;

class MockPlayer {
    _impl = null;
    _playbackStatus = 'Paused';
    _track = 1;
    _positionUs = 12_000_000;
    _positionUpdatedAtUs = GLib.get_monotonic_time();

    get PlaybackStatus() {
        return this._playbackStatus;
    }

    get Metadata() {
        return this._metadataVariant();
    }

    get Position() {
        return this._currentPositionUs();
    }

    get CanGoNext() {
        return true;
    }

    get CanGoPrevious() {
        return true;
    }

    get CanPlay() {
        return true;
    }

    get CanPause() {
        return true;
    }

    get CanSeek() {
        return true;
    }

    get CanControl() {
        return true;
    }

    PlayPause() {
        this._setPlaybackStatus(
            this._playbackStatus === 'Playing'
                ? 'Paused'
                : 'Playing',
        );

        print(`[MOCK] PlayPause -> ${this._playbackStatus}`);
    }

    Play() {
        this._setPlaybackStatus('Playing');
        print('[MOCK] Play');
    }

    Pause() {
        this._setPlaybackStatus('Paused');
        print('[MOCK] Pause');
    }

    Stop() {
        this._storeCurrentPosition();
        this._positionUs = 0;
        this._positionUpdatedAtUs = GLib.get_monotonic_time();
        this._setPlaybackStatus('Stopped');
        this._emitSeeked();
        print('[MOCK] Stop');
    }

    Next() {
        this._track += 1;
        this._positionUs = 0;
        this._positionUpdatedAtUs = GLib.get_monotonic_time();
        this._emitMetadata();
        this._emitSeeked();
        print(`[MOCK] Next -> track ${this._track}`);
    }

    Previous() {
        this._track = Math.max(1, this._track - 1);
        this._positionUs = 0;
        this._positionUpdatedAtUs = GLib.get_monotonic_time();
        this._emitMetadata();
        this._emitSeeked();
        print(`[MOCK] Previous -> track ${this._track}`);
    }

    Seek(offsetUs) {
        this._storeCurrentPosition();
        this._positionUs = Math.max(
            0,
            Math.min(180_000_000, this._positionUs + Number(offsetUs)),
        );
        this._positionUpdatedAtUs = GLib.get_monotonic_time();
        this._emitSeeked();
        print(`[MOCK] Seek -> ${offsetUs}; position ${this._positionUs}`);
    }

    SetPosition(trackId, positionUs) {
        const expectedTrackId =
            `/org/mpris/MediaPlayer2/Track/${this._track}`;

        if (trackId !== expectedTrackId) {
            print(`[MOCK] SetPosition ignored stale track ${trackId}`);
            return;
        }

        const requested = Number(positionUs);

        if (requested < 0 || requested > 180_000_000)
            return;

        this._positionUs = requested;
        this._positionUpdatedAtUs = GLib.get_monotonic_time();
        this._emitSeeked();
        print(`[MOCK] SetPosition -> ${this._positionUs}`);
    }

    _setPlaybackStatus(status) {
        if (this._playbackStatus === status)
            return;

        this._storeCurrentPosition();
        this._playbackStatus = status;
        this._positionUpdatedAtUs = GLib.get_monotonic_time();

        this._impl?.emit_property_changed(
            'PlaybackStatus',
            GLib.Variant.new_string(status),
        );
    }

    _currentPositionUs() {
        let positionUs = this._positionUs;

        if (this._playbackStatus === 'Playing') {
            positionUs += Math.max(
                0,
                GLib.get_monotonic_time() - this._positionUpdatedAtUs,
            );
        }

        return Math.max(0, Math.min(180_000_000, positionUs));
    }

    _storeCurrentPosition() {
        this._positionUs = this._currentPositionUs();
        this._positionUpdatedAtUs = GLib.get_monotonic_time();
    }

    _emitSeeked() {
        this._impl?.emit_signal(
            'Seeked',
            new GLib.Variant('(x)', [this._positionUs]),
        );
    }

    _emitMetadata() {
        this._impl?.emit_property_changed(
            'Metadata',
            this._metadataVariant(),
        );
    }

    _metadataVariant() {
        return new GLib.Variant('a{sv}', {
            'mpris:trackid': new GLib.Variant(
                'o',
                `/org/mpris/MediaPlayer2/Track/${this._track}`,
            ),
            'mpris:length': GLib.Variant.new_int64(180_000_000),
            'mpris:artUrl': GLib.Variant.new_string(
                `file:///tmp/qsng-mock-cover-${MOCK_SUFFIX || 'Main'}-${this._track}.svg`,
            ),
            'xesam:title': GLib.Variant.new_string(
                `QSNG Mock${DISPLAY_SUFFIX} Track ${this._track}`,
            ),
            'xesam:artist': GLib.Variant.new_strv([
                `QSNG Test Artist${DISPLAY_SUFFIX}`,
            ]),
            'xesam:album': GLib.Variant.new_string(
                'QSNG Test Album',
            ),
        });
    }
}


function ensureMockArtwork() {
    for (let track = 1; track <= 4; track++) {
        const path = `/tmp/qsng-mock-cover-${MOCK_SUFFIX || 'Main'}-${track}.svg`;
        const hue = (track * 73 + MOCK_SUFFIX.length * 31) % 360;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
            `<rect width="128" height="128" rx="20" fill="hsl(${hue},55%,42%)"/>` +
            `<circle cx="64" cy="64" r="31" fill="rgba(255,255,255,0.18)"/>` +
            `<text x="64" y="72" font-size="30" text-anchor="middle" fill="white">${track}</text>` +
            `</svg>`;
        GLib.file_set_contents(path, svg);
    }
}

ensureMockArtwork();

const loop = new GLib.MainLoop(null, false);
let exportedObject = null;
let player = null;

const ownerId = Gio.bus_own_name(
    Gio.BusType.SESSION,
    SERVICE_NAME,
    Gio.BusNameOwnerFlags.NONE,
    connection => {
        player = new MockPlayer();
        exportedObject = Gio.DBusExportedObject.wrapJSObject(
            PLAYER_XML,
            player,
        );

        player._impl = exportedObject;
        exportedObject.export(connection, OBJECT_PATH);
    },
    () => {
        print(`[MOCK] acquired ${SERVICE_NAME}`);
    },
    () => {
        printerr(`[MOCK] lost ${SERVICE_NAME}`);
        loop.quit();
    },
);

function shutdown() {
    exportedObject?.unexport();
    Gio.bus_unown_name(ownerId);
    loop.quit();
    return GLib.SOURCE_REMOVE;
}

GLibUnix.signal_add(
    GLib.PRIORITY_DEFAULT,
    2,
    shutdown,
);

GLibUnix.signal_add(
    GLib.PRIORITY_DEFAULT,
    15,
    shutdown,
);

loop.run();
