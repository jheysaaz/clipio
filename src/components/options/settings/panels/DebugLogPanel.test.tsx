/**
 * Direct tests for the debug log viewer.
 *
 * The panel is inert until the debug switch is on, and both button handlers
 * have failure paths that must be visible to the user. The storage items and
 * the clipboard are stubbed here and put back afterwards, so a test cannot
 * leave a fake clipboard behind for the next one.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const modeWatchers: Array<(v: unknown) => void> = [];
  const logWatchers: Array<(v: unknown) => void> = [];
  const watch =
    (watchers: Array<(v: unknown) => void>) =>
    (cb: (v: unknown) => void): (() => void) => {
      watchers.push(cb);
      return () => {
        const i = watchers.indexOf(cb);
        if (i !== -1) watchers.splice(i, 1);
      };
    };

  return {
    modeWatchers,
    logWatchers,
    debugModeItem: {
      getValue: vi.fn(),
      watch: watch(modeWatchers),
    },
    debugLogItem: {
      getValue: vi.fn(),
      setValue: vi.fn(),
      watch: watch(logWatchers),
    },
    emitMode: (value: unknown) => {
      for (const cb of [...modeWatchers]) cb(value);
    },
    emitLog: (value: unknown) => {
      for (const cb of [...logWatchers]) cb(value);
    },
    captureError: vi.fn(),
    writeText: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
  };
});

vi.mock("@/storage/items", () => ({
  debugModeItem: mocks.debugModeItem,
  debugLogItem: mocks.debugLogItem,
}));
vi.mock("@/lib/sentry", () => ({ captureError: mocks.captureError }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { DebugLogPanel } from "./DebugLogPanel";
import { i18n } from "../../../../../tests/mocks/i18n";

const entry = {
  ts: Date.parse("2026-01-02T03:04:05.000Z"),
  context: "content" as const,
  event: "insert",
  detail: "snippet-1",
};
const anotherEntry = {
  ts: Date.parse("2026-01-02T03:05:05.000Z"),
  context: "background" as const,
  event: "sync",
  detail: { count: 2 },
};

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard"
);

function enableLog(entries: unknown = []) {
  mocks.debugModeItem.getValue.mockResolvedValue(true);
  mocks.debugLogItem.getValue.mockResolvedValue(entries);
}

function button(name: string) {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  // A previous test's component is unmounted by the shared cleanup hook, but
  // clearing here too makes each test independent of watcher registration order.
  mocks.modeWatchers.length = 0;
  mocks.logWatchers.length = 0;
  mocks.debugModeItem.getValue.mockReset().mockResolvedValue(false);
  mocks.debugLogItem.getValue.mockReset().mockResolvedValue([]);
  mocks.debugLogItem.setValue.mockReset().mockResolvedValue(undefined);
  mocks.captureError.mockReset();
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
});

afterEach(() => {
  if (clipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  vi.clearAllMocks();
});

describe("DebugLogPanel", () => {
  it("renders nothing while debug logging is off", async () => {
    const { unmount } = render(<DebugLogPanel />);

    expect(screen.queryByTestId("panel-debug-log")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.debugLogItem.getValue).not.toHaveBeenCalled()
    );
    unmount();
  });

  it("shows the empty state and disables both actions with no entries", async () => {
    enableLog([]);

    render(<DebugLogPanel />);

    expect(await screen.findByTestId("debug-log")).toHaveTextContent(
      i18n.t("options.developers.debugMode.emptyLog")
    );
    expect(
      button(i18n.t("options.developers.debugMode.copyLog"))
    ).toBeDisabled();
    expect(
      button(i18n.t("options.developers.debugMode.clearLog"))
    ).toBeDisabled();
  });

  it("renders populated entries, including string and object details", async () => {
    enableLog([entry, anotherEntry]);

    render(<DebugLogPanel />);

    // Wait for the entry itself: the panel appears as soon as the mode read
    // resolves, which can be before the log read resolves.
    await screen.findByText("insert");
    expect(screen.getByTestId("debug-log")).toHaveTextContent("snippet-1");
    expect(screen.getByTestId("debug-log")).toHaveTextContent("[content]");
    expect(screen.getByTestId("debug-log")).toHaveTextContent("[background]");
    expect(screen.getByTestId("debug-log")).toHaveTextContent('{"count":2}');
  });

  it("treats a non-array stored log as empty", async () => {
    enableLog({ unexpected: "shape" });

    render(<DebugLogPanel />);

    expect(await screen.findByTestId("debug-log")).toHaveTextContent(
      i18n.t("options.developers.debugMode.emptyLog")
    );
  });

  it("copies the formatted log to the clipboard", async () => {
    enableLog([entry]);

    render(<DebugLogPanel />);
    await screen.findByText("insert");
    const copy = await screen.findByRole("button", {
      name: i18n.t("options.developers.debugMode.copyLog"),
    });
    fireEvent.click(copy);

    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith(
        `[${new Date(entry.ts).toISOString()}] [content] insert snippet-1`
      )
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      i18n.t("options.developers.debugMode.copiedLog")
    );
  });

  it("reports a failed copy instead of claiming success", async () => {
    const failure = new Error("clipboard denied");
    mocks.writeText.mockRejectedValue(failure);
    enableLog([entry]);

    render(<DebugLogPanel />);
    await screen.findByText("insert");
    fireEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("options.developers.debugMode.copyLog"),
      })
    );

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(failure, {
        action: "copyDebugLog",
      })
    );
    expect(mocks.toast.error).toHaveBeenCalledWith(
      i18n.t("options.developers.debugMode.copyFailed")
    );
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("clears the visible log on a successful write", async () => {
    enableLog([entry]);

    render(<DebugLogPanel />);
    await screen.findByText("insert");
    fireEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("options.developers.debugMode.clearLog"),
      })
    );

    await waitFor(() =>
      expect(mocks.debugLogItem.setValue).toHaveBeenCalledWith([])
    );
    expect(screen.getByTestId("debug-log")).toHaveTextContent(
      i18n.t("options.developers.debugMode.emptyLog")
    );
  });

  it("reports a failed clear and keeps the entries on screen", async () => {
    const failure = new Error("storage unavailable");
    mocks.debugLogItem.setValue.mockRejectedValue(failure);
    enableLog([entry]);

    render(<DebugLogPanel />);
    await screen.findByText("insert");
    fireEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("options.developers.debugMode.clearLog"),
      })
    );

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(failure, {
        action: "clearDebugLog",
      })
    );
    expect(screen.getByTestId("debug-log")).toHaveTextContent("insert");
  });

  it("reacts to watch updates and ignores a non-array log watch value", async () => {
    enableLog([]);

    render(<DebugLogPanel />);
    await screen.findByText(i18n.t("options.developers.debugMode.emptyLog"));

    act(() => mocks.emitLog([entry]));
    expect(screen.getByTestId("debug-log")).toHaveTextContent("insert");

    act(() => mocks.emitLog({ unexpected: true }));
    expect(screen.getByTestId("debug-log")).toHaveTextContent(
      i18n.t("options.developers.debugMode.emptyLog")
    );

    act(() => mocks.emitLog([anotherEntry]));
    expect(screen.getByTestId("debug-log")).toHaveTextContent("sync");
  });

  it("turns the panel on from a mode watch without a reload", async () => {
    mocks.debugModeItem.getValue.mockResolvedValue(false);
    mocks.debugLogItem.getValue.mockResolvedValue([entry]);

    render(<DebugLogPanel />);
    await waitFor(() =>
      expect(mocks.debugModeItem.getValue).toHaveBeenCalled()
    );
    expect(screen.queryByTestId("panel-debug-log")).not.toBeInTheDocument();

    act(() => mocks.emitMode(true));
    await screen.findByText("insert");
    expect(screen.getByTestId("debug-log")).toBeVisible();
  });
});
