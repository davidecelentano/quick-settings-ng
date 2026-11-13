import {
    type Disposable,
} from './disposable.js';

import {
    Feature,
} from './feature.js';

/**
 * Owns all runtime features of Quick Settings NG.
 *
 * Guarantees:
 * - duplicate feature IDs are rejected
 * - feature enable is idempotent
 * - enableAll() rolls back features enabled during a failed startup
 * - disableAll() attempts cleanup of every feature even if one fails
 * - teardown happens in reverse registration order
 * - no feature can be registered after manager disposal
 */
export class FeatureManager implements Disposable {
    #features = new Map<string, Feature>();
    #disposed = false;

    get disposed(): boolean {
        return this.#disposed;
    }

    register<T extends Feature>(feature: T): T {
        this.#assertAlive();

        if (this.#features.has(feature.id))
            throw new Error(`Feature already registered: ${feature.id}`);

        this.#features.set(feature.id, feature);

        return feature;
    }

    has(id: string): boolean {
        return this.#features.has(id);
    }

    isEnabled(id: string): boolean {
        return this.#get(id).enabled;
    }

    enable(id: string): void {
        this.#assertAlive();

        const feature = this.#get(id);

        if (feature.enabled)
            return;

        console.log(`[QSNG] enabling feature: ${id}`);

        feature.enable();

        console.log(`[QSNG] enabled feature: ${id}`);
    }

    disable(id: string): void {
        const feature = this.#get(id);

        if (!feature.enabled)
            return;

        console.log(`[QSNG] disabling feature: ${id}`);

        try {
            feature.disable();
        } catch (error) {
            console.error(`[QSNG] failed disabling feature: ${id}`, error);
        }
    }

    enableAll(): void {
        this.#assertAlive();

        const enabledNow: Feature[] = [];

        try {
            for (const feature of this.#features.values()) {
                if (feature.enabled)
                    continue;

                console.log(`[QSNG] enabling feature: ${feature.id}`);

                feature.enable();
                enabledNow.push(feature);

                console.log(`[QSNG] enabled feature: ${feature.id}`);
            }
        } catch (error) {
            console.error('[QSNG] feature startup failed, rolling back', error);

            for (const feature of enabledNow.reverse()) {
                try {
                    feature.disable();
                } catch (cleanupError) {
                    console.error(
                        `[QSNG] rollback failed for feature: ${feature.id}`,
                        cleanupError,
                    );
                }
            }

            throw error;
        }
    }

    disableAll(): void {
        const features = Array.from(this.#features.values()).reverse();

        for (const feature of features) {
            if (!feature.enabled)
                continue;

            console.log(`[QSNG] disabling feature: ${feature.id}`);

            try {
                feature.disable();
            } catch (error) {
                console.error(
                    `[QSNG] failed disabling feature: ${feature.id}`,
                    error,
                );
            }
        }
    }

    dispose(): void {
        if (this.#disposed)
            return;

        this.#disposed = true;

        this.disableAll();

        for (const feature of this.#features.values()) {
            try {
                feature.dispose();
            } catch (error) {
                console.error(
                    `[QSNG] failed disposing feature: ${feature.id}`,
                    error,
                );
            }
        }

        this.#features.clear();
    }

    #get(id: string): Feature {
        const feature = this.#features.get(id);

        if (feature === undefined)
            throw new Error(`Unknown feature: ${id}`);

        return feature;
    }

    #assertAlive(): void {
        if (this.#disposed)
            throw new Error('FeatureManager has already been disposed');
    }
}
