import Gio from 'gi://Gio';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {
    DisposableStore,
    type Disposable,
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

interface PrivacySettingDescriptor {
    readonly title: string;
    readonly iconName: string;
    readonly settings: Gio.Settings;
    readonly key: string;
    readonly bindFlags: Gio.SettingsBindFlags;
}

class PrivacyUi implements Disposable {
    readonly indicator: QuickSettings.SystemIndicator;

    #groupedToggle: QuickSettings.QuickMenuToggle;
    #individualToggles: QuickSettings.QuickToggle[];
    #items: Array<QuickSettings.QuickToggle | QuickSettings.QuickMenuToggle>;
    #disposed = false;

    constructor(
        indicator: QuickSettings.SystemIndicator,
        groupedToggle: QuickSettings.QuickMenuToggle,
        individualToggles: QuickSettings.QuickToggle[],
    ) {
        this.indicator = indicator;
        this.#groupedToggle = groupedToggle;
        this.#individualToggles = individualToggles;
        this.#items = [groupedToggle, ...individualToggles];
    }

    setGrouped(grouped: boolean): void {
        this.#groupedToggle.visible = grouped;

        for (const toggle of this.#individualToggles)
            toggle.visible = !grouped;
    }

    dispose(): void {
        if (this.#disposed)
            return;

        this.#disposed = true;
        this.indicator.quickSettingsItems.length = 0;

        for (const item of this.#items)
            item.destroy();

        this.#items = [];
        this.#individualToggles = [];
        this.indicator.destroy();
    }
}

/**
 * Privacy controls backed by GNOME's own desktop privacy settings.
 *
 * The implementation intentionally uses addExternalIndicator() only; it does
 * not depend on _backgroundApps, _settingsActions, _rightBox, or menu grids.
 */
export class PrivacyFeature extends Feature {
    override readonly id = 'privacy';

    #extensionSettings: Gio.Settings;
    #host: QuickSettingsHost;

    constructor(
        extensionSettings: Gio.Settings,
        host: QuickSettingsHost,
    ) {
        super();
        this.#extensionSettings = extensionSettings;
        this.#host = host;
    }

    protected override onEnable(lifetime: DisposableStore): void {
        const ui = this.#buildUi();
        const syncMode = (): void => {
            ui.setGrouped(
                this.#extensionSettings.get_boolean('privacy-grouped'),
            );
        };

        // Privacy is registered before Media at extension startup, so keep the
        // same indicator alive and only switch item visibility. This prevents
        // grouped/individual mode changes from moving Privacy below Media.
        syncMode();
        lifetime.add(
            this.#host.addIndicator(
                ui.indicator,
                QUICK_SETTINGS_ORDER.privacy,
            ),
        );

        const groupedSignal = this.#extensionSettings.connect(
            'changed::privacy-grouped',
            syncMode,
        );

        lifetime.defer(() => {
            this.#extensionSettings.disconnect(groupedSignal);
            ui.dispose();
        });
    }

    #buildUi(): PrivacyUi {
        const indicator = new QuickSettings.SystemIndicator();
        const descriptors = createPrivacyDescriptors();
        const groupedToggle = this.#createGroupedToggle(descriptors);
        const individualToggles = descriptors.map(descriptor =>
            this.#createIndividualToggle(descriptor));

        indicator.quickSettingsItems.push(
            groupedToggle,
            ...individualToggles,
        );

        return new PrivacyUi(
            indicator,
            groupedToggle,
            individualToggles,
        );
    }

    #createIndividualToggle(
        descriptor: PrivacySettingDescriptor,
    ): QuickSettings.QuickToggle {
        const toggle = new QuickSettings.QuickToggle({
            title: descriptor.title,
            iconName: descriptor.iconName,
            toggleMode: true,
        });

        descriptor.settings.bind(
            descriptor.key,
            toggle,
            'checked',
            descriptor.bindFlags,
        );

        const syncSubtitle = (): void => {
            toggle.subtitle = toggle.checked ? 'Allowed' : 'Blocked';
        };

        toggle.connect('notify::checked', syncSubtitle);
        syncSubtitle();

        return toggle;
    }

    #createGroupedToggle(
        descriptors: readonly PrivacySettingDescriptor[],
    ): QuickSettings.QuickMenuToggle {
        const toggle = new QuickSettings.QuickMenuToggle({
            title: 'Privacy',
            iconName: 'preferences-system-privacy-symbolic',
            toggleMode: true,
        });

        toggle.menu.setHeader(
            'preferences-system-privacy-symbolic',
            'Privacy',
            'Location, camera and microphone access',
        );

        const settingSignalIds: Array<[Gio.Settings, number]> = [];

        for (const descriptor of descriptors) {
            const item = new PopupMenu.PopupSwitchMenuItem(
                descriptor.title,
                readAllowed(descriptor),
            );

            descriptor.settings.bind(
                descriptor.key,
                item,
                'state',
                descriptor.bindFlags,
            );

            toggle.menu.addMenuItem(item);

            const signalId = descriptor.settings.connect(
                `changed::${descriptor.key}`,
                () => this.#syncGroupState(toggle, descriptors),
            );
            settingSignalIds.push([descriptor.settings, signalId]);
        }

        const syncClickMode = (): void => {
            toggle.toggleMode =
                this.#extensionSettings.get_boolean('privacy-click-to-toggle');
        };

        const clickModeSignalId = this.#extensionSettings.connect(
            'changed::privacy-click-to-toggle',
            syncClickMode,
        );
        syncClickMode();

        toggle.connect('clicked', () => {
            if (this.#extensionSettings.get_boolean('privacy-click-to-toggle')) {
                const target = !descriptors.every(readAllowed);

                for (const descriptor of descriptors)
                    writeAllowed(descriptor, target);
            } else {
                toggle.menu.open();
            }
        });

        toggle.connect('destroy', () => {
            this.#extensionSettings.disconnect(clickModeSignalId);

            for (const [settings, signalId] of settingSignalIds)
                settings.disconnect(signalId);
        });

        this.#syncGroupState(toggle, descriptors);
        return toggle;
    }

    #syncGroupState(
        toggle: QuickSettings.QuickMenuToggle,
        descriptors: readonly PrivacySettingDescriptor[],
    ): void {
        const allowed = descriptors.filter(readAllowed).length;

        toggle.checked = allowed === descriptors.length;

        if (allowed === 0)
            toggle.subtitle = 'Private';
        else if (allowed === descriptors.length)
            toggle.subtitle = 'All allowed';
        else
            toggle.subtitle = `${allowed} of ${descriptors.length} allowed`;
    }
}

