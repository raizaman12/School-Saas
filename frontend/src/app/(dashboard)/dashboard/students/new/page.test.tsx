import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewStudentPage from "./page";

const createMock = vi.fn();
const imageMock = vi.fn();

vi.mock("@/lib/resources/students", () => ({
  studentsApi: { create: (...args: unknown[]) => createMock(...args) },
}));

vi.mock("@/lib/resources/uploads", () => ({
  uploadsApi: { image: (...args: unknown[]) => imageMock(...args) },
}));

// SectionCascadeSelect pulls academic years/classes/sections over the
// network on mount — irrelevant to this page's own behavior, so it's
// stubbed with empty lists rather than mocking academicsApi's three calls.
vi.mock("@/components/domain/SectionCascadeSelect", () => ({
  SectionCascadeSelect: () => null,
}));

function pngFile() {
  return new File(["fake-bytes"], "photo.png", { type: "image/png" });
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Full name/), "Ayesha Bibi");
  await user.type(screen.getByLabelText(/Date of birth/), "2016-05-01");
}

describe("NewStudentPage — photo upload", () => {
  beforeEach(() => {
    createMock.mockClear();
    imageMock.mockClear();
  });

  it("shows an empty placeholder and no preview before a photo is picked", () => {
    render(<NewStudentPage />);
    expect(screen.getByText("No photo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeInTheDocument();
  });

  it("uploads a photo, previews it, and submits its URL along with the student", async () => {
    imageMock.mockResolvedValue({ url: "http://localhost:4000/uploads/t1/photo.png" });
    createMock.mockResolvedValue({
      data: { id: "s1", fullName: "Ayesha Bibi", studentCode: "TS-2026-000001" },
      portalLogin: { email: null, loginId: "ts2026000001", tempPassword: "Temp-abc123" },
    });
    const user = userEvent.setup();
    render(<NewStudentPage />);

    const fileInput = screen.getByLabelText("Upload photo", { selector: "input" });
    await user.upload(fileInput, pngFile());

    await waitFor(() => expect(imageMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByAltText("Student photo preview")).toHaveAttribute(
      "src",
      "http://localhost:4000/uploads/t1/photo.png",
    );
    // The button now offers to replace the photo rather than add a first one.
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Save student" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ photoUrl: "http://localhost:4000/uploads/t1/photo.png" }),
    );
  });

  it("admits a student with no photoUrl at all when none was uploaded", async () => {
    createMock.mockResolvedValue({
      data: { id: "s2", fullName: "Ayesha Bibi", studentCode: "TS-2026-000002" },
      portalLogin: { email: null, loginId: "ts2026000002", tempPassword: "Temp-def456" },
    });
    const user = userEvent.setup();
    render(<NewStudentPage />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Save student" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ photoUrl: undefined }));
  });
});
