/**
 * FeedbackModal owns a form with two failure surfaces that are easy to fake as
 * success: a rejected screenshot and a rejected submission. Both are driven
 * through the real form here, with the network/Sentry boundary stubbed and put
 * back afterwards.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockTabs, resetBrowserMocks } from "../../../tests/mocks/browser";
import { i18n } from "../../../tests/mocks/i18n";

const mocks = vi.hoisted(() => ({
  sendUserFeedback: vi.fn(),
  captureError: vi.fn(),
  setReviewPromptState: vi.fn(),
  getStoreReviewUrl: vi.fn(() => "https://store.example/review"),
}));

vi.mock("@/lib/sentry", () => ({
  sendUserFeedback: mocks.sendUserFeedback,
  captureError: mocks.captureError,
}));
vi.mock("@/lib/review-prompt", () => ({
  setReviewPromptState: mocks.setReviewPromptState,
  getStoreReviewUrl: mocks.getStoreReviewUrl,
}));

import { FeedbackModal } from "./FeedbackModal";

const originalCreateObjectURL = URL.createObjectURL;

function imageFile() {
  return new File(["image"], "shot.png", { type: "image/png" });
}

function messageField() {
  return screen.getByRole("textbox", {
    name: i18n.t("options.feedback.messageLabel"),
  });
}

function submit() {
  return screen.getByRole("button", {
    name: i18n.t("options.feedback.submit"),
  });
}

beforeEach(() => {
  resetBrowserMocks();
  mocks.sendUserFeedback.mockReset().mockResolvedValue(undefined);
  mocks.captureError.mockReset();
  mocks.setReviewPromptState.mockReset().mockResolvedValue(undefined);
  mocks.getStoreReviewUrl.mockClear();
  URL.createObjectURL = vi.fn(
    () => "blob:preview"
  ) as unknown as typeof URL.createObjectURL;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalCreateObjectURL) {
    URL.createObjectURL = originalCreateObjectURL;
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
});

describe("FeedbackModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <FeedbackModal open={false} onClose={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("requires a message and clears the validation error once the user types", () => {
    const { container } = render(<FeedbackModal open onClose={vi.fn()} />);

    expect(submit()).toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("options.feedback.error")
    );

    fireEvent.change(messageField(), { target: { value: "Broken insert" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts an image screenshot and rejects a non-image file", () => {
    const { container } = render(<FeedbackModal open onClose={vi.fn()} />);
    const fileInput = container.querySelector("#feedback-screenshot")!;

    fireEvent.change(fileInput, { target: { files: [imageFile()] } });
    expect(
      screen.getByText(
        i18n.t("options.feedback.screenshotSelected", ["shot.png"])
      )
    ).toBeInTheDocument();
    expect(
      container.querySelector('img[src="blob:preview"]')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("options.feedback.removeScreenshot"),
      })
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(fileInput).toHaveValue("");

    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Please select an image file (PNG, JPG, GIF, etc.)"
    );
  });

  it("submits trimmed fields with the chosen screenshot and clears the form", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const file = imageFile();
    const { container } = render(<FeedbackModal open onClose={vi.fn()} />);
    const fileInput = container.querySelector("#feedback-screenshot")!;

    fireEvent.change(
      screen.getByRole("textbox", {
        name: i18n.t("options.feedback.nameLabel"),
      }),
      { target: { value: "  Ada  " } }
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: i18n.t("options.feedback.emailLabel"),
      }),
      { target: { value: " ada@example.com " } }
    );
    fireEvent.change(messageField(), {
      target: { value: "  Broken insert  " },
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(submit()).toBeEnabled();
    fireEvent.click(submit());
    await waitFor(() =>
      expect(mocks.sendUserFeedback).toHaveBeenCalledWith({
        name: "Ada",
        email: "ada@example.com",
        message: "Broken insert",
        screenshot: file,
      })
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      i18n.t("options.feedback.success")
    );
    expect(messageField()).toHaveValue("");
    expect(container.querySelector("img")).not.toBeInTheDocument();

    const flashReset = timeoutSpy.mock.calls.find(
      ([, delay]) => delay === 3000
    )?.[0] as (() => void) | undefined;
    expect(flashReset).toBeTypeOf("function");
    act(() => flashReset?.());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reports a failed submission without claiming success", async () => {
    const failure = new Error("network down");
    mocks.sendUserFeedback.mockRejectedValue(failure);
    render(<FeedbackModal open onClose={vi.fn()} />);

    fireEvent.change(messageField(), { target: { value: "Help" } });
    fireEvent.click(submit());

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(failure, {
        action: "sendUserFeedback",
      })
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("options.feedback.error")
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });

  it("closes on Escape and on the close button, resetting the form", () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <FeedbackModal open onClose={onClose} />
    );

    fireEvent.change(messageField(), { target: { value: "Draft" } });
    fireEvent.keyDown(container.firstChild!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<FeedbackModal open onClose={onClose} />);
    expect(messageField()).toHaveValue("");

    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common.closeModal") })
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores a non-Escape key while the modal is open", () => {
    const onClose = vi.fn();
    const { container } = render(<FeedbackModal open onClose={onClose} />);

    fireEvent.keyDown(container.firstChild!, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens the donation page and marks the store review as rated", () => {
    render(<FeedbackModal open onClose={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("options.feedback.donationAction"),
      })
    );
    expect(mockTabs.create).toHaveBeenCalledWith({
      url: "https://github.com/sponsors/jheysaaz",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("options.feedback.reviewBannerAction"),
      })
    );
    expect(mockTabs.create).toHaveBeenCalledWith({
      url: "https://store.example/review",
    });
    expect(mocks.setReviewPromptState).toHaveBeenCalledWith("rated");
  });
});
