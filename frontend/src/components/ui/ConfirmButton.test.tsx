import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmButton } from "./ConfirmButton";
import { ApiError } from "@/lib/api";

function setup(onConfirm: () => Promise<unknown> | unknown) {
  render(
    <ConfirmButton
      triggerLabel="Delete"
      confirmLabel="Confirm delete"
      title="Delete this?"
      description="This cannot be undone."
      onConfirm={onConfirm}
    />,
  );
}

describe("ConfirmButton", () => {
  it("shows the trigger initially and swaps to a warning + confirm/cancel on click", async () => {
    setup(vi.fn());

    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByText("Delete this?")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByText("Delete this?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("cancel returns to the idle trigger without calling onConfirm", async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm and returns to idle on success", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    setup(onConfirm);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument());
  });

  it("shows an error and stays in the confirm state when onConfirm rejects", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(409, { code: "CONFLICT", message: "Cannot delete right now" }));
    setup(onConfirm);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(screen.getByText("Cannot delete right now")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
  });
});
