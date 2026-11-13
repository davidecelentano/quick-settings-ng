import {
    reportError,
} from './log.js';

import Gio from 'gi://Gio';

import {
    DisposableStore,
    type Disposable,
} from './disposable.js';

import {
    Feature,
} from './feature.js';

import {
    FeatureManager,
} from './feature-manager.js';

import {
    type FeatureSettingsKey,
} from './feature-settings.js';

/**
 * Connects persistent GSettings feature switches to runtime features.
 *
 * A failure in one feature is isolated:
 * - the setting remains unchanged
 * - the failed feature is left disabled
 * - other features continue running
 */
export class FeatureRegistry implements Disposable {
    #settings: Gio.Settings;
    #manager: FeatureManager;
    #lifetime = new DisposableStore();
    #registered = new Set<string>();
    #disposed = false;

    constructor(
        settings: Gio.Settings,
        manager: FeatureManager,
    ) {
        this.#settings = settings;
        this.#manager = manager;
    }

    register<T extends Feature>(
        feature: T,
        settingsKey: FeatureSettingsKey,
    ): T {
        this.#assertAlive();

        if (this.#registered.has(feature.id))
            throw new Error(`Feature already bound: ${feature.id}`);

        this.#manager.register(feature);
        this.#registered.add(feature.id);

        const signalId = this.#settings.connect(
            `changed::${settingsKey}`,
            () => {
                this.#apply(feature.id, settingsKey);
            },
        );

        this.#lifetime.defer(() => {
            this.#settings.disconnect(signalId);
        });

        this.#apply(feature.id, settingsKey);

        return feature;
    }

    dispose(): void {
        if (this.#disposed)
            return;

        this.#disposed = true;

        this.#lifetime.dispose();
        this.#registered.clear();
    }

    #apply(
        featureId: string,
        settingsKey: FeatureSettingsKey,
    ): void {
        const shouldEnable =
            this.#settings.get_boolean(settingsKey);

        try {
            if (shouldEnable)
                this.#manager.enable(featureId);
            else
                this.#manager.disable(featureId);
        } catch (error) {
            reportError(
                `[QSNG] failed applying feature setting: ${featureId}`,
                error,
            );
        }
    }

    #assertAlive(): void {
        if (this.#disposed)
            throw new Error('FeatureRegistry has already been disposed');
    }
}
