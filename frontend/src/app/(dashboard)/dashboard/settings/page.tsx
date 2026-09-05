"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { tenantApi } from "@/lib/resources/tenant";
import { holidaysApi } from "@/lib/resources/holidays";
import { applyThemeById, applyPrimaryTheme } from "@/lib/theme";
import { useAsync } from "@/lib/hooks/useAsync";
import { ThemePicker } from "@/components/domain/ThemePicker";
import { ApiError } from "@/lib/api";
import {
  Alert,
  Button,
  Input,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
} from "@/components/ui";
import { t } from "@/lib/i18n";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function HolidayCalendarSection() {
  const { data: weeklyOff, isLoading: isLoadingWeeklyOff, refetch: refetchWeeklyOff } = useAsync(
    () => tenantApi.getWeeklyOffDays(),
    [],
  );
  const { data: holidays, isLoading: isLoadingHolidays, refetch: refetchHolidays } = useAsync(
    () => holidaysApi.list(),
    [],
  );

  const [weeklyOffError, setWeeklyOffError] = useState<string | null>(null);
  const [isSavingWeeklyOff, setIsSavingWeeklyOff] = useState(false);

  const toggleWeeklyOffDay = async (day: number) => {
    const current = weeklyOff?.weeklyOffDays ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    setWeeklyOffError(null);
    setIsSavingWeeklyOff(true);
    try {
      await tenantApi.updateWeeklyOffDays(next);
      refetchWeeklyOff();
    } catch (err) {
      setWeeklyOffError(err instanceof ApiError ? err.message : "Could not save weekly off days.");
    } finally {
      setIsSavingWeeklyOff(false);
    }
  };

  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [holidayName, setHolidayName] = useState("");
  const [holidayStart, setHolidayStart] = useState("");
  const [holidayEnd, setHolidayEnd] = useState("");
  const [holidayError, setHolidayError] = useState<string | null>(null);
  const [isSavingHoliday, setIsSavingHoliday] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const addHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayName.trim() || !holidayStart) return;
    setHolidayError(null);
    setIsSavingHoliday(true);
    try {
      await holidaysApi.create({ name: holidayName, startDate: holidayStart, endDate: holidayEnd || holidayStart });
      setHolidayName("");
      setHolidayStart("");
      setHolidayEnd("");
      setShowHolidayForm(false);
      refetchHolidays();
    } catch (err) {
      setHolidayError(err instanceof ApiError ? err.message : "Could not save holiday.");
    } finally {
      setIsSavingHoliday(false);
    }
  };

  const removeHoliday = async (id: string) => {
    setDeletingId(id);
    try {
      await holidaysApi.remove(id);
      refetchHolidays();
    } catch (err) {
      setHolidayError(err instanceof ApiError ? err.message : "Could not delete holiday.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Holiday calendar</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="text-sm text-slate-500">
          Controls which dates show as no class — attendance can&apos;t be marked on these dates, and students/parents
          see a No class today notice on the portal.
        </p>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Weekly off days</p>
          {isLoadingWeeklyOff ? (
            <Spinner label="Loading weekly off days" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_NAMES.map((name, day) => {
                const isOff = weeklyOff?.weeklyOffDays.includes(day) ?? false;
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={isSavingWeeklyOff}
                    onClick={() => toggleWeeklyOffDay(day)}
                    aria-pressed={isOff}
                    className={`focus-ring rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                      isOff
                        ? "border-primary-300 bg-primary-100 text-primary-800"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
          {weeklyOffError && (
            <Alert tone="danger" className="mt-2">
              {weeklyOffError}
            </Alert>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Declared holidays</p>
            <Button size="sm" variant="outline" onClick={() => setShowHolidayForm((v) => !v)}>
              <Plus className="size-4" aria-hidden="true" />
              Add holiday
            </Button>
          </div>

          {holidayError && (
            <Alert tone="danger" className="mb-2">
              {holidayError}
            </Alert>
          )}

          {showHolidayForm && (
            <form onSubmit={addHoliday} className="mb-3 rounded-lg border border-slate-200 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input
                  label="Name"
                  placeholder="e.g. Eid Holidays"
                  required
                  value={holidayName}
                  onChange={(e) => setHolidayName(e.target.value)}
                />
                <Input
                  label="From"
                  type="date"
                  required
                  value={holidayStart}
                  onChange={(e) => setHolidayStart(e.target.value)}
                />
                <Input
                  label="To"
                  type="date"
                  hint="Leave empty for a single day"
                  value={holidayEnd}
                  onChange={(e) => setHolidayEnd(e.target.value)}
                />
              </div>
              <div className="mt-3 flex justify-end">
                <Button type="submit" size="sm" isLoading={isSavingHoliday}>
                  Save
                </Button>
              </div>
            </form>
          )}

          {isLoadingHolidays ? (
            <Spinner label="Loading holidays" />
          ) : !holidays || holidays.length === 0 ? (
            <EmptyState message="No holidays declared yet." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>From</TableHeaderCell>
                  <TableHeaderCell>To</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {holidays.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium text-slate-900">{h.name}</TableCell>
                    <TableCell>{new Date(h.startDate).toLocaleDateString()}</TableCell>
                    <TableCell>{new Date(h.endDate).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeHoliday(h.id)}
                        isLoading={deletingId === h.id}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { tenant, setTenantTheme } = useAuth();
  const { data: presets, isLoading, error } = useAsync(() => tenantApi.themePresets(), []);

  const [selected, setSelected] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Start the picker on the tenant's current theme once both the tenant
  // and the catalog are loaded; re-syncs if the tenant record changes.
  useEffect(() => {
    if (tenant?.themeId) setSelected(tenant.themeId);
  }, [tenant?.themeId]);

  const currentThemeId = selected ?? tenant?.themeId ?? "navy-blue";

  // If someone previews a color here and navigates away without saving,
  // revert the live preview to whatever is actually persisted — otherwise
  // the unsaved preview would keep applying across the rest of the app.
  // Kept in a ref (rather than read directly in the cleanup) so a
  // *successful* save just before navigating away doesn't revert to a
  // stale pre-save value — the ref always tracks the latest tenant state.
  const persistedThemeIdRef = useRef(tenant?.themeId);
  persistedThemeIdRef.current = tenant?.themeId;

  useEffect(() => {
    return () => {
      applyThemeById(persistedThemeIdRef.current);
    };
  }, []);

  const handleSave = async () => {
    if (!selected || selected === tenant?.themeId) return;
    setSaveError(null);
    setSaveSuccess(false);
    setIsSaving(true);
    try {
      await tenantApi.updateTheme(selected);
      setTenantTheme(selected);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t("settings.themeSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">{t("settings.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.themeTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-slate-500">{t("settings.themeSubtitle")}</p>

          {saveSuccess && <Alert tone="success">{t("settings.themeSaveSuccess")}</Alert>}
          {saveError && <Alert tone="danger">{saveError}</Alert>}

          {isLoading && <Spinner label="Loading color themes" />}
          {error && <Alert tone="danger">Could not load color themes right now. Please try again later.</Alert>}

          {presets && (
            <ThemePicker
              presets={presets}
              selected={currentThemeId}
              onSelect={(preset) => {
                setSelected(preset.id);
                setSaveSuccess(false);
                // Live preview — applied immediately, saved only on click.
                applyPrimaryTheme(preset.primaryHex);
              }}
            />
          )}

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={handleSave}
              isLoading={isSaving}
              disabled={!selected || selected === tenant?.themeId}
            >
              {t("settings.themeSaveButton")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <HolidayCalendarSection />
    </div>
  );
}
