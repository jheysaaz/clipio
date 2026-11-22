/**
 * Confetti burst used by the options-page preview button.
 *
 * The content script owns a long-lived overlay canvas because it fires on
 * insertions inside arbitrary pages. The options page only needs one short
 * burst, so canvas-confetti's own lazily created canvas is enough — no overlay
 * state to manage and nothing left behind once the animation finishes.
 *
 * Kept in its own module so the registry stays free of canvas code and the
 * burst can be tested by mocking one call.
 */

import confetti from "canvas-confetti";

export function previewConfetti(): void {
  void confetti({
    particleCount: 90,
    spread: 70,
    startVelocity: 35,
    origin: { y: 0.65 },
  });
}
