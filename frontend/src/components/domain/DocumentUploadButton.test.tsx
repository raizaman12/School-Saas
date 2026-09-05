import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentUploadButton } from "./DocumentUploadButton";

const documentMock = vi.fn();

vi.mock("@/lib/resources/uploads", () => ({
  uploadsApi: { document: (...args: unknown[]) => documentMock(...args) },
}));

function pdfFile() {
  return new File(["fake-bytes"], "syllabus.pdf", { type: "application/pdf" });
}

describe("DocumentUploadButton", () => {
  beforeEach(() => {
    documentMock.mockClear();
  });

  it("uploads the chosen file and reports the resulting URL and original name", async () => {
    documentMock.mockResolvedValue({
      url: "http://localhost:4000/uploads/t1/abc.pdf",
      originalName: "syllabus.pdf",
    });
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    render(<DocumentUploadButton onUploaded={onUploaded} />);

    const input = screen.getByLabelText("Upload file", { selector: "input" });
    await user.upload(input, pdfFile());

    await waitFor(() =>
      expect(onUploaded).toHaveBeenCalledWith({
        url: "http://localhost:4000/uploads/t1/abc.pdf",
        originalName: "syllabus.pdf",
      }),
    );
    expect(documentMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when the upload fails, without calling onUploaded", async () => {
    const { ApiError } = await import("@/lib/api");
    documentMock.mockRejectedValue(new ApiError(400, { code: "BAD_REQUEST", message: "Unsupported file type" }));
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    render(<DocumentUploadButton onUploaded={onUploaded} />);

    const input = screen.getByLabelText("Upload file", { selector: "input" });
    await user.upload(input, pdfFile());

    expect(await screen.findByText("Unsupported file type")).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("uses a custom label when given", () => {
    render(<DocumentUploadButton onUploaded={vi.fn()} label="Attach a file" />);
    expect(screen.getByRole("button", { name: "Attach a file" })).toBeInTheDocument();
  });
});
