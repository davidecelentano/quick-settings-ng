import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {
    type Disposable,
} from './disposable.js';

interface Registration {
    readonly indicator: QuickSettings.SystemIndicator;
    readonly order: number;
}

/**
 * Centralizes integration with GNOME Shell's documented external Quick
 * Settings extension point and keeps QSNG modules in deterministic order.
 *
 * The host never reaches into _grid/_backgroundApps/_system or similar
 * private fields. Ordering is applied only between QSNG actors after Shell
 * has inserted them through addExternalIndicator().
 */
export class QuickSettingsHost implements Disposable {
    #registrations = new Set<Registration>();
    #disposed = false;

    addIndicator(
        indicator: QuickSettings.SystemIndicator,
        order: number,
        colSpan = 1,
    ): Disposable {
        this.#assertAlive();

        const quickSettings = Main.panel.statusArea.quickSettings;

        if (quickSettings === undefined)
            throw new Error('GNOME Quick Settings area is unavailable');

        const registration: Registration = {
            indicator,
            order,
        };

        this.#registrations.add(registration);
        quickSettings.addExternalIndicator(indicator, colSpan);
        this.#syncOrder();

        let disposed = false;

        return {
            dispose: () => {
                if (disposed)
                    return;

                disposed = true;
                this.#registrations.delete(registration);
                this.#syncOrder();
            },
        };
    }

    dispose(): void {
        if (this.#disposed)
            return;

        this.#disposed = true;
        this.#registrations.clear();
    }

    #syncOrder(): void {
        const orderedItems = Array.from(this.#registrations)
            .sort((a, b) => a.order - b.order)
            .flatMap(registration => registration.indicator.quickSettingsItems);

        let previous: Clutter.Actor | null = null;

        for (const item of orderedItems) {
            const actor = item as unknown as Clutter.Actor;
            if (previous === null) {
                previous = actor;
                continue;
            }

            const parent = actor.get_parent();

            if (parent !== null && previous.get_parent() === parent)
                parent.set_child_above_sibling(actor, previous);

            previous = actor;
        }
    }

    #assertAlive(): void {
        if (this.#disposed)
            throw new Error('QuickSettingsHost has already been disposed');
    }
}
