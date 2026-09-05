import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeeklyTimetableGrid, type TimetableBlock } from "./WeeklyTimetableGrid";

function block(overrides: Partial<TimetableBlock> = {}): TimetableBlock {
  return {
    id: "slot1",
    dayOfWeek: "MONDAY",
    startTime: "1970-01-01T08:00:00.000Z",
    endTime: "1970-01-01T08:45:00.000Z",
    title: "Mathematics",
    subtitle: "Mr. Farooq",
    room: "C9",
    colorKey: "sub1",
    ...overrides,
  };
}

describe("WeeklyTimetableGrid", () => {
  it("renders all 7 days of the week", () => {
    render(<WeeklyTimetableGrid blocks={[]} />);
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
  });

  it("renders a block's title, subtitle, room, and formatted time range", () => {
    render(<WeeklyTimetableGrid blocks={[block()]} />);

    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Mr. Farooq")).toBeInTheDocument();
    expect(screen.getByText("C9")).toBeInTheDocument();
    expect(screen.getByText("08:00–08:45")).toBeInTheDocument();
  });

  it("omits the room line when a block has no room number", () => {
    render(<WeeklyTimetableGrid blocks={[block({ room: null })]} />);

    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.queryByText("C9")).not.toBeInTheDocument();
  });

  it("renders multiple blocks on different days independently", () => {
    render(
      <WeeklyTimetableGrid
        blocks={[
          block({ id: "slot1", dayOfWeek: "MONDAY", title: "Mathematics" }),
          block({ id: "slot2", dayOfWeek: "FRIDAY", title: "Physics", subtitle: "Ms. Ayesha", room: "B2" }),
        ]}
      />,
    );

    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Physics")).toBeInTheDocument();
    expect(screen.getByText("Ms. Ayesha")).toBeInTheDocument();
    expect(screen.getByText("B2")).toBeInTheDocument();
  });

  it("renders nothing block-related when given an empty list (no crash on an all-empty week)", () => {
    render(<WeeklyTimetableGrid blocks={[]} />);
    expect(screen.queryByText("Mathematics")).not.toBeInTheDocument();
  });
});
