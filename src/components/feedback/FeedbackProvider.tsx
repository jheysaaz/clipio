import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

import { i18n } from "#i18n";
import { Icon } from "@/components/ui/icon";
import { InlineAction } from "@/components/ui/inline-action";
import { cn } from "@/lib/utils";

export type FeedbackSeverity = "info" | "success" | "error";

export type BannerAction = {
  label: string;
  onClick: () => void;
};

export type BannerInput = {
  message: string;
  severity?: FeedbackSeverity;
  action?: BannerAction;
  /** Called when the user dismisses the banner, including via a replacement. */
  onDismiss?: () => void;
  testId?: string;
  dismissTestId?: string;
  /** Lets an owner dismiss only its own banner, never a newer one. */
  source?: string;
};

type BannerState = Omit<BannerInput, "severity"> & {
  severity: FeedbackSeverity;
  id: number;
};

export type AnnounceOptions = {
  assertive?: boolean;
  /** Repeated announcements with the same key can be throttled. */
  key?: string;
  throttleMs?: number;
};

type FeedbackContextValue = {
  banner: BannerState | null;
  showBanner: (input: BannerInput) => void;
  dismissBanner: (
    source?: string,
    options?: { runOnDismiss?: boolean }
  ) => void;
  announce: (message: string, options?: AnnounceOptions) => void;
  announceError: (message: string) => void;
};

const SEVERITY_RANK: Record<FeedbackSeverity, number> = {
  info: 0,
  success: 1,
  error: 2,
};

const BANNER_ICON = {
  info: Info,
  success: CheckCircle2,
  error: TriangleAlert,
} as const;

const BANNER_TONE: Record<FeedbackSeverity, string> = {
  info: "bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100",
  success:
    "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  error: "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100",
};

const noop = () => {};

const FeedbackContext = createContext<FeedbackContextValue>({
  banner: null,
  showBanner: noop,
  dismissBanner: noop,
  announce: noop,
  announceError: noop,
});

export function useFeedback(): FeedbackContextValue {
  return useContext(FeedbackContext);
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [banner, setBanner] = useState<BannerState | null>(null);
  const bannerRef = useRef<BannerState | null>(null);
  const nextBannerId = useRef(0);

  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const [politeSeq, setPoliteSeq] = useState(0);
  const [assertiveSeq, setAssertiveSeq] = useState(0);
  const lastAnnouncedAt = useRef(new Map<string, number>());

  const announce = useCallback(
    (message: string, options: AnnounceOptions = {}) => {
      const { assertive: isAssertive = false, key, throttleMs = 0 } = options;

      // Errors are never throttled. Saved and Copied can repeat rapidly while
      // typing or clicking; those callers pass a key and a window.
      if (!isAssertive && key && throttleMs > 0) {
        const now = Date.now();
        const last = lastAnnouncedAt.current.get(key) ?? -Infinity;
        if (now - last < throttleMs) return;
        lastAnnouncedAt.current.set(key, now);
      }

      if (isAssertive) {
        setPolite("");
        setAssertive(message);
        setAssertiveSeq((seq) => seq + 1);
        return;
      }

      setAssertive("");
      setPolite(message);
      setPoliteSeq((seq) => seq + 1);
    },
    []
  );

  const announceError = useCallback(
    (message: string) => announce(message, { assertive: true }),
    [announce]
  );

  const commitBanner = useCallback((next: BannerState | null) => {
    bannerRef.current = next;
    setBanner(next);
  }, []);

  const showBanner = useCallback(
    (input: BannerInput) => {
      const severity = input.severity ?? "info";
      const current = bannerRef.current;

      // An unresolved error owns the slot until it is resolved or dismissed.
      if (current?.severity === "error" && severity !== "error") return;
      if (
        current &&
        SEVERITY_RANK[severity] < SEVERITY_RANK[current.severity]
      ) {
        return;
      }

      commitBanner({ ...input, severity, id: ++nextBannerId.current });
      announce(input.message, { assertive: severity === "error" });
    },
    [announce, commitBanner]
  );

  const dismissBanner = useCallback(
    (
      source?: string,
      options: { runOnDismiss?: boolean } = { runOnDismiss: true }
    ) => {
      const current = bannerRef.current;
      if (!current) return;
      if (source && current.source !== source) return;
      commitBanner(null);
      if (options.runOnDismiss !== false) current.onDismiss?.();
    },
    [commitBanner]
  );

  const value = useMemo<FeedbackContextValue>(
    () => ({ banner, showBanner, dismissBanner, announce, announceError }),
    [banner, showBanner, dismissBanner, announce, announceError]
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {/* Stable live-region nodes; the inner span is replaced so repeating the
          same text is still announced. Nothing actionable lives in either. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        <span key={politeSeq}>{polite}</span>
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        <span key={assertiveSeq}>{assertive}</span>
      </div>
    </FeedbackContext.Provider>
  );
}

/**
 * The single Tier 2 surface. Tinted rather than divided, presentational rather
 * than a live region: announcements go through the provider's status/alert.
 */
export function FeedbackBanner({
  className,
  testId,
}: {
  className?: string;
  testId?: string;
}) {
  const { banner, dismissBanner } = useFeedback();

  if (!banner) return null;

  const BannerIcon = BANNER_ICON[banner.severity];
  const rootTestId = banner.testId ?? testId ?? "feedback-banner";

  return (
    <div
      data-testid={rootTestId}
      data-severity={banner.severity}
      className={cn(
        "mb-4 flex items-start gap-2 rounded-md px-3 py-2 text-sm",
        BANNER_TONE[banner.severity],
        className
      )}
    >
      <Icon icon={BannerIcon} size="lg" />
      <p className="min-w-0 flex-1 font-medium">{banner.message}</p>
      {banner.action && (
        <InlineAction
          onClick={banner.action.onClick}
          className="text-inherit hover:text-inherit"
        >
          {banner.action.label}
        </InlineAction>
      )}
      {banner.onDismiss && (
        <button
          type="button"
          aria-label={i18n.t("common.dismiss")}
          data-testid={banner.dismissTestId ?? `${rootTestId}-dismiss`}
          onClick={() => dismissBanner(banner.source)}
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <Icon icon={X} size="lg" stroke="emphasis" />
        </button>
      )}
    </div>
  );
}
