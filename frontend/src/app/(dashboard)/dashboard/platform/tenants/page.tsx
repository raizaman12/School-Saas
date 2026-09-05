"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { platformApi, type TenantStatus } from "@/lib/resources/platform";
import type { TenantPlan } from "@/lib/auth/types";
import {
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
  Button,
} from "@/components/ui";

const STATUS_TONE: Record<TenantStatus, "success" | "default" | "warning" | "danger"> = {
  TRIAL: "default",
  ACTIVE: "success",
  SUSPENDED: "danger",
  CANCELLED: "warning",
};

export default function PlatformTenantsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, error } = useAsync(
    () =>
      platformApi.listTenants({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        status: (status || undefined) as TenantStatus | undefined,
        plan: (plan || undefined) as TenantPlan | undefined,
      }),
    [page, debouncedSearch, status, plan],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-title font-semibold text-slate-900">Schools</h1>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <Input
            label="Search"
            placeholder="School name or URL"
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
          className="w-40"
        >
          <option value="">All statuses</option>
          <option value="TRIAL">Trial</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
        <Select
          label="Plan"
          value={plan}
          onChange={(e) => {
            setPage(1);
            setPlan(e.target.value);
          }}
          className="w-40"
        >
          <option value="">All plans</option>
          <option value="TRIAL">Trial</option>
          <option value="BASIC">Basic</option>
          <option value="STANDARD">Standard</option>
          <option value="PREMIUM">Premium</option>
        </Select>
      </div>

      {isLoading && <Spinner label="Loading schools" />}
      {error && <p className="text-sm text-red-600">Failed to load schools: {error.message}</p>}

      {data && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>School</TableHeaderCell>
                <TableHeaderCell>URL</TableHeaderCell>
                <TableHeaderCell>Plan</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>City</TableHeaderCell>
                <TableHeaderCell>Signed up</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <Link
                      href={`/dashboard/platform/tenants/${tenant.id}`}
                      className="font-medium text-primary-600 hover:underline"
                    >
                      {tenant.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-500">{tenant.slug}</TableCell>
                  <TableCell>{tenant.plan}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[tenant.status]}>{tenant.status}</Badge>
                  </TableCell>
                  <TableCell>{tenant.city ?? "—"}</TableCell>
                  <TableCell>{new Date(tenant.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.data.length === 0 && <EmptyState message="No schools found." />}

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
