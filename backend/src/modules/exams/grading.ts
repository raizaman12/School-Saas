// Percentage -> letter-grade band matching. Historically a single hardcoded
// scale; now per-tenant configurable via the `GradingBand` model (see
// gradingBands.ts) so a Matric-board school and an O/A-Levels school can
// each use their own scale. `DEFAULT_GRADE_BANDS` is what a fresh tenant is
// seeded with at signup (see auth.service.ts) — kept here so the "sane
// default" behavior documented for Day 5 is still visible/testable without
// a DB round-trip, and as the fallback if a tenant somehow has zero bands
// configured (defensive — should never happen post-seeding).
export const DEFAULT_GRADE_BANDS: { grade: string; minPercentage: number; sortOrder: number }[] = [
  { grade: 'A+', minPercentage: 90, sortOrder: 0 },
  { grade: 'A', minPercentage: 80, sortOrder: 1 },
  { grade: 'B', minPercentage: 70, sortOrder: 2 },
  { grade: 'C', minPercentage: 60, sortOrder: 3 },
  { grade: 'D', minPercentage: 50, sortOrder: 4 },
  { grade: 'E', minPercentage: 33, sortOrder: 5 },
  { grade: 'F', minPercentage: 0, sortOrder: 6 },
];

export interface GradeBand {
  grade: string;
  minPercentage: number;
}

/**
 * Finds the highest band whose `minPercentage` is <= the score — bands
 * don't need to be pre-sorted, this sorts a defensive copy descending by
 * threshold first. Falls back to 'F' only if `bands` is empty (shouldn't
 * happen for a properly-seeded tenant).
 */
export function gradeForPercentage(percentage: number, bands: GradeBand[] = DEFAULT_GRADE_BANDS): string {
  const sorted = [...bands].sort((a, b) => b.minPercentage - a.minPercentage);
  const band = sorted.find((b) => percentage >= b.minPercentage);
  return band?.grade ?? 'F';
}

export function isPassing(marksObtained: number, passingMarks: number): boolean {
  return marksObtained >= passingMarks;
}
