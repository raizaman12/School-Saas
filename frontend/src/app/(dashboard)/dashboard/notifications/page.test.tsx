import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import NotificationsPage from "./page";

const listMock = vi.fn().mockResolvedValue({
  data: [],
  meta: { page: 1, limit: 20, total: 0, totalPages: 1, unreadCount: 0 },
});
const channelStatusMock = vi.fn();

vi.mock("@/lib/resources/notifications", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/notifications")>(
    "@/lib/resources/notifications",
  );
  return {
    ...actual,
    notificationsApi: {
      list: (...args: unknown[]) => listMock(...args),
      markRead: vi.fn(),
      broadcast: vi.fn(),
      channelStatus: (...args: unknown[]) => channelStatusMock(...args),
    },
  };
});

vi.mock("@/components/domain/SectionCascadeSelect", () => ({
  SectionCascadeSelect: () => null,
}));

describe("NotificationsPage — channel status", () => {
  beforeEach(() => {
    listMock.mockClear();
    channelStatusMock.mockClear();
  });

  it("shows a warning banner naming every simulated channel", async () => {
    channelStatusMock.mockResolvedValue({
      SMS: { live: false, provider: "none (simulated)" },
      WHATSAPP: { live: true, provider: "WhatsApp Cloud API" },
      EMAIL: { live: false, provider: "none (simulated)" },
    });

    render(<NotificationsPage />);

    await waitFor(() =>
      expect(screen.getByText(/Some channels are not connected to a real provider yet/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/SMS — simulated/)).toBeInTheDocument();
    expect(screen.getByText(/Email — simulated/)).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp — simulated/)).not.toBeInTheDocument();
  });

  it("shows no banner at all once every channel is live", async () => {
    channelStatusMock.mockResolvedValue({
      SMS: { live: true, provider: "Twilio" },
      WHATSAPP: { live: true, provider: "WhatsApp Cloud API" },
      EMAIL: { live: true, provider: "SMTP" },
    });

    render(<NotificationsPage />);

    await waitFor(() => expect(channelStatusMock).toHaveBeenCalled());
    expect(screen.queryByText(/Some channels are not connected/)).not.toBeInTheDocument();
  });
});
