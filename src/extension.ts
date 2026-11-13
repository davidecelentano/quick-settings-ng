import {
    reportError,
} from './core/log.js';

import {
    Extension,
} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    DisposableStore,
} from './core/disposable.js';

import {
    FeatureManager,
} from './core/feature-manager.js';

import {
    FeatureRegistry,
} from './core/feature-registry.js';

import {
    FEATURE_SETTINGS,
} from './core/feature-settings.js';

import {
    QuickSettingsHost,
} from './core/quick-settings-host.js';

import {
    LayoutFeature,
} from './features/layout/layout-feature.js';

import {
    MediaFeature,
} from './features/media/media-feature.js';

import {
    MenuEffectsFeature,
} from './features/menu-effects/menu-effects-feature.js';

import {
    PrivacyFeature,
} from './features/privacy/privacy-feature.js';

import {
    VolumeMixerFeature,
} from './features/volume-mixer/volume-mixer-feature.js';

export default class QuickSettingsNGExtension extends Extension {
    #lifetime: DisposableStore | null = null;

    override enable(): void {
        if (this.#lifetime !== null)
            return;

        const lifetime = new DisposableStore();
        this.#lifetime = lifetime;

        try {
            const settings = this.getSettings();
            const host = lifetime.add(new QuickSettingsHost());
            const features = lifetime.add(new FeatureManager());
            const registry = lifetime.add(
                new FeatureRegistry(settings, features),
            );

            registry.register(
                new PrivacyFeature(settings, host),
                FEATURE_SETTINGS.privacy,
            );
            registry.register(
                new MediaFeature(settings, host),
                FEATURE_SETTINGS.media,
            );
            registry.register(
                new VolumeMixerFeature(),
                FEATURE_SETTINGS['volume-mixer'],
            );
            registry.register(
                new LayoutFeature(settings),
                FEATURE_SETTINGS.layout,
            );
            registry.register(
                new MenuEffectsFeature(),
                FEATURE_SETTINGS['menu-effects'],
            );

        } catch (error) {
            this.#lifetime = null;
            lifetime.dispose();

            reportError(
                '[QSNG] extension startup failed',
                error,
            );

            throw error;
        }
    }

    override disable(): void {
        const lifetime = this.#lifetime;
        this.#lifetime = null;

        lifetime?.dispose();

    }
}
