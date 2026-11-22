/**
 * Direct tests for the registry-to-storage control bridge.
 *
 * The control is the only place a typed registry entry becomes a live widget,
 * so these tests drive every widget and both write paths (persist and reset),
 * including the failure path that must put the control back to what storage
 * actually holds.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { SunIcon } from "lucide-react";
import { i18n } from "#i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InputHTMLAttributes, ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  setThemeMode: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@/store/settings", () => ({ setThemeMode: mocks.setThemeMode }));
vi.mock("@/lib/sentry", () => ({ captureError: mocks.captureError }));

vi.mock("@/components/ui/icon", () => ({
  Icon: ({
    icon: _icon,
    size: _size,
    stroke: _stroke,
    ...props
  }: {
    icon: unknown;
    size?: string;
    stroke?: string;
    [key: string]: unknown;
  }) => <span data-testid="mock-icon" {...props} />,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    ...props
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      {...props}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/slider", () => ({
  Slider: ({
    value,
    onValueChange,
    min = 0,
    max = 100,
    step = 1,
    disabled,
    ...props
  }: {
    value?: readonly number[];
    onValueChange?: (next: number | readonly number[]) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value?.[0] ?? min}
        disabled={disabled}
        {...props}
        onChange={(event) => onValueChange?.([Number(event.target.value)])}
      />
      <button
        type="button"
        data-testid={`${String(props["aria-label"])}-scalar`}
        onClick={() => onValueChange?.(42)}
      >
        scalar
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children?: ReactNode;
    value?: string;
    onValueChange?: (next: string) => void;
  }) => (
    <div data-testid="mock-select" data-value={value}>
      {children}
      <button
        type="button"
        data-testid="mock-select-change"
        onClick={() => onValueChange?.("changed")}
      >
        change
      </button>
    </div>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: {
    children?: ReactNode;
    [key: string]: unknown;
  }) => <div {...props}>{children}</div>,
  SelectValue: () => <span>selected</span>,
  SelectContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({
    children,
    value: _value,
  }: {
    children?: ReactNode;
    value?: string;
  }) => <div>{children}</div>,
}));

vi.mock("./ShortcutRecorder", () => ({
  ShortcutRecorder: ({
    value,
    onChange,
    testId,
    disabled,
  }: {
    value?: string;
    onChange?: (next: string) => void;
    testId?: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange?.("Mod+K")}
    >
      {value}
    </button>
  ),
}));

import { SettingControl } from "./SettingControl";
import type { SettingEntry } from "./registry";

function makeEntry(overrides: Partial<SettingEntry> = {}): SettingEntry {
  const id = overrides.id ?? "test-setting";
  return {
    id,
    section: "expansion",
    titleKey: "options.setting.previewPrefix.title",
    descKey: "options.setting.previewPrefix.desc",
    control: "text",
    testId: `setting-${id}`,
    useValue: vi.fn().mockResolvedValue("default"),
    setValue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const nativeSetTimeout = globalThis.setTimeout;
let timeoutSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  // The component's 1500ms "saved" reset is presentation-only. Stub just that
  // timer so assertions can observe the saved state, while leaving Testing
  // Library's own timers alone.
  timeoutSpy = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation(((
      handler: (...args: unknown[]) => void,
      timeout?: number,
      ...args: unknown[]
    ) =>
      timeout === 1500
        ? (0 as unknown as ReturnType<typeof setTimeout>)
        : nativeSetTimeout(
            handler,
            timeout,
            ...args
          )) as unknown as typeof setTimeout);
});

afterEach(() => {
  timeoutSpy?.mockRestore();
  timeoutSpy = undefined;
  mocks.setThemeMode.mockReset();
  mocks.captureError.mockReset();
});

/** Flush the promise chain started by a render or an event. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("SettingControl", () => {
  it("starts disabled and shows the stored value once the read settles", async () => {
    const entry = makeEntry({
      useValue: vi.fn().mockResolvedValue("from-storage"),
    });
    render(<SettingControl entry={entry} />);

    expect(screen.getByRole("textbox")).toBeDisabled();
    await settle();

    expect(screen.getByRole("textbox")).toHaveValue("from-storage");
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("reports a failed initial read and leaves the control usable", async () => {
    const failure = new Error("read failed");
    const entry = makeEntry({ useValue: vi.fn().mockRejectedValue(failure) });
    render(<SettingControl entry={entry} />);
    await settle();

    expect(mocks.captureError).toHaveBeenCalledWith(failure, {
      action: "setting.useValue",
      settingId: entry.id,
    });
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("does not let a slow read overwrite a value the user already changed", async () => {
    let resolveRead: ((value: string) => void) | undefined;
    const entry = makeEntry({
      useValue: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveRead = resolve;
          })
      ),
    });
    render(<SettingControl entry={entry} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "typed" },
    });
    await settle();
    expect(entry.setValue).toHaveBeenCalledWith("typed");

    await act(async () => {
      resolveRead?.("late-storage-value");
    });

    expect(screen.getByRole("textbox")).toHaveValue("typed");
  });

  it("persists a switch value without a redundant saved tick", async () => {
    const entry = makeEntry({
      control: "switch",
      useValue: vi.fn().mockResolvedValue(false),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    fireEvent.click(screen.getByRole("switch"));
    await settle();

    expect(entry.setValue).toHaveBeenCalledWith(true);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a declared preview action that runs without writing the setting", async () => {
    const run = vi.fn();
    const entry = makeEntry({
      control: "switch",
      useValue: vi.fn().mockResolvedValue(false),
      preview: {
        labelKey: "options.row.preview",
        icon: SunIcon,
        testId: "test-preview",
        run,
      },
    });
    render(<SettingControl entry={entry} />);
    await settle();

    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("options.row.preview") })
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(entry.setValue).not.toHaveBeenCalled();
    const preview = screen.getByTestId("test-preview");
    // The icon is decorative: the button's accessible name stays the label.
    expect(
      preview.querySelector('[data-testid="mock-icon"]')
    ).toBeInTheDocument();
  });

  it("does not render a preview action on rows that do not declare one", async () => {
    const entry = makeEntry({ useValue: vi.fn().mockResolvedValue("value") });
    render(<SettingControl entry={entry} />);
    await settle();

    expect(
      screen.queryByRole("button", { name: i18n.t("options.row.preview") })
    ).not.toBeInTheDocument();
  });

  it("routes theme changes through the theme store instead of writing storage", async () => {
    const entry = makeEntry({
      id: "theme",
      control: "switch",
      useValue: vi.fn().mockResolvedValue(false),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    fireEvent.click(screen.getByRole("switch"));
    await settle();

    expect(mocks.setThemeMode).toHaveBeenCalledWith(true);
    expect(entry.setValue).not.toHaveBeenCalled();
  });

  it("renders icon-segment options with and without icons and persists a choice", async () => {
    const entry = makeEntry({
      control: "icon-segment",
      options: [
        { value: "light", labelKey: "options.theme.light" },
        {
          value: "dark",
          labelKey: "options.theme.dark",
          icon: SunIcon,
        },
      ],
      useValue: vi.fn().mockResolvedValue("light"),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    const radiogroup = screen.getByRole("radiogroup");
    expect(radiogroup).toHaveAttribute(
      "aria-label",
      i18n.t("options.setting.previewPrefix.title")
    );
    const light = screen.getByRole("radio", {
      name: i18n.t("options.theme.light"),
    });
    const dark = screen.getByRole("radio", {
      name: i18n.t("options.theme.dark"),
    });
    expect(light).toHaveAttribute("aria-checked", "true");
    expect(dark).toHaveAttribute("aria-checked", "false");
    expect(screen.getAllByTestId("mock-icon")).toHaveLength(1);

    fireEvent.click(dark);
    await settle();

    expect(entry.setValue).toHaveBeenCalledWith("dark");
  });

  it("renders a select's translated options and font previews", async () => {
    const entry = makeEntry({
      control: "select",
      options: [
        { value: "light", labelKey: "options.theme.light" },
        { value: "dark", labelKey: "options.theme.dark" },
      ],
      optionFonts: { dark: "Dyslexic" },
      useValue: vi.fn().mockResolvedValue("light"),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    expect(screen.getByTestId("mock-select")).toContainElement(
      screen.getByText(i18n.t("options.theme.dark"))
    );
    expect(screen.getByText(i18n.t("options.theme.dark"))).toHaveStyle({
      fontFamily: "Dyslexic",
    });
    expect(screen.getByText(i18n.t("options.theme.light"))).not.toHaveStyle({
      fontFamily: "Dyslexic",
    });
  });

  it("accepts a select value change", async () => {
    const entry = makeEntry({
      control: "select",
      options: [{ value: "dark", labelKey: "options.theme.dark" }],
      useValue: vi.fn().mockResolvedValue("dark"),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    const trigger = screen.getByTestId("setting-test-setting-select");
    expect(trigger).toHaveAttribute("aria-label", i18n.t(entry.titleKey));
    expect(screen.getByTestId("mock-select")).toHaveAttribute(
      "data-value",
      "dark"
    );

    fireEvent.click(screen.getByTestId("mock-select-change"));
    await settle();

    expect(entry.setValue).toHaveBeenCalledWith("changed");
  });

  it("persists slider values from both the range thumb and a scalar callback", async () => {
    const entry = makeEntry({
      control: "slider",
      range: { min: 0, max: 500, step: 50 },
      useValue: vi.fn().mockResolvedValue(100),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    fireEvent.change(screen.getByRole("slider"), { target: { value: "250" } });
    await settle();
    expect(entry.setValue).toHaveBeenLastCalledWith(250);
    expect(screen.getByTestId("setting-test-setting-value")).toHaveTextContent(
      "250"
    );

    fireEvent.click(screen.getByTestId(`${i18n.t(entry.titleKey)}-scalar`));
    await settle();
    expect(entry.setValue).toHaveBeenLastCalledWith(42);
  });

  it("records a shortcut and shows a saved tick for a text field", async () => {
    const entry = makeEntry({
      control: "shortcut",
      useValue: vi.fn().mockResolvedValue("Mod+Shift+Space"),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    fireEvent.click(screen.getByTestId("setting-test-setting-recorder"));
    await settle();

    expect(entry.setValue).toHaveBeenCalledWith("Mod+K");
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
  });

  it("hides reset when a shortcut is semantically the default", async () => {
    const entry = makeEntry({
      control: "shortcut",
      defaultValue: "Mod+Shift+Space",
      reset: vi.fn().mockResolvedValue(undefined),
      useValue: vi.fn().mockResolvedValue("Ctrl+Shift+Space"),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    // `Ctrl` and `Mod` parse to the same chord; a clean install must not look
    // dirty just because storage uses a different spelling.
    expect(screen.getByTestId("setting-test-setting-reset")).toBeDisabled();
  });

  it("keeps reset enabled when a shortcut is genuinely changed", async () => {
    const entry = makeEntry({
      control: "shortcut",
      defaultValue: "Mod+Shift+Space",
      reset: vi.fn().mockResolvedValue(undefined),
      useValue: vi.fn().mockResolvedValue("Mod+Shift+K"),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    expect(screen.getByTestId("setting-test-setting-reset")).toBeEnabled();
  });

  it("masks a secret text field and highlights search matches", async () => {
    const entry = makeEntry({
      secret: true,
      placeholder: "API key",
      useValue: vi.fn().mockResolvedValue("secret-value"),
    });
    const title = i18n.t(entry.titleKey);
    render(<SettingControl entry={entry} highlight={[{ start: 0, end: 3 }]} />);
    await settle();

    const input = screen.getByTestId("setting-test-setting-input");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("placeholder", "API key");
    expect(screen.getByText(title.slice(0, 3)).tagName).toBe("MARK");
  });

  it("renders the section-managed hint for a site-list control", async () => {
    const entry = makeEntry({
      control: "site-list",
      useValue: vi.fn().mockResolvedValue(["example.com"]),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    expect(
      screen.getByText(i18n.t("options.row.managedInSection"))
    ).toBeInTheDocument();
  });

  it("reports a failed write and rolls the control back to storage", async () => {
    const failure = new Error("write failed");
    const entry = makeEntry({
      useValue: vi
        .fn()
        .mockResolvedValueOnce("before")
        .mockResolvedValueOnce("actually-stored"),
      setValue: vi.fn().mockRejectedValue(failure),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "typed" },
    });
    await settle();
    await settle();

    expect(mocks.captureError).toHaveBeenCalledWith(failure, {
      action: "setting.setValue",
      settingId: entry.id,
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("actually-stored");
  });

  it("keeps the optimistic value when the post-failure re-read also fails", async () => {
    const entry = makeEntry({
      useValue: vi
        .fn()
        .mockResolvedValueOnce("before")
        .mockRejectedValueOnce(new Error("re-read failed")),
      setValue: vi.fn().mockRejectedValue(new Error("write failed")),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "typed" },
    });
    await settle();
    await settle();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("typed");
  });

  it("resets a non-theme setting by reading the restored value back", async () => {
    const entry = makeEntry({
      defaultValue: "default",
      reset: vi.fn().mockResolvedValue(undefined),
      useValue: vi
        .fn()
        .mockResolvedValueOnce("changed")
        .mockResolvedValueOnce("default"),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    const reset = screen.getByTestId("setting-test-setting-reset");
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    await settle();
    await settle();

    expect(entry.reset).toHaveBeenCalledTimes(1);
    expect(entry.useValue).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("textbox")).toHaveValue("default");
    expect(reset).toBeDisabled();
  });

  it("resets a theme setting through the store without calling entry.reset", async () => {
    const entry = makeEntry({
      id: "theme",
      defaultValue: "system",
      reset: vi.fn().mockResolvedValue(undefined),
      useValue: vi.fn().mockResolvedValue("dark"),
    });
    render(<SettingControl entry={entry} />);
    await settle();

    fireEvent.click(screen.getByTestId("setting-theme-reset"));
    await settle();

    expect(mocks.setThemeMode).toHaveBeenCalledWith("system");
    expect(entry.reset).not.toHaveBeenCalled();
    expect(entry.setValue).not.toHaveBeenCalled();
  });

  it("hides reset when no default is declared, and reports a failed reset", async () => {
    const withoutDefault = makeEntry({
      reset: vi.fn().mockResolvedValue(undefined),
      useValue: vi.fn().mockResolvedValue("changed"),
    });
    const { unmount } = render(<SettingControl entry={withoutDefault} />);
    await settle();

    const hiddenReset = screen.getByTestId("setting-test-setting-reset");
    expect(hiddenReset).toBeDisabled();
    unmount();

    const failure = new Error("reset failed");
    const failing = makeEntry({
      defaultValue: "default",
      reset: vi.fn().mockRejectedValue(failure),
      useValue: vi.fn().mockResolvedValue("changed"),
    });
    render(<SettingControl entry={failing} />);
    await settle();

    fireEvent.click(screen.getByTestId("setting-test-setting-reset"));
    await settle();

    expect(mocks.captureError).toHaveBeenCalledWith(failure, {
      action: "setting.reset",
      settingId: failing.id,
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not render a reset button when the registry offers no reset", async () => {
    render(<SettingControl entry={makeEntry()} />);
    await settle();

    expect(
      screen.queryByTestId("setting-test-setting-reset")
    ).not.toBeInTheDocument();
  });
});
