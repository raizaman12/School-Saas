"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Building2, School as SchoolIcon } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api";
import {
  signupSchema,
  signupMultiBranchSchema,
  PLAN_OPTIONS,
  type SignupFormValues,
  type SignupMultiBranchFormValues,
} from "@/lib/auth/schemas";
import type { TenantPlan, SignupMultiBranchResult } from "@/lib/auth/types";
import { tenantApi, type ThemePreset } from "@/lib/resources/tenant";
import { applyPrimaryTheme } from "@/lib/theme";
import { useAsync } from "@/lib/hooks/useAsync";
import { ThemePicker } from "@/components/domain/ThemePicker";
import { Button, Input, Alert, Badge, Spinner } from "@/components/ui";
import { t } from "@/lib/i18n";

const PLAN_HIGHLIGHTS: Record<TenantPlan, string> = {
  TRIAL: "Up to 50 students, 10 staff. No SMS/WhatsApp.",
  BASIC: "Up to 300 students, 30 staff. No SMS/WhatsApp.",
  STANDARD: "Up to 1,000 students, 100 staff, 1,000 SMS/WhatsApp sends a month.",
  PREMIUM: "Unlimited students, staff, and SMS/WhatsApp.",
};

const DEFAULT_THEME_ID = "navy-blue";

type SignupMode = "single" | "multi";

function emptyBranch() {
  return { branchName: "", city: "", adminFullName: "", adminEmail: "", adminPassword: "" };
}

function PlanStep({ selected, onSelect, onContinue }: { selected: TenantPlan; onSelect: (p: TenantPlan) => void; onContinue: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-auth-title font-semibold text-slate-900">{t("auth.choosePlanTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("auth.choosePlanSubtitle")}</p>
      </div>

      <div className="flex flex-col gap-2">
        {PLAN_OPTIONS.map((plan) => {
          const isSelected = selected === plan.value;
          return (
            <button
              key={plan.value}
              type="button"
              onClick={() => onSelect(plan.value)}
              className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors ${
                isSelected ? "border-primary-500 bg-primary-50 ring-1 ring-primary-500" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">{plan.label}</span>
                {isSelected && (
                  <Badge tone="info">
                    <Check className="size-3.5" aria-hidden="true" />
                  </Badge>
                )}
              </div>
              <span className="text-sm text-slate-500">{PLAN_HIGHLIGHTS[plan.value]}</span>
            </button>
          );
        })}
      </div>

      <Button type="button" onClick={onContinue} className="mt-2 w-full">
        {t("auth.continueButton")}
      </Button>
    </div>
  );
}

function ThemeStep({
  selected,
  onSelect,
  onContinue,
  onBack,
}: {
  selected: string;
  onSelect: (id: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const { data: presets, isLoading, error } = useAsync(() => tenantApi.themePresets(), []);

  // Live preview — the picker itself already looks like the chosen school
  // color as soon as it's tapped, not just after signup completes.
  const handleSelect = (preset: ThemePreset) => {
    onSelect(preset.id);
    applyPrimaryTheme(preset.primaryHex);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-auth-title font-semibold text-slate-900">{t("auth.chooseThemeTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("auth.chooseThemeSubtitle")}</p>
      </div>

      {isLoading && <Spinner label="Loading color themes" />}
      {error && <Alert tone="warning">Couldn&apos;t load color themes right now — you can still continue with the default, and change it later from Settings.</Alert>}

      {presets && <ThemePicker presets={presets} selected={selected} onSelect={handleSelect} />}

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack} className="w-1/3">
          {t("auth.backButton")}
        </Button>
        <Button type="button" onClick={onContinue} className="w-2/3">
          {t("auth.continueButton")}
        </Button>
      </div>
    </div>
  );
}

/**
 * One Branch / Multiple Branches choice, inserted between the theme picker
 * and the school-details form. Defaults to "single" (already selected),
 * matching this app's every previous signup — a user who never touches
 * this step and just clicks Continue lands on exactly the same DetailsStep
 * as before this feature existed.
 */
function ModeStep({
  selected,
  onSelect,
  onContinue,
  onBack,
}: {
  selected: SignupMode;
  onSelect: (mode: SignupMode) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const options: { value: SignupMode; icon: typeof SchoolIcon; label: string; description: string }[] = [
    { value: "single", icon: SchoolIcon, label: t("auth.modeSingleLabel"), description: t("auth.modeSingleDescription") },
    { value: "multi", icon: Building2, label: t("auth.modeMultiLabel"), description: t("auth.modeMultiDescription") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-auth-title font-semibold text-slate-900">{t("auth.chooseModeTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("auth.chooseModeSubtitle")}</p>
      </div>

      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const isSelected = selected === option.value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                isSelected ? "border-primary-500 bg-primary-50 ring-1 ring-primary-500" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <Icon className="mt-0.5 size-5 shrink-0 text-slate-500" aria-hidden="true" />
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{option.label}</span>
                  {isSelected && (
                    <Badge tone="info">
                      <Check className="size-3.5" aria-hidden="true" />
                    </Badge>
                  )}
                </div>
                <span className="text-sm text-slate-500">{option.description}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack} className="w-1/3">
          {t("auth.backButton")}
        </Button>
        <Button type="button" onClick={onContinue} className="w-2/3">
          {t("auth.continueButton")}
        </Button>
      </div>
    </div>
  );
}

