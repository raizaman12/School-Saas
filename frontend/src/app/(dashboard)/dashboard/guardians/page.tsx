"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { guardiansApi } from "@/lib/resources/guardians";
import {
  Input,
  Button,
  Badge,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
  Spinner,
} from "@/components/ui";

const RELATIONSHIP_LABEL: Record<string, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
};

/**
 * Standalone admin roster of parents/guardians — separate from the
 * per-student "Guardians" card on a student's own detail page (which only
 * shows the handful linked to that one student). This page exists so an
 * admin/front-desk/accountant/teacher can find, view, edit contact info
 * for, or (SCHOOL_ADMIN only) delete a parent record directly, without
 * first having to know which student they're linked to — mirrors the
 * Students and Staff list pages' search+table pattern.
 */
export default function GuardiansPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, error } = useAsync(
    () => guardiansApi.list({ page, limit: 20, search: debouncedSearch || undefined }),
    [page, debouncedSearch],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-title font-semibold text-slate-900">Parents / Guardians</h1>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <Input
            label="Search"
            placeholder="Name, phone, or email"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
          <Search className="pointer-events-none absolute right-3 top-9 size-4 text-slate-400" aria-hidden="true" />
        </div>
      </div>

      {isLoading && <Spinner label="Loading guardians" />}
      {error && <p className="text-sm text-red-600">Failed to load guardians: {error.message}</p>}

      {data && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Relationship</TableHeaderCell>
                <TableHeaderCell>Phone</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
                <TableHeaderCell>Portal login</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((guardian) => (
                <TableRow key={guardian.id}>
                  <TableCell>
                    <Link
                      href={`/dashboard/guardians/${guardian.id}`}
                      className="font-medium text-primary-600 hover:underline"
                    >
                      {guardian.fullName}
                    </Link>
                  </TableCell>
                  <TableCell>{RELATIONSHIP_LABEL[guardian.relationship] ?? guardian.relationship}</TableCell>
                  <TableCell>{guardian.phone}</TableCell>
                  <TableCell>{guardian.email ?? "—"}</TableCell>
                  <TableCell>
                    {guardian.userId ? <Badge tone="success">Active</Badge> : <Badge tone="default">None</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.data.length === 0 && <EmptyState message="No guardians found." />}

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Page {data.meta.page} of {data.meta.totalPages} — {data.meta.total} total
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
