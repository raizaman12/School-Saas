import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageUploadButton } from "./ImageUploadButton";

const imageMock = vi.fn();

vi.mock("@/lib/resources/uploads", () => ({
  uploadsApi: { image: (...args: unknown[]) => imageMock(...args) },
}));

function pngFile() {
  return new File(["fake-bytes"], "photo.png", { type: "image/png" });
}

describe("ImageUploadButton", () => {
  beforeEach(() => {
    imageMock.mockClear();
  });

  it("uploads the chosen file and reports the resulting URL", async () => {
    imageMock.mockResolvedValue({ url: "http://localhost:4000/uploads/t1/abc.png" });
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    render(<ImageUploadButton onUploaded={onUploaded} />);

    const input = screen.getByLabelText("Upload photo", { selector: "input" });
    await user.upload(input, pngFile());

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("http://localhost:4000/uploads/t1/abc.png"));
    expect(imageMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when the upload fails, without calling onUploaded", async () => {
    const { ApiError } = await import("@/lib/api");
    imageMock.mockRejectedValue(new ApiError(400, { code: "BAD_REQUEST", message: "Unsupported image type" }));
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    render(<ImageUploadButton onUploaded={onUploaded} />);

    const input = screen.getByLabelText("Upload photo", { selector: "input" });
    await user.upload(input, pngFile());

    expect(await screen.findByText("Unsupported image type")).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("uses a custom label when given", () => {
    render(<ImageUploadButton onUploaded={vi.fn()} label="Change logo" />);
    expect(screen.getByRole("button", { name: "Change logo" })).toBeInTheDocument();
  });
});
