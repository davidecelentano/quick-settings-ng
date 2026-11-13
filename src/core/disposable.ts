export interface Disposable {
    dispose(): void;
}

export type Disposer = () => void;

/**
 * Owns resources for one lifecycle.
 *
 * Properties:
 * - disposal is idempotent
 * - cleanup runs in reverse registration order
 * - one failing cleanup cannot prevent later cleanup
 * - resources registered after disposal are immediately disposed
 */
export class DisposableStore implements Disposable {
    #disposed = false;
    #items: Disposer[] = [];

    get disposed(): boolean {
        return this.#disposed;
    }

    add<T extends Disposable>(value: T): T {
        this.defer(() => value.dispose());
        return value;
    }

    defer(disposer: Disposer): void {
        if (this.#disposed) {
            this.#run(disposer);
            return;
        }

        this.#items.push(disposer);
    }

    clear(): void {
        const items = this.#items.splice(0).reverse();

        for (const disposer of items)
            this.#run(disposer);
    }

    dispose(): void {
        if (this.#disposed)
            return;

        this.#disposed = true;
        this.clear();
    }

    #run(disposer: Disposer): void {
        try {
            disposer();
        } catch (error) {
            console.error('[QSNG] cleanup failed', error);
        }
    }
}