function DetailsStep({
  plan,
  themeId,
  onBack,
}: {
  plan: TenantPlan;
  themeId: string;
  onBack: () => void;
}) {
  const { signup } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>({ resolver: zodResolver(signupSchema), defaultValues: { plan, themeId } });

  const onSubmit = async (values: SignupFormValues) => {
    setFormError(null);
    try {
      await signup({ ...values, plan, themeId });
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    }
  };

  const planLabel = PLAN_OPTIONS.find((p) => p.value === plan)?.label ?? plan;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-auth-title font-semibold text-slate-900">{t("auth.signupTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("auth.signupSubtitle")}</p>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-800">
        <span>
          Selected plan: <span className="font-semibold">{planLabel}</span>
        </span>
        <button type="button" onClick={onBack} className="font-medium underline">
          {t("auth.changePlan")}
        </button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Input label={t("auth.schoolName")} required error={errors.schoolName?.message} {...register("schoolName")} />
        <Input
          label={t("auth.schoolSlug")}
          placeholder="your-school"
          hint="This becomes your school's login URL (letters, numbers, hyphens)."
          required
          error={errors.slug?.message}
          {...register("slug")}
        />
        <Input label={t("auth.adminFullName")} required error={errors.adminFullName?.message} {...register("adminFullName")} />
        <Input
          label={t("auth.adminEmail")}
          type="email"
          required
          error={errors.adminEmail?.message}
          {...register("adminEmail")}
        />
        <Input
          label={t("auth.adminPassword")}
          type="password"
          hint="At least 8 characters, with an uppercase letter, a lowercase letter, and a number."
          required
          error={errors.adminPassword?.message}
          {...register("adminPassword")}
        />

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onBack} className="w-1/3">
            {t("auth.backButton")}
          </Button>
          <Button type="submit" isLoading={isSubmitting} className="w-2/3">
            {t("auth.signupButton")}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Multi-branch registration — a group name/URL sub-step followed by a
 * repeatable branches sub-step, both backed by ONE react-hook-form
 * instance (so values survive moving between the two sub-screens) and
 * submitted together as a single signupMultiBranch() call. No redirect to
 * /dashboard on success — see this component's onSuccess contract: with N
 * independent branch admins created at once, there's no single account to
 * land in a dashboard as.
 */
