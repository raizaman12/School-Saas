import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomFieldsPage from "./page";

const listDefinitionsMock = vi.fn();
const createDefinitionMock = vi.fn();
const updateDefinitionMock = vi.fn();
const removeDefinitionMock = vi.fn();

vi.mock("@/lib/resources/customFields", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/customFields")>(
    "@/lib/resources/customFields",
  );
  return {
    ...actual,
    customFieldsApi: {
      listDefinitions: (...args: unknown[]) => listDefinitionsMock(...args),
      createDefinition: (...args: unknown[]) => createDefinitionMock(...args),
      updateDefinition: (...args: unknown[]) => updateDefinitionMock(...args),
      removeDefinition: (...args: unknown[]) => removeDefinitionMock(...args),
      getStudentValues: vi.fn(),
      saveStudentValues: vi.fn(),
    },
  };
});

describe("CustomFieldsPage", () => {
  beforeEach(() => {
    listDefinitionsMock.mockReset();
    createDefinitionMock.mockReset();
    updateDefinitionMock.mockReset();
    removeDefinitionMock.mockReset();
  });

  it("lists existing field definitions", async () => {
    listDefinitionsMock.mockResolvedValue([
      {
        id: "f1",
        label: "Transport Route",
        fieldType: "SELECT",
        options: ["Route A", "Route B"],
        required: false,
        active: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    render(<CustomFieldsPage />);

    expect(await screen.findByText("Transport Route")).toBeInTheDocument();
    expect(screen.getByText("Route A, Route B")).toBeInTheDocument();
    expect(screen.getByText("Dropdown")).toBeInTheDocument();
  });

  it("shows an empty state when no fields exist yet", async () => {
    listDefinitionsMock.mockResolvedValue([]);
    render(<CustomFieldsPage />);

    expect(await screen.findByText(/No custom fields yet/)).toBeInTheDocument();
  });

  it("creates a TEXT field via the Add field form", async () => {
    listDefinitionsMock.mockResolvedValue([]);
    createDefinitionMock.mockResolvedValue({ id: "f2" });
    const user = userEvent.setup();
    render(<CustomFieldsPage />);

    await screen.findByText(/No custom fields yet/);
    await user.click(screen.getByRole("button", { name: "Add field" }));
    const form = screen.getByTestId("create-custom-field-form");
    await user.type(within(form).getByLabelText(/Field label/), "Previous School");
    await user.click(within(form).getByRole("button", { name: "Add field" }));

    await waitFor(() => expect(createDefinitionMock).toHaveBeenCalledTimes(1));
    expect(createDefinitionMock).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Previous School", fieldType: "TEXT" }),
    );
  });

  it("requires at least one option when creating a Dropdown field", async () => {
    listDefinitionsMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<CustomFieldsPage />);

    await screen.findByText(/No custom fields yet/);
    await user.click(screen.getByRole("button", { name: "Add field" }));
    const form = screen.getByTestId("create-custom-field-form");
    await user.type(within(form).getByLabelText(/Field label/), "Transport Route");
    await user.selectOptions(within(form).getByLabelText(/Field type/), "SELECT");
    await user.click(within(form).getByRole("button", { name: "Add field" }));

    expect(await screen.findByText(/List at least one option/)).toBeInTheDocument();
    expect(createDefinitionMock).not.toHaveBeenCalled();
  });

  it("disables a field via the Disable action", async () => {
    listDefinitionsMock.mockResolvedValue([
      {
        id: "f1",
        label: "Previous School",
        fieldType: "TEXT",
        options: null,
        required: false,
        active: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    updateDefinitionMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<CustomFieldsPage />);

    await screen.findByText("Previous School");
    await user.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => expect(updateDefinitionMock).toHaveBeenCalledWith("f1", { active: false }));
  });
});
