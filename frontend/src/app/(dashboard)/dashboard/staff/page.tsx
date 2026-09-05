"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { staffApi } from "@/lib/resources/staff";
import {
  Button,
  Input,
  Select,
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

const STATUS_TONE: Record<string, "success" | "default" | "warning" | "danger"> = {
  ACTIVE: "success",
  ON_LEAVE: "warning",
  TERMINATED: "danger",
};

export default function StaffPage() {
  const { user } = useAuth();
  // Mirrors the backend's WRITE_ROLES for /api/staff (staff/staff.ts) —
  // ACCOUNTANT can view the staff list (payroll work needs it) but should
  // never see a way to add staff; this was just a missing UI-level gate on
  // an already-correct API.
  const canWrite = user?.role === "SCHOOL_ADMIN";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, error } = useAsync(
    () =>
      staffApi.list({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        status: (status || undefined) as never,
      }),
    [page, debouncedSearch, status],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-title font-semibold text-slate-900">Staff</h1>
        {canWrite && (
          <Link href="/dashboard/staff/new">
            <Button size="sm">
              <Plus className="size-4" aria-hidden="true" />
              Add staff
            </Button>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <Input
            label="Search"
            placeholder="Name, employee code, designation"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
          <Search className="pointer-events-none absolute right-3 top-9 size-4 text-slate-400" aria-hidden="true" />
        </div>
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="w-48"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="ON_LEAVE">On leave</option>
          <option value="TERMINATED">Terminated</option>
        </Select>
      </div>

      {isLoading && <Spinner label="Loading staff" />}
      {error && <p className="text-sm text-red-600">Failed to load staff: {error.message}</p>}

      {data && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Employee code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Designation</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((staff) => (
                <TableRow key={staff.id}>
                  <TableCell>
                    <Link href={`/dashboard/staff/${staff.id}`} className="font-medium text-primary-600 hover:underline">
                      {staff.employeeCode}
                    </Link>
                  </TableCell>
                  <TableCell>{staff.user.fullName}</TableCell>
                  <TableCell>{staff.user.role}</TableCell>
                  <TableCell>{staff.designation}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[staff.status] ?? "default"}>{staff.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.data.length === 0 && <EmptyState message="No staff found." />}

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Page {data.meta.page} of {data.meta.totalPages} — {data.meta.total} total
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
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
