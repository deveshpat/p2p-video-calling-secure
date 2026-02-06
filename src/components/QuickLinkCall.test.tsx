import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickLinkCall } from "./QuickLinkCall";

const { createRoomMock } = vi.hoisted(() => ({
  createRoomMock: vi.fn<
    () => Promise<{
      roomId: string;
      joinUrl: string;
      expiresAt: number;
    }>
  >(),
}));

vi.mock("../lib/meetingApi", async () => {
  const actual = await vi.importActual<typeof import("../lib/meetingApi")>("../lib/meetingApi");
  return {
    ...actual,
    createRoom: createRoomMock,
    resolveApiBaseUrl: () => "http://127.0.0.1:8787",
  };
});

describe("QuickLinkCall", () => {
  const clipboardWriteText = vi.fn<{
    (text: string): Promise<void>;
  }>();

  beforeEach(() => {
    window.location.hash = "#/quick";
    window.localStorage.clear();
    window.sessionStorage.clear();

    createRoomMock.mockReset();
    createRoomMock.mockResolvedValue({
      roomId: "meet-abcd1234efgh",
      joinUrl: "https://example.com/#/quick/meet-abcd1234efgh",
      expiresAt: Date.now() + 60_000,
    });

    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
  });

  it("creates a room and routes to that room", async () => {
    const onRoomChange = vi.fn<(roomId: string | null) => void>();
    render(<QuickLinkCall roomId={null} onRoomChange={onRoomChange} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New meeting" }));

    await waitFor(() => {
      expect(createRoomMock).toHaveBeenCalledTimes(1);
    });
    expect(onRoomChange).toHaveBeenCalledWith("meet-abcd1234efgh");
  });

  it("joins from a full invite link", async () => {
    const onRoomChange = vi.fn<(roomId: string | null) => void>();
    render(<QuickLinkCall roomId={null} onRoomChange={onRoomChange} />);
    const user = userEvent.setup();

    await user.type(
      screen.getByPlaceholderText("Enter a meeting code or full meeting link"),
      "https://example.com/#/quick/meet-abcd1234efgh",
    );
    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(onRoomChange).toHaveBeenCalledWith("meet-abcd1234efgh");
  });

  it("shows validation feedback for invalid meeting code", async () => {
    const onRoomChange = vi.fn<(roomId: string | null) => void>();
    render(<QuickLinkCall roomId={null} onRoomChange={onRoomChange} />);
    const user = userEvent.setup();

    await user.type(
      screen.getByPlaceholderText("Enter a meeting code or full meeting link"),
      "bad room id!",
    );
    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(onRoomChange).not.toHaveBeenCalled();
    expect(
      screen.getByText("Use a full meeting link or a valid meeting code."),
    ).toBeInTheDocument();
  });
});
