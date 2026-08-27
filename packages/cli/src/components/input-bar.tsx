/**
 * Compatibility export retained through UI Architecture A4-A6. The legacy
 * InputBar implementation was decomposed into Composer capabilities. Normal
 * Session code must import/use the new Composer surface instead of adding
 * application semantics back here.
 */
export { Composer as default } from "../ui/session/composer/composer";
export { Composer } from "../ui/session/composer/composer";
export { commitPromptModelChange } from "../ui/session/composer/composer-actions";
export { COMPOSER_TEXTAREA_KEY_BINDINGS as TEXTAREA_KEY_BINDING } from "../ui/session/composer/editor";
