"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { School, Building2 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api";
import { loginSchema, type LoginFormValues } from "@/lib/auth/schemas";
import type { ResolvedSchool } from "@/lib/auth/types";
import { tenantApi } from "@/lib/resources/tenant";
import { extractTenantSlugFromHost } from "@/lib/subdomain";
import { applyThemeById } from "@/lib/theme";
import { useAsync } from "@/lib/hooks/useAsync";
import { Button, Input, Alert, Spinner } from "@/components/ui";
import { t } from "@/lib/i18n";

type LoginStep = "slug" | "branch" | "credentials";

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Subdomain-per-school: <slug>.<appDomain> auto-fills/auto-resolves the
  // school field instead of asking the user to type it. Detected
  // client-side from the real browser hostname (not via middleware/
  // searchParams — /login is statically prerendered, so a rewritten search
  // param never reaches useSearchParams() here). Starts null and is set on
  // mount so server-rendered and first-client-render HTML match (no
  // hydration mismatch).
  const [detectedSlug, setDetectedSlug] = useState<string | null>(null);
  // Once a subdomain-detected school 404s, fall back to manual entry
  // rather than trapping the user on a dead end.
  const [manualEntry, setManualEntry] = useState(false);

  const [step, setStep] = useState<LoginStep>("slug");
  const [resolved, setResolved] = useState<ResolvedSchool | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
    if (!appDomain) return;
    setDetectedSlug(extractTenantSlugFromHost(window.location.host, appDomain));
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema), defaultValues: { slug: detectedSlug ?? "" } });

  const showAutoDetected = Boolean(detectedSlug) && !manualEntry;

  // Pre-authentication lookup — resolves the auto-detected subdomain to
  // either a single school (straight to credentials) or a multi-branch
  // group (straight to the branch picker), same "no auth required" data
  // as the old tenant-by-slug lookup this replaces.
  const {
    data: autoResolved,
    isLoading: isLoadingAuto,
    error: autoError,
  } = useAsync(() => (detectedSlug ? tenantApi.resolveSchool(detectedSlug) : Promise.resolve(null)), [detectedSlug]);

  useEffect(() => {
    if (detectedSlug) setValue("slug", detectedSlug);
  }, [detectedSlug, setValue]);

  // Once the auto-detected subdomain resolves, skip straight past the
  // manual slug-entry step — to credentials for a single school, or to the
  // branch picker for a group (both keep the smooth zero-extra-click
  // auto-detect UX this page already had for single schools).
  useEffect(() => {
    if (!autoResolved) return;
    setResolved(autoResolved);
    if (autoResolved.kind === "tenant") {
      setValue("slug", autoResolved.tenant.slug);
      setStep("credentials");
    } else {
      setStep("branch");
    }
  }, [autoResolved, setValue]);

  // Theme the login page itself in the resolved school's accent color —
  // before anyone has typed a password, so the page already looks like
  // "their" school rather than the generic default blue.
  useEffect(() => {
    if (resolved?.kind === "tenant") applyThemeById(resolved.tenant.themeId);
  }, [resolved]);

  async function resolveAndAdvance(slug: string) {
    setResolveError(null);
    setIsResolving(true);
    try {
      const result = await tenantApi.resolveSchool(slug);
      setResolved(result);
      if (result.kind === "tenant") {
        setValue("slug", result.tenant.slug);
        setStep("credentials");
      } else {
        setStep("branch");
      }
    } catch (err) {
      setResolveError(err instanceof ApiError && err.status === 404 ? "School not found" : "Something went wrong. Please try again.");
    } finally {
      setIsResolving(false);
    }
  }

  const handleSlugContinue = async () => {
    const valid = await trigger("slug");
    if (!valid) return;
    await resolveAndAdvance(getValues("slug"));
  };

  const handlePickBranch = async (branchSlug: string) => {
    await resolveAndAdvance(branchSlug);
  };

  const onSubmit = async (values: LoginFormValues) => {
    setFormError(null);
    try {
      const user = await login(values);
      const portalRole = user.role === "PARENT" || user.role === "STUDENT";
      const next = searchParams.get("next");
      router.push(next ?? (portalRole ? "/portal" : "/dashboard"));
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.status === 401 ? t("auth.invalidCredentials") : err.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    }
  };

  // ── Step: slug entry (manual, or the auto-detect loading/fallback UI) ──
  if (step === "slug") {
    return (
      <div className="flex flex-col gap-4">
        {showAutoDetected ? (
          isLoadingAuto ? (
            <Spinner label="Looking up your school" />
          ) : autoError ? (
            <Alert tone="warning">
              We couldn&apos;t find a school at this address.{" "}
              <button type="button" className="font-medium underline" onClick={() => setManualEntry(true)}>
                Enter your school ID manually
              </button>
              .
            </Alert>
          ) : (
            <Spinner label="Looking up your school" />
          )
        ) : (
          <>
            {resolveError && <Alert tone="danger">{resolveError}</Alert>}
            <Input
              label={t("auth.schoolSlug")}
              placeholder="your-school"
              hint="Ask your school for this if you're not sure — it's not your personal login."
              required
              error={errors.slug?.message}
              {...register("slug")}
            />
            <Button type="button" isLoading={isResolving} onClick={handleSlugContinue} className="w-full">
              {t("auth.continueButton")}
            </Button>
          </>
        )}
      </div>
    );
  }

  // ── Step: branch picker (multi-branch group only) ──
  if (step === "branch" && resolved?.kind === "group") {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <h2 className="text-auth-title font-semibold text-slate-900">{t("auth.chooseBranchTitle")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("auth.chooseBranchSubtitle")}</p>
        </div>

        {resolveError && <Alert tone="danger">{resolveError}</Alert>}

        <div className="flex flex-col gap-2">
          {resolved.group.branches.map((branch) => (
            <button
              key={branch.slug}
              type="button"
              disabled={isResolving}
              onClick={() => handlePickBranch(branch.slug)}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300 disabled:opacity-60"
            >
              <Building2 className="mt-0.5 size-5 shrink-0 text-slate-500" aria-hidden="true" />
              <div className="flex flex-col">
                <span className="font-semibold text-slate-900">{branch.branchName}</span>
                {branch.city && <span className="text-sm text-slate-500">{branch.city}</span>}
              </div>
            </button>
          ))}
        </div>

        {isResolving && <Spinner label="Loading branch" />}

        {!showAutoDetected && (
          <button
            type="button"
            className="text-sm font-medium text-primary-600 hover:underline"
            onClick={() => {
              setResolved(null);
              setStep("slug");
            }}
          >
            {t("auth.backButton")}
          </button>
        )}
      </div>
    );
  }

  // ── Step: credentials (single school, or a picked/resolved branch) ──
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      {formError && <Alert tone="danger">{formError}</Alert>}

      {resolved?.kind === "tenant" && (
        <div className="flex items-center gap-2 rounded-lg bg-primary-50 px-3 py-2.5 text-sm text-primary-800">
          <School className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {t("auth.signingInToPrefix")} <span className="font-semibold">{resolved.tenant.name}</span>
          </span>
          {resolved.tenant.groupSlug && !showAutoDetected && (
            <button
              type="button"
              className="ml-auto shrink-0 font-medium underline"
              onClick={() => resolveAndAdvance(resolved.tenant.groupSlug!)}
            >
              {t("auth.changeBranch")}
            </button>
          )}
        </div>
      )}

      <Input
        label={t("auth.emailOrLoginId")}
        type="text"
        autoComplete="username"
        required
        error={errors.email?.message}
        {...register("email")}
      />
      <Input
        label={t("auth.password")}
        type="password"
        required
        error={errors.password?.message}
        {...register("password")}
      />
      <div className="-mt-2 text-right">
        <Link href="/forgot-password" className="text-sm font-medium text-primary-600 hover:underline">
          {t("auth.forgotPasswordLink")}
        </Link>
      </div>

      <Button type="submit" isLoading={isSubmitting} className="mt-2 w-full">
        {t("auth.loginButton")}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-auth-title font-semibold text-slate-900">{t("auth.loginTitle")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("auth.loginSubtitle")}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-4 text-center text-sm text-slate-500">
          {t("auth.noAccount")}{" "}
          <Link href="/signup" className="font-medium text-primary-600 hover:underline">
            {t("auth.registerLink")}
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-slate-400">
          <Link href="/platform-login" className="hover:underline">
            {t("auth.platformStaffLink")}
          </Link>
        </p>
      </div>
    </main>
  );
}
