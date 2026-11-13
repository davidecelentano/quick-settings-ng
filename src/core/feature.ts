import {
    DisposableStore,
    type Disposable,
} from './disposable.js';

/**
 * Base class for independently managed QSNG features.
 *
 * enable() and disable() are intentionally synchronous because
 * GNOME Shell 51 requires synchronous extension shutdown.
 */
export abstract class Feature implements Disposable {
    abstract readonly id: string;

    #lifetime: DisposableStore | null = null;

    get enabled(): boolean {
        return this.#lifetime !== null;
    }

    enable(): void {
        if (this.#lifetime !== null)
            return;

        const lifetime = new DisposableStore();
        this.#lifetime = lifetime;

        try {
            this.onEnable(lifetime);
        } catch (error) {
            this.#lifetime = null;
            lifetime.dispose();
            throw error;
        }
    }

    disable(): void {
        const lifetime = this.#lifetime;

        if (lifetime === null)
            return;

        this.#lifetime = null;
        lifetime.dispose();
    }

    dispose(): void {
        this.disable();
    }

    protected abstract onEnable(lifetime: DisposableStore): void;
}
