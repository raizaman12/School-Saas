import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentsPage from "./page";

const listMock = vi.fn().mockResolvedValue({
  data: [],
  meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
});
const bulkImportMock = vi.fn();

vi.mock("@/lib/resources/students", () => ({
  studentsApi: {
    list: (...args: unknown[]) => listMock(...args),
    bulkImport: (...args: unknown[]) => bulkImportMock(...args),
  },
}));

// SCHOOL_ADMIN by default — these bulk-import tests exercise Add/Bulk-import
// UI that's now gated behind canWrite (see students/page.tsx); a dedicated
// role-gating test below overrides this per-test.
let mockRole: string | undefined = "SCHOOL_ADMIN";
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", role: mockRole } }),
}));

function csvFile(contents: string) {
  return new File([contents], "students.csv", { type: "text/csv" });
}

describe("StudentsPage — bulk import", () => {
  beforeEach(() => {
    listMock.mockClear();
    bulkImportMock.mockClear();
    mockRole = "SCHOOL_ADMIN";
  });

  it("opens the panel, uploads a CSV, and shows the per-row results", async () => {
    bulkImportMock.mockResolvedValue({
      totalRows: 2,
      created: 1,
      failed: 1,
      results: [
        { row: 2, status: "created", studentCode: "TS-2026-000001", fullName: "Ahmed Khan" },
        { row: 3, status: "error", fullName: "", error: "fullName: Required" },
      ],
    });
    const user = userEvent.setup();
    render(<StudentsPage />);

    await user.click(screen.getByRole("button", { name: /Bulk import/ }));
    expect(screen.getByText(/Expected CSV columns/)).toBeInTheDocument();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, csvFile("fullName,gender,dateOfBirth\nAhmed Khan,MALE,2015-03-10"));

    await waitFor(() => expect(bulkImportMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/1 of 2 rows created, 1 failed/)).toBeInTheDocument();
    expect(screen.getByText(/Created \(TS-2026-000001\)/)).toBeInTheDocument();
    expect(screen.getByText(/fullName: Required/)).toBeInTheDocument();

    // At least one row was created, so the list refetches.
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it("shows an error and does not refetch the list when the import itself fails", async () => {
    const { ApiError } = await import("@/lib/api");
    bulkImportMock.mockRejectedValue(new ApiError(400, { code: "BAD_REQUEST", message: "Expected a .csv file" }));
    const user = userEvent.setup();
    render(<StudentsPage />);

    await user.click(screen.getByRole("button", { name: /Bulk import/ }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, csvFile("not a csv"));

    expect(await screen.findByText("Expected a .csv file")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledTimes(1); // just the initial page load, no refetch
  });
});

describe("StudentsPage — role gating", () => {
  beforeEach(() => {
    listMock.mockClear();
    bulkImportMock.mockClear();
  });

  it("SCHOOL_ADMIN and FRONT_DESK see Add student/Bulk import; ACCOUNTANT does not", async () => {
    mockRole = "SCHOOL_ADMIN";
    const { unmount } = render(<StudentsPage />);
    expect(await screen.findByRole("button", { name: /Add student/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bulk import/ })).toBeInTheDocument();
    unmount();

    mockRole = "FRONT_DESK";
    const { unmount: unmount2 } = render(<StudentsPage />);
    expect(await screen.findByRole("button", { name: /Add student/ })).toBeInTheDocument();
    unmount2();

    mockRole = "ACCOUNTANT";
    render(<StudentsPage />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Add student/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bulk import/ })).not.toBeInTheDocument();
  });
});