function MultiBranchStep({
  plan,
  themeId,
  onBack,
  onSuccess,
}: {
  plan: TenantPlan;
  themeId: string;
  onBack: () => void;
  onSuccess: (result: SignupMultiBranchResult) => void;
}) {
  const { signupMultiBranch } = useAuth();
  const [subStep, setSubStep] = useState<"group" | "branches">("group");
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<SignupMultiBranchFormValues>({
    resolver: zodResolver(signupMultiBranchSchema),
    defaultValues: { schoolName: "", slug: "", branches: [emptyBranch(), emptyBranch()] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "branches" });

  const goToBranches = async () => {
    const valid = await trigger(["schoolName", "slug"]);
    if (valid) setSubStep("branches");
  };

  const onSubmit = async (values: SignupMultiBranchFormValues) => {
    setFormError(null);
    try {
      const result = await signupMultiBranch({ ...values, plan, themeId });
      onSuccess(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    }
  };

  if (subStep === "group") {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <h1 className="text-auth-title font-semibold text-slate-900">{t("auth.groupDetailsTitle")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("auth.groupDetailsSubtitle")}</p>
        </div>

        <Input label={t("auth.groupSchoolName")} required error={errors.schoolName?.message} {...register("schoolName")} />
        <Input
          label={t("auth.groupSchoolSlug")}
          placeholder="your-school-group"
          hint={t("auth.groupSchoolSlugHint")}
          required
          error={errors.slug?.message}
          {...register("slug")}
        />

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onBack} className="w-1/3">
            {t("auth.backButton")}
          </Button>
          <Button type="button" onClick={goToBranches} className="w-2/3">
            {t("auth.continueButton")}
          </Button>
        </div>
      </div>
    );
  }

  const branchesArrayError = (errors.branches as { root?: { message?: string }; message?: string } | undefined);

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-auth-title font-semibold text-slate-900">{t("auth.branchesTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("auth.branchesSubtitle")}</p>
      </div>

      {formError && <Alert tone="danger">{formError}</Alert>}
      {(branchesArrayError?.root?.message ?? branchesArrayError?.message) && (
        <Alert tone="danger">{branchesArrayError?.root?.message ?? branchesArrayError?.message}</Alert>
      )}

      <div className="flex flex-col gap-4">
        {fields.map((field, index) => (
          <div key={field.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                {t("auth.branchLabelPrefix")} {index + 1}
              </span>
              {fields.length > 2 && (
                <button type="button" onClick={() => remove(index)} className="text-sm font-medium text-red-600 hover:underline">
                  {t("auth.removeBranchButton")}
                </button>
              )}
            </div>

            <Input
              label={t("auth.branchName")}
              required
              error={errors.branches?.[index]?.branchName?.message}
              {...register(`branches.${index}.branchName` as const)}
            />
            <Input
              label={t("auth.branchCity")}
              required
              error={errors.branches?.[index]?.city?.message}
              {...register(`branches.${index}.city` as const)}
            />
            <Input
              label={t("auth.branchAdminFullName")}
              required
              error={errors.branches?.[index]?.adminFullName?.message}
              {...register(`branches.${index}.adminFullName` as const)}
            />
            <Input
              label={t("auth.branchAdminEmail")}
              type="email"
              required
              error={errors.branches?.[index]?.adminEmail?.message}
              {...register(`branches.${index}.adminEmail` as const)}
            />
            <Input
              label={t("auth.branchAdminPassword")}
              type="password"
              hint="At least 8 characters, with an uppercase letter, a lowercase letter, and a number."
              required
              error={errors.branches?.[index]?.adminPassword?.message}
              {...register(`branches.${index}.adminPassword` as const)}
            />
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" onClick={() => append(emptyBranch())}>
        {t("auth.addBranchButton")}
      </Button>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setSubStep("group")} className="w-1/3">
          {t("auth.backButton")}
        </Button>
        <Button type="submit" isLoading={isSubmitting} className="w-2/3">
          {t("auth.multiSignupButton")}
        </Button>
      </div>
    </form>
  );
}

function MultiSuccessStep({ result }: { result: SignupMultiBranchResult }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-auth-title font-semibold text-slate-900">{t("auth.multiSuccessTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("auth.multiSuccessSubtitle")}</p>
      </div>

      <div className="flex flex-col gap-2">
        {result.branches.map((branch) => (
          <div key={branch.tenant.id} className="rounded-lg border border-slate-200 p-3">
            <div className="font-semibold text-slate-900">{branch.tenant.branchName}</div>
            <div className="mt-1 text-sm text-slate-500">
              Login URL: <span className="font-mono text-slate-700">{branch.tenant.slug}</span>
            </div>
            <div className="text-sm text-slate-500">
              Admin email: <span className="text-slate-700">{branch.user.email}</span>
            </div>
          </div>
        ))}
      </div>

      <Link href="/login">
        <Button type="button" className="w-full">
          {t("auth.multiSuccessGoToLogin")}
        </Button>
      </Link>
    </div>
  );
}

export default function SignupPage() {
  const [step, setStep] = useState<"plan" | "theme" | "mode" | "details" | "multiBranch" | "multiSuccess">("plan");
  const [plan, setPlan] = useState<TenantPlan>("TRIAL");
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const [mode, setMode] = useState<SignupMode>("single");
  const [multiResult, setMultiResult] = useState<SignupMultiBranchResult | null>(null);

  // Reset back to the default accent color if someone leaves the signup
  // flow mid-way (e.g. clicks "Log in" instead) — otherwise a preview
  // pick would leak into the login page's own theming.
  useEffect(() => {
    return () => {
      applyPrimaryTheme("#1e3a8a");
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {step === "plan" && <PlanStep selected={plan} onSelect={setPlan} onContinue={() => setStep("theme")} />}
          {step === "theme" && (
            <ThemeStep
              selected={themeId}
              onSelect={setThemeId}
              onContinue={() => setStep("mode")}
              onBack={() => setStep("plan")}
            />
          )}
          {step === "mode" && (
            <ModeStep
              selected={mode}
              onSelect={setMode}
              onContinue={() => setStep(mode === "single" ? "details" : "multiBranch")}
              onBack={() => setStep("theme")}
            />
          )}
          {step === "details" && <DetailsStep plan={plan} themeId={themeId} onBack={() => setStep("mode")} />}
          {step === "multiBranch" && (
            <MultiBranchStep
              plan={plan}
              themeId={themeId}
              onBack={() => setStep("mode")}
              onSuccess={(result) => {
                setMultiResult(result);
                setStep("multiSuccess");
              }}
            />
          )}
          {step === "multiSuccess" && multiResult && <MultiSuccessStep result={multiResult} />}
        </div>

        {step !== "multiSuccess" && (
          <p className="mt-4 text-center text-sm text-slate-500">
            {t("auth.haveAccount")}{" "}
            <Link href="/login" className="font-medium text-primary-600 hover:underline">
              {t("auth.loginLink")}
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
