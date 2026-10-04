/**
 * Checks whether an event target is a text input, textarea, select, or contenteditable element.
 * Prevents game keyboard shortcuts (movement, camera toggle) from firing while typing.
 * Safe to execute in SSR / Node.js test environments without DOM globals.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}
