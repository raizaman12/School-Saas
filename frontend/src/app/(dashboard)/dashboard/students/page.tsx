"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Plus, Search, Upload, FileSpreadsheet } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { studentsApi, type BulkImportResult } from "@/lib/resources/students";
import { ApiError } from "@/lib/api";
import {
  Button,
  Input,
  Select,
  Badge,
  Alert,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
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
  INACTIVE: "default",
  GRADUATED: "default",
  TRANSFERRED_OUT: "warning",
  EXPELLED: "danger",
};

const BULK_IMPORT_COLUMNS = [
  "fullName (required)",
  "gender — MALE/FEMALE/OTHER (required)",
  "dateOfBirth — YYYY-MM-DD (required)",
  "admissionDate",
  "bFormOrCnic — 35202-1234567-1",
  "address",
  "city",
  "contactPhone",
  "rollNumber",
  "className — must match an existing class exactly, e.g. \"Class 5\"",
  "sectionName — must match an existing section in that class, e.g. \"A\" (className and sectionName go together)",
  "email — auto-creates a student portal login if given",
];

/**
 * Upload-a-CSV panel, toggled open from the "Bulk import" button. Each row
 * is processed independently server-side (see POST /api/students/bulk-import),
 * so a typo in one row never blocks the rest — this panel's job is just to
 * show that per-row breakdown back so whoever imported the file knows
 * exactly which rows to fix and re-upload.
 */
function BulkImportPanel({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setResult(null);
    setIsUploading(true);
    try {
      const res = await studentsApi.bulkImport(file);
      setResult(res);
      if (res.created > 0) onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not import the file.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk import students from CSV</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <p className="mb-2 font-medium text-slate-700">Expected CSV columns (header row required):</p>
          <ul className="list-inside list-disc space-y-0.5">
            {BULK_IMPORT_COLUMNS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>

        <div>
          <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={onFileSelected} />
          <Button type="button" isLoading={isUploading} onClick={() => inputRef.current?.click()}>
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            Choose CSV file
          </Button>
        </div>

        {result && (
          <div className="flex flex-col gap-3">
            <Alert tone={result.failed > 0 ? "warning" : "success"} title="Import finished">
              {result.created} of {result.totalRows} row{result.totalRows === 1 ? "" : "s"} created
              {result.failed > 0 ? `, ${result.failed} failed` : ""}.
            </Alert>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Row</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Result</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.results.map((r) => (
                  <TableRow key={r.row}>
                    <TableCell>{r.row}</TableCell>
                    <TableCell>{r.fullName ?? "—"}</TableCell>
                    <TableCell>
                      {r.status === "created" ? (
                        <Badge tone="success">Created ({r.studentCode})</Badge>
                      ) : (
                        <span className="flex flex-col gap-0.5">
                          <Badge tone="danger">Error</Badge>
                          <span className="text-xs text-slate-500">{r.error}</span>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function StudentsPage() {
  const { user } = useAuth();
  // Mirrors the backend's WRITE_ROLES for /api/students (sis/students.ts) —
  // ACCOUNTANT can view the roster (fee/challan work needs it) but should
  // never see a way to add students, same as they never could on the
  // backend; this was just a missing UI-level gate on an already-correct
  // API.
  const canWrite = user?.role === "SCHOOL_ADMIN" || user?.role === "FRONT_DESK";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [showBulkImport, setShowBulkImport] = useState(false);
  // Debounced so typing a search term doesn't fire a request per keystroke
  // — important on the low-bandwidth mobile connections common among this
  // app's front-desk/teacher users.
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, error, refetch } = useAsync(
    () =>
      studentsApi.list({
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
        <h1 className="text-page-title font-semibold text-slate-900">Students</h1>
        {canWrite && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowBulkImport((v) => !v)}>
              <Upload className="size-4" aria-hidden="true" />
              Bulk import
            </Button>
            <Link href="/dashboard/students/new">
              <Button size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Add student
              </Button>
            </Link>
          </div>
        )}
      </div>

      {canWrite && showBulkImport && <BulkImportPanel onImported={refetch} />}

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <Input
            label="Search"
            placeholder="Name or admission code"
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
          <option value="INACTIVE">Inactive</option>
          <option value="GRADUATED">Graduated</option>
          <option value="TRANSFERRED_OUT">Transferred out</option>
          <option value="EXPELLED">Expelled</option>
        </Select>
      </div>

      {isLoading && <Spinner label="Loading students" />}
      {error && <p className="text-sm text-red-600">Failed to load students: {error.message}</p>}

      {data && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Admission code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Section</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((student) => (
                <TableRow key={student.id}>
                  <TableCell>
                    <Link href={`/dashboard/students/${student.id}`} className="font-medium text-primary-600 hover:underline">
                      {student.studentCode}
                    </Link>
                  </TableCell>
                  <TableCell>{student.fullName}</TableCell>
                  <TableCell>
                    {student.currentSection
                      ? `${student.currentSection.schoolClass.name} - ${student.currentSection.name}`
                      : "—"}
                  </TableCell>
                  <TableCell>{student.user?.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[student.status] ?? "default"}>{student.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.data.length === 0 && <EmptyState message="No students found." />}

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
