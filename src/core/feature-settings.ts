export const FEATURE_SETTINGS = {
    media: 'media-enabled',
    privacy: 'privacy-enabled',
    'volume-mixer': 'volume-mixer-enabled',
    layout: 'layout-enabled',
    'menu-effects': 'menu-effects-enabled',
} as const;

export type FeatureId = keyof typeof FEATURE_SETTINGS;

export type FeatureSettingsKey =
    (typeof FEATURE_SETTINGS)[FeatureId];
