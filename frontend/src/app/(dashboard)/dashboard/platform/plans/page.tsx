"use client";

import { useState } from "react";
import { Check, Plus, Pencil } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAsync } from "@/lib/hooks/useAsync";
import { platformApi, type PlanDefinition, type PlanFormInput } from "@/lib/resources/platform";
import { ApiError } from "@/lib/api";
import {
  Button,
  ConfirmButton,
  Input,
  Textarea,
  Badge,
  Alert,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  EmptyState,
  Spinner,
} from "@/components/ui";

/** One-per-line textarea -> a clean string[] (trims, drops blanks). */
function parseFeatures(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** A number input with an "Unlimited" checkbox — null means unlimited. */
function LimitField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const unlimited = value === null;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
          value={unlimited ? "" : value}
          disabled={unlimited}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        />
        <label className="flex shrink-0 items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            className="rounded border-slate-300"
            checked={unlimited}
            onChange={(e) => onChange(e.target.checked ? null : 0)}
          />
          Unlimited
        </label>
      </div>
    </div>
  );
}

const textFieldsSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Required")
    .max(40)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Letters, digits and underscores only, starting with a letter"),
  name: z.string().trim().min(1, "Required").max(100),
  priceMonthlyPKR: z.coerce.number().int().min(0, "Must be 0 or more"),
  featuresText: z.string().optional(),
});
type TextFieldValues = z.infer<typeof textFieldsSchema>;
type TextFieldInput = z.input<typeof textFieldsSchema>;

function PlanTextFields({
  register,
  errors,
  showCode,
}: {
  register: ReturnType<typeof useForm<TextFieldInput, unknown, TextFieldValues>>["register"];
  errors: ReturnType<typeof useForm<TextFieldInput, unknown, TextFieldValues>>["formState"]["errors"];
  showCode: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {showCode && (
        <Input
          label="Plan code"
          required
          hint="A stable short id, e.g. GOLD. Can't be changed later."
          error={errors.code?.message}
          {...register("code")}
        />
      )}
      <Input label="Display name" required error={errors.name?.message} {...register("name")} />
      <Input
        type="number"
        min={0}
        label="Price / month (PKR)"
        required
        error={errors.priceMonthlyPKR?.message}
        {...register("priceMonthlyPKR")}
      />
      <div className="sm:col-span-2">
        <Textarea
          label="Features"
          hint="One per line — shown as a bullet list on the plan card and the signup page."
          rows={4}
          {...register("featuresText")}
        />
      </div>
    </div>
  );
}

function CreatePlanForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [maxStudents, setMaxStudents] = useState<number | null>(null);
  const [maxStaff, setMaxStaff] = useState<number | null>(null);
  const [maxSmsCreditsPerMonth, setMaxSmsCreditsPerMonth] = useState<number | null>(0);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TextFieldInput, unknown, TextFieldValues>({ resolver: zodResolver(textFieldsSchema) });

  const onSubmit = async (values: TextFieldValues) => {
    setError(null);
    try {
      const input: PlanFormInput = {
        code: values.code,
        name: values.name,
        priceMonthlyPKR: values.priceMonthlyPKR,
        maxStudents,
        maxStaff,
        maxSmsCreditsPerMonth,
        features: parseFeatures(values.featuresText ?? ""),
        active: true,
      };
      await platformApi.createPlan(input);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this plan.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New plan</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <PlanTextFields register={register} errors={errors} showCode />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <LimitField label="Max students" value={maxStudents} onChange={setMaxStudents} />
            <LimitField label="Max staff" value={maxStaff} onChange={setMaxStaff} />
            <LimitField label="Max SMS/WhatsApp per month" value={maxSmsCreditsPerMonth} onChange={setMaxSmsCreditsPerMonth} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Create plan
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EditPlanForm({ plan, onSaved, onCancel }: { plan: PlanDefinition; onSaved: () => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [maxStudents, setMaxStudents] = useState<number | null>(plan.maxStudents);
  const [maxStaff, setMaxStaff] = useState<number | null>(plan.maxStaff);
  const [maxSmsCreditsPerMonth, setMaxSmsCreditsPerMonth] = useState<number | null>(plan.maxSmsCreditsPerMonth);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TextFieldInput, unknown, TextFieldValues>({
    resolver: zodResolver(textFieldsSchema),
    defaultValues: {
      code: plan.code,
      name: plan.name,
      priceMonthlyPKR: plan.priceMonthlyPKR,
      featuresText: plan.features.join("\n"),
    },
  });

  const onSubmit = async (values: TextFieldValues) => {
    setError(null);
    try {
      await platformApi.updatePlan(plan.id, {
        name: values.name,
        priceMonthlyPKR: values.priceMonthlyPKR,
        maxStudents,
        maxStaff,
        maxSmsCreditsPerMonth,
        features: parseFeatures(values.featuresText ?? ""),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this plan.");
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3"
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <PlanTextFields register={register} errors={errors} showCode={false} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LimitField label="Max students" value={maxStudents} onChange={setMaxStudents} />
        <LimitField label="Max staff" value={maxStaff} onChange={setMaxStaff} />
        <LimitField label="Max SMS/WhatsApp per month" value={maxSmsCreditsPerMonth} onChange={setMaxSmsCreditsPerMonth} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" isLoading={isSubmitting}>
          Save
        </Button>
      </div>
    </form>
  );
}

export default function PlatformPlansPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: plans, isLoading, error, refetch } = useAsync(() => platformApi.listPlans(), []);

  if (isLoading) return <Spinner label="Loading plans" />;
  if (error) return <Alert tone="danger">Failed to load plans: {error.message}</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title font-semibold text-slate-900">Subscription plans</h1>
          <p className="text-sm text-slate-500">
            Limits are enforced live — student/staff creation is blocked once a school hits its plan&apos;s limit, and
            SMS/WhatsApp sends are blocked once its monthly credit is used up. A deactivated plan disappears from the
            public signup page but keeps working for schools already on it.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          New plan
        </Button>
      </div>

      {actionError && <Alert tone="danger">{actionError}</Alert>}

      {showCreate && (
        <CreatePlanForm
          onCreated={() => {
            setShowCreate(false);
            refetch();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {plans && plans.length === 0 ? (
        <EmptyState message="No plans yet — add one to open signup." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {plans?.map((plan) =>
            editingId === plan.id ? (
              <EditPlanForm
                key={plan.id}
                plan={plan}
                onSaved={() => {
                  setEditingId(null);
                  refetch();
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <Card key={plan.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle>{plan.name}</CardTitle>
                      <p className="text-xs text-slate-400">{plan.code}</p>
                    </div>
                    <Badge tone={plan.active ? "success" : "default"}>{plan.active ? "Active" : "Deactivated"}</Badge>
                  </div>
                  <p className="text-2xl font-semibold text-slate-900">
                    {plan.priceMonthlyPKR === 0 ? "Free" : `Rs ${plan.priceMonthlyPKR.toLocaleString()}`}
                    {plan.priceMonthlyPKR > 0 && <span className="text-sm font-normal text-slate-500">/mo</span>}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <dl className="flex flex-col gap-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Students</dt>
                      <dd className="font-medium text-slate-900">
                        {plan.maxStudents === null ? "Unlimited" : plan.maxStudents.toLocaleString()}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Staff</dt>
                      <dd className="font-medium text-slate-900">
                        {plan.maxStaff === null ? "Unlimited" : plan.maxStaff.toLocaleString()}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">SMS/WhatsApp</dt>
                      <dd className="font-medium text-slate-900">
                        {plan.maxSmsCreditsPerMonth === null
                          ? "Unlimited"
                          : plan.maxSmsCreditsPerMonth === 0
                            ? "Not included"
                            : `${plan.maxSmsCreditsPerMonth.toLocaleString()}/mo`}
                      </dd>
                    </div>
                  </dl>
                  {plan.features.length > 0 && (
                    <ul className="flex flex-col gap-1.5 border-t border-slate-100 pt-3 text-sm text-slate-600">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-1.5">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <Button variant="outline" size="sm" onClick={() => setEditingId(plan.id)}>
                      <Pencil className="size-4" aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        setActionError(null);
                        await platformApi.updatePlan(plan.id, { active: !plan.active });
                        refetch();
                      }}
                    >
                      {plan.active ? "Deactivate" : "Activate"}
                    </Button>
                    <ConfirmButton
                      triggerLabel="Delete"
                      confirmLabel="Delete plan"
                      title="Delete this plan?"
                      description="Only works if no school is currently on it — otherwise deactivate it instead."
                      size="sm"
                      onConfirm={async () => {
                        setActionError(null);
                        try {
                          await platformApi.deletePlan(plan.id);
                          refetch();
                        } catch (err) {
                          setActionError(err instanceof ApiError ? err.message : "Could not delete this plan.");
                        }
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      )}
    </div>
  );
}
