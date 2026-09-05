"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { studentsApi } from "@/lib/resources/students";
import { guardiansApi } from "@/lib/resources/guardians";
import { staffApi } from "@/lib/resources/staff";
import { Badge, Input, Spinner } from "@/components/ui";

export type RecipientCategory = "student" | "guardian" | "staff";

export interface SelectedRecipient {
  id: string;
  label: string;
  category: RecipientCategory;
}

const CATEGORY_LABEL: Record<RecipientCategory, string> = {
  student: "Students",
  guardian: "Guardians",
  staff: "Staff",
};

/**
 * Search-and-pick UI for targeting an INDIVIDUAL notice at one or more
 * specific people, mirroring how a school office picks named students,
 * parents, or teachers rather than a broad audience. Selection spans all
 * three categories at once — e.g. a fee reminder can go to one student AND
 * their guardian in the same notice.
 */
export function RecipientPicker({
  selected,
  onChange,
}: {
  selected: SelectedRecipient[];
  onChange: (people: SelectedRecipient[]) => void;
}) {
  const [category, setCategory] = useState<RecipientCategory>("student");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const { data: results, isLoading } = useAsync(async () => {
    if (category === "student") {
      const res = await studentsApi.list({ page: 1, limit: 10, search: debouncedSearch || undefined });
      return res.data.map((s) => ({ id: s.id, label: `${s.fullName} (${s.studentCode})` }));
    }
    if (category === "guardian") {
      const res = await guardiansApi.list({ page: 1, limit: 10, search: debouncedSearch || undefined });
      return res.data.map((g) => ({ id: g.id, label: `${g.fullName} — ${g.phone}` }));
    }
    const res = await staffApi.list({ page: 1, limit: 10, search: debouncedSearch || undefined });
    return res.data.map((s) => ({ id: s.user.id, label: `${s.user.fullName} — ${s.designation}` }));
  }, [category, debouncedSearch]);

  const isSelected = (id: string, cat: RecipientCategory) => selected.some((p) => p.id === id && p.category === cat);

  const toggle = (id: string, label: string, cat: RecipientCategory) => {
    if (isSelected(id, cat)) {
      onChange(selected.filter((p) => !(p.id === id && p.category === cat)));
    } else {
      onChange([...selected, { id, label, category: cat }]);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        {(Object.keys(CATEGORY_LABEL) as RecipientCategory[]).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === cat ? "bg-primary-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {CATEGORY_LABEL[cat]}
          </button>
        ))}
      </div>

      <Input
        placeholder={`Search ${CATEGORY_LABEL[category].toLowerCase()} by name...`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
        {isLoading && (
          <div className="p-2">
            <Spinner label="Searching" />
          </div>
        )}
        {!isLoading && results?.length === 0 && (
          <p className="p-2 text-xs text-slate-500">No {CATEGORY_LABEL[category].toLowerCase()} found.</p>
        )}
        {!isLoading &&
          results?.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => toggle(r.id, r.label, category)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                isSelected(r.id, category) ? "bg-primary-50 text-primary-700" : "text-slate-700"
              }`}
            >
              {r.label}
              {isSelected(r.id, category) && <span className="text-xs">Selected</span>}
            </button>
          ))}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <Badge key={`${p.category}-${p.id}`} tone="info" className="flex items-center gap-1">
              {p.label}
              <button
                type="button"
                onClick={() => toggle(p.id, p.label, p.category)}
                aria-label={`Remove ${p.label}`}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
