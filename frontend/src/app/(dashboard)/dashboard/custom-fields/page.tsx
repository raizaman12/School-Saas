"use client";

import { Fragment, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAsync } from "@/lib/hooks/useAsync";
import {
  customFieldsApi,
  CUSTOM_FIELD_TYPE_LABEL,
  type CustomFieldDefinition,
  type CustomFieldType,
} from "@/lib/resources/customFields";
import { ApiError } from "@/lib/api";
import {
  Button,
  ConfirmButton,
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

/** Turns the "comma-separated options" text input into a clean string array — trims each option, drops blanks/duplicates. */
function parseOptions(raw: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      options.push(trimmed);
    }
  }
  return options;
}

const createSchema = z
  .object({
    label: z.string().min(2, "Required").max(150),
    fieldType: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"]),
    optionsText: z.string().optional(),
    required: z.boolean().optional(),
  })
  .refine((v) => v.fieldType !== "SELECT" || parseOptions(v.optionsText ?? "").length > 0, {
    message: "List at least one option, separated by commas",
    path: ["optionsText"],
  });
type CreateFormValues = z.infer<typeof createSchema>;

function CreateFieldForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  // Plain useState rather than react-hook-form's watch() — this is the
  // only field whose *presence* (not just validity) depends on another
  // field's value, and watch() isn't used anywhere else in this codebase.
  const [fieldType, setFieldType] = useState<CreateFormValues["fieldType"]>("TEXT");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { fieldType: "TEXT" },
  });

  const onSubmit = async (values: CreateFormValues) => {
    setError(null);
    try {
      await customFieldsApi.createDefinition({
        label: values.label,
        fieldType: values.fieldType,
        options: values.fieldType === "SELECT" ? parseOptions(values.optionsText ?? "") : undefined,
        required: values.required,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this field.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a field</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-3"
          data-testid="create-custom-field-form"
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Field label"
              required
              placeholder="e.g. Transport Route, Father's Occupation"
              error={errors.label?.message}
              {...register("label")}
            />
            <Select
              label="Field type"
              required
              {...register("fieldType", {
                onChange: (e) => setFieldType(e.target.value as CreateFormValues["fieldType"]),
              })}
            >
              {Object.entries(CUSTOM_FIELD_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          {fieldType === "SELECT" && (
            <Input
              label="Options"
              required
              placeholder="Route A, Route B, Route C"
              hint="Comma-separated list of the choices staff can pick from."
              error={errors.optionsText?.message}
              {...register("optionsText")}
            />
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="rounded border-slate-300" {...register("required")} />
            Required — the student form will show this with an asterisk
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Add field
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// SELECT-emptiness can't be checked here (the schema doesn't know the
// field's own fieldType) — that check happens inline in onSubmit below.
const editSchema = z.object({
  label: z.string().min(2, "Required").max(150),
  optionsText: z.string().optional(),
  required: z.boolean().optional(),
});
type EditFormValues = z.infer<typeof editSchema>;

function EditFieldForm({
  field,
  onSaved,
  onCancel,
}: {
  field: CustomFieldDefinition;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { label: field.label, optionsText: (field.options ?? []).join(", "), required: field.required },
  });

  const onSubmit = async (values: EditFormValues) => {
    setError(null);
    if (field.fieldType === "SELECT") {
      const options = parseOptions(values.optionsText ?? "");
      if (options.length === 0) {
        setError("List at least one option, separated by commas.");
        return;
      }
    }
    try {
      await customFieldsApi.updateDefinition(field.id, {
        label: values.label,
        options: field.fieldType === "SELECT" ? parseOptions(values.optionsText ?? "") : undefined,
        required: values.required,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this field.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <Input label="Field label" required error={errors.label?.message} {...register("label")} />
      {field.fieldType === "SELECT" && (
        <Input
          label="Options"
          required
          hint="Comma-separated. Existing student answers stay valid even if you rename an option's siblings — only remove an option once no one holds it."
          {...register("optionsText")}
        />
      )}
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="rounded border-slate-300" {...register("required")} />
        Required
      </label>
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

export default function CustomFieldsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useAsync(
    () => customFieldsApi.listDefinitions({ includeInactive: true }),
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title font-semibold text-slate-900">Custom fields</h1>
          <p className="text-sm text-slate-500">
            Extra fields your school wants to track on students — transport route, father&apos;s occupation, previous
            school, whatever admission actually asks for. Not a form builder — just a field list.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Add field
        </Button>
      </div>

      {showCreate && (
        <CreateFieldForm
          onCreated={() => {
            setShowCreate(false);
            refetch();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {isLoading && <Spinner label="Loading custom fields" />}
      {error && <p className="text-sm text-red-600">Failed to load custom fields: {error.message}</p>}

      {data && (
        <>
          {data.length === 0 ? (
            <EmptyState message="No custom fields yet — add one to start collecting extra student info." />
          ) : (
            <Card>
              <CardContent>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Label</TableHeaderCell>
                      <TableHeaderCell>Type</TableHeaderCell>
                      <TableHeaderCell>Required</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Actions</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.map((field) => (
                      <Fragment key={field.id}>
                        <TableRow>
                          <TableCell>
                            <p className="font-medium text-slate-900">{field.label}</p>
                            {field.fieldType === "SELECT" && field.options && (
                              <p className="text-xs text-slate-400">{field.options.join(", ")}</p>
                            )}
                          </TableCell>
                          <TableCell>{CUSTOM_FIELD_TYPE_LABEL[field.fieldType as CustomFieldType]}</TableCell>
                          <TableCell>{field.required ? "Yes" : "No"}</TableCell>
                          <TableCell>
                            <Badge tone={field.active ? "success" : "default"}>
                              {field.active ? "Active" : "Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" onClick={() => setEditingId(field.id)}>
                                <Pencil className="size-4" aria-hidden="true" />
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                  await customFieldsApi.updateDefinition(field.id, { active: !field.active });
                                  refetch();
                                }}
                              >
                                {field.active ? "Disable" : "Enable"}
                              </Button>
                              <ConfirmButton
                                triggerLabel="Delete"
                                confirmLabel="Delete field"
                                title="Delete this field?"
                                description="Only works if no student has an answer saved for it yet — otherwise disable it instead so existing answers aren't lost."
                                size="sm"
                                onConfirm={async () => {
                                  await customFieldsApi.removeDefinition(field.id);
                                  refetch();
                                }}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                        {editingId === field.id && (
                          <TableRow>
                            <TableCell colSpan={5}>
                              <EditFieldForm
                                field={field}
                                onSaved={() => {
                                  setEditingId(null);
                                  refetch();
                                }}
                                onCancel={() => setEditingId(null)}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
