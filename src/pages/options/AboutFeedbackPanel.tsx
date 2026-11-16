/**
 * `/about/feedback` — the About section with the feedback form open.
 *
 * `background.ts` has linked here as `options.html#feedback` since the context
 * menu shipped. That hash never matched a section id, so the page's own hash
 * validator rejected it and the user landed on Library: the link worked and
 * arrived somewhere else. This route is what it was always trying to be.
 */

import { useEffect, useState } from "react";

import { FeedbackModal } from "@/components/options/FeedbackModal";

export function AboutFeedbackPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // One tick's delay so the modal mounts against a laid-out document. Opening
    // it during the first paint measured a zero-height target.
    const id = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(id);
  }, []);

  return <FeedbackModal open={open} onClose={() => setOpen(false)} />;
}