function createPrivacyDescriptors(): PrivacySettingDescriptor[] {
    const locationSettings = new Gio.Settings({
        schema_id: 'org.gnome.system.location',
    });

    const privacySettings = new Gio.Settings({
        schema_id: 'org.gnome.desktop.privacy',
    });

    return [
        {
            title: 'Location',
            iconName: 'location-services-active-symbolic',
            settings: locationSettings,
            key: 'enabled',
            bindFlags: Gio.SettingsBindFlags.DEFAULT,
        },
        {
            title: 'Camera',
            iconName: 'camera-photo-symbolic',
            settings: privacySettings,
            key: 'disable-camera',
            bindFlags: Gio.SettingsBindFlags.INVERT_BOOLEAN,
        },
        {
            title: 'Microphone',
            iconName: 'audio-input-microphone-symbolic',
            settings: privacySettings,
            key: 'disable-microphone',
            bindFlags: Gio.SettingsBindFlags.INVERT_BOOLEAN,
        },
    ];
}

function readAllowed(descriptor: PrivacySettingDescriptor): boolean {
    const value = descriptor.settings.get_boolean(descriptor.key);

    return descriptor.bindFlags === Gio.SettingsBindFlags.INVERT_BOOLEAN
        ? !value
        : value;
}

function writeAllowed(
    descriptor: PrivacySettingDescriptor,
    allowed: boolean,
): void {
    const value = descriptor.bindFlags === Gio.SettingsBindFlags.INVERT_BOOLEAN
        ? !allowed
        : allowed;

    descriptor.settings.set_boolean(descriptor.key, value);
}
