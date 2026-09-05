"use client";

import { useEffect, useMemo, useState } from "react";
import { useAsync } from "@/lib/hooks/useAsync";
import { academicsApi, type Section } from "@/lib/resources/academics";
import { Select, Spinner } from "@/components/ui";

interface SectionCascadeSelectProps {
  onChange: (value: { sectionId: string; academicYearId: string; section: Section } | null) => void;
  /** Restrict the year dropdown to the currently-active academic year only. */
  activeYearOnly?: boolean;
}

/**
 * Academic Year -> Class -> Section cascading picker. Reused anywhere a
 * staff member needs to scope an action to one section (attendance
 * marking, student enrollment, fee invoice generation).
 */
export function SectionCascadeSelect({ onChange, activeYearOnly }: SectionCascadeSelectProps) {
  const { data: years, isLoading: yearsLoading } = useAsync(() => academicsApi.listYears(), []);
  const { data: classes, isLoading: classesLoading } = useAsync(() => academicsApi.listClasses(), []);
  const { data: sections, isLoading: sectionsLoading } = useAsync(() => academicsApi.listSections(), []);

  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");

  const visibleYears = useMemo(
    () => (years ?? []).filter((y) => !activeYearOnly || y.isActive),
    [years, activeYearOnly],
  );

  useEffect(() => {
    if (!yearId && visibleYears.length > 0) {
      const active = visibleYears.find((y) => y.isActive) ?? visibleYears[0];
      setYearId(active.id);
    }
  }, [visibleYears, yearId]);

  const sectionsForYearClass = useMemo(
    () => (sections ?? []).filter((s) => s.academicYear.id === yearId && (!classId || s.schoolClass.id === classId)),
    [sections, yearId, classId],
  );

  useEffect(() => {
    setSectionId("");
  }, [yearId, classId]);

  useEffect(() => {
    const section = sectionsForYearClass.find((s) => s.id === sectionId);
    if (section && yearId) {
      onChange({ sectionId, academicYearId: yearId, section });
    } else {
      onChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, yearId]);

  if (yearsLoading || classesLoading || sectionsLoading) return <Spinner label="Loading sections" />;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Select label="Academic year" value={yearId} onChange={(e) => setYearId(e.target.value)}>
        <option value="">Select year</option>
        {visibleYears.map((y) => (
          <option key={y.id} value={y.id}>
            {y.name}
            {y.isActive ? " (active)" : ""}
          </option>
        ))}
      </Select>
      <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
        <option value="">All classes</option>
        {(classes ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!yearId}>
        <option value="">Select section</option>
        {sectionsForYearClass.map((s) => (
          <option key={s.id} value={s.id}>
            {s.schoolClass.name} - {s.name} ({s._count.students} students)
          </option>
        ))}
      </Select>
    </div>
  );
}
