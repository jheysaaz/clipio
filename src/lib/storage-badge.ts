import type { StorageStatus } from "@/storage/types";

/**
 * The toolbar badge shown while a storage problem needs attention with the
 * popup closed. Pure data: the background owns the browser API call.
 */
export type ActionBadge = {
  text: string;
  color: string;
};

const STORAGE_ERROR_BADGE: ActionBadge = {
  text: "!",
  color: "#b91c1c",
};

export type StorageBadgeState = StorageStatus & {
  /** Set by a refused write, including while the active mode is still sync. */
  attention: boolean;
};

/**
 * A manual switch to local mode is a choice, not a problem, so it gets no
 * badge. An automatic quota fallback or a refused write does.
 */
export function badgeForStorageState(
  state: StorageBadgeState
): ActionBadge | null {
  if (
    state.attention ||
    (state.mode === "local" && state.localReason === "quota")
  ) {
    return STORAGE_ERROR_BADGE;
  }
  return null;
}
