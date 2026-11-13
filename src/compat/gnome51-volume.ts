import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

/**
 * GNOME Shell 51 compatibility bridge for the stock output-volume slider.
 *
 * GNOME does not currently export the OutputIndicator instance from the panel,
 * so integrating application controls into the *existing* volume menu requires
 * one deliberately isolated lookup of QuickSettings._volumeOutput.
 *
 * Keep this private-field dependency in this file only. Callers receive the
 * exported QuickSlider API and do not know how the stock item was located.
 */
export function getStockOutputVolumeSlider(): QuickSettings.QuickSlider | null {
    const quickSettings = Main.panel.statusArea.quickSettings;

    if (quickSettings === undefined)
        return null;

    const volumeOutput = Reflect.get(
        quickSettings as object,
        '_volumeOutput',
    ) as unknown;

    if (typeof volumeOutput !== 'object' || volumeOutput === null)
        return null;

    const items = Reflect.get(
        volumeOutput,
        'quickSettingsItems',
    ) as unknown;

    if (!Array.isArray(items) || items.length === 0)
        return null;

    const item = items[0];

    return item instanceof QuickSettings.QuickSlider
        ? item
        : null;
}
