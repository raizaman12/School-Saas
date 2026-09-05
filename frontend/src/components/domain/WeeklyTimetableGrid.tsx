import { MapPin } from "lucide-react";
import { formatSlotTime, type DayOfWeek } from "@/lib/resources/academics";
import { cn } from "@/lib/utils";

// Kept local (not imported from the academics admin page) so this shared
// component has no dependency on that page's own internals — same 7-day,
// Monday-first ordering used everywhere else in the app (admin's timetable
// builder, the teacher's existing day-by-day classes list).
const DAYS_OF_WEEK: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};
const DAY_LABELS_SHORT: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

/**
 * One colored block on the grid. Deliberately generic (not "a
 * TimetableSlot") so the same grid renders a teacher's own timetable
 * (title = subject, subtitle = class/section) and a student's (title =
 * subject, subtitle = teacher name) from two different API shapes without
 * either caller reshaping data further than picking these five fields.
 */
export interface TimetableBlock {
  id: string;
  dayOfWeek: DayOfWeek;
  // Same "HH:MM" (or ISO-with-meaningful-UTC-time-of-day) strings the rest
  // of the app already passes around — read only via formatSlotTime /
  // minutesSinceMidnight below, never parsed as a real date.
  startTime: string;
  endTime: string;
  title: string;
  subtitle: string;
  room: string | null;
  /** Any stable string (e.g. a subject id) — picks this block's color from the palette below. */
  colorKey: string;
}

// Same bg-100/text-800/border-300 tone convention already used across the
// app (see AttendanceTab's ATTENDANCE_STATUS_OPTIONS) — a rotating palette
// so different subjects/courses are visually distinguishable at a glance,
// rather than the single flat color a plain printed timetable would use.
const PALETTE = [
  "bg-primary-100 text-primary-800 border-primary-300",
  "bg-emerald-100 text-emerald-800 border-emerald-300",
  "bg-amber-100 text-amber-800 border-amber-300",
  "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300",
  "bg-sky-100 text-sky-800 border-sky-300",
  "bg-rose-100 text-rose-800 border-rose-300",
  "bg-violet-100 text-violet-800 border-violet-300",
  "bg-teal-100 text-teal-800 border-teal-300",
];

function paletteFor(colorKey: string): string {
  let hash = 0;
  for (let i = 0; i < colorKey.length; i++) hash = (hash * 31 + colorKey.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Mirrors the backend's/other pages' minutesSinceMidnightUtc — see their doc comments for the @db.Time round-trip this reads. */
function minutesSinceMidnight(value: string): number {
  const match = value.match(/(\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

const PX_PER_MINUTE = 1.3;
const DEFAULT_RANGE_START_MINUTES = 8 * 60; // 8:00AM — a reasonable school-day default when there's nothing to measure against.
const DEFAULT_RANGE_END_MINUTES = 15 * 60; // 3:00PM

/**
 * A Monday–Sunday weekly grid of colored lecture blocks, positioned by
 * actual time-of-day (not just listed) — the same "glance at your week"
 * layout a real printed school timetable has. Read-only: this is a
 * display component only, used by both the teacher dashboard's own
 * timetable and the student/parent portal's, from two different API
 * endpoints that already produce the same TimetableBlock shape.
 */
export function WeeklyTimetableGrid({ blocks }: { blocks: TimetableBlock[] }) {
  const rangeStart = blocks.length
    ? Math.min(DEFAULT_RANGE_START_MINUTES, ...blocks.map((b) => minutesSinceMidnight(b.startTime)))
    : DEFAULT_RANGE_START_MINUTES;
  const rangeEndRaw = blocks.length
    ? Math.max(DEFAULT_RANGE_END_MINUTES, ...blocks.map((b) => minutesSinceMidnight(b.endTime)))
    : DEFAULT_RANGE_END_MINUTES;
  // Round the visible range out to whole hours so the hour gridlines/labels line up cleanly.
  const startHour = Math.floor(rangeStart / 60);
  const endHour = Math.ceil(rangeEndRaw / 60);
  const rangeStartMinutes = startHour * 60;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const totalHeightPx = (endHour - startHour) * 60 * PX_PER_MINUTE;

  const blocksByDay = new Map<DayOfWeek, TimetableBlock[]>();
  for (const day of DAYS_OF_WEEK) blocksByDay.set(day, []);
  for (const block of blocks) blocksByDay.get(block.dayOfWeek)?.push(block);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="grid min-w-[820px]" style={{ gridTemplateColumns: "64px repeat(7, minmax(108px, 1fr))" }}>
        <div className="border-b border-slate-200 bg-slate-50" />
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day}
            className="border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600"
          >
            <span className="hidden sm:inline">{DAY_LABELS[day]}</span>
            <span className="sm:hidden">{DAY_LABELS_SHORT[day]}</span>
          </div>
        ))}

        <div className="relative" style={{ height: totalHeightPx }}>
          {hours.map((h, i) => (
            <div
              key={h}
              className="absolute inset-x-0 -translate-y-1/2 text-right text-xs text-slate-400"
              style={{ top: i * 60 * PX_PER_MINUTE }}
            >
              <span className="pr-1.5">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>

        {DAYS_OF_WEEK.map((day) => (
          <div key={day} className="relative border-l border-slate-200" style={{ height: totalHeightPx }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: i * 60 * PX_PER_MINUTE }} />
            ))}
            {(blocksByDay.get(day) ?? []).map((block) => {
              const top = (minutesSinceMidnight(block.startTime) - rangeStartMinutes) * PX_PER_MINUTE;
              const height = Math.max(
                (minutesSinceMidnight(block.endTime) - minutesSinceMidnight(block.startTime)) * PX_PER_MINUTE,
                36,
              );
              return (
                <div
                  key={block.id}
                  className={cn(
                    "absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-1 text-xs leading-tight",
                    paletteFor(block.colorKey),
                  )}
                  style={{ top, height }}
                  title={`${block.title} — ${block.subtitle}${block.room ? ` — Room ${block.room}` : ""}`}
                >
                  <p className="truncate font-semibold">{block.title}</p>
                  <p className="truncate">{block.subtitle}</p>
                  <p className="truncate text-[11px] opacity-90">
                    {formatSlotTime(block.startTime)}–{formatSlotTime(block.endTime)}
                  </p>
                  {block.room && (
                    <p className="mt-0.5 flex items-center gap-0.5 truncate text-[11px] opacity-90">
                      <MapPin className="size-3 shrink-0" aria-hidden="true" />
                      {block.room}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
