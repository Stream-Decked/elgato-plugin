/**
 * Shared plugin constants.
 */

/** UUID of the Modspace action, also referenced in `manifest.json`. */
export const MODSPACE_UUID = "io.github.stream-decked.modspace";

/** Fixed default port the local bridge listens on. Changeable from the property inspector. */
export const DEFAULT_PORT = 8126;

/**
 * Manifest name of the shipped Modspace profile the plugin switches decks to while a
 * client is bound. Matches the extension-less path in `manifest.json`'s `Profiles`.
 */
export const MODSPACE_PROFILE = "profiles/streamdecked";