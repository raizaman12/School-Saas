import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary-50 text-primary-600">
        <Compass className="size-7" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-auth-title font-semibold text-slate-900">Page not found</h1>
        <p className="mt-1 text-sm text-slate-500">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
      </div>
      <Link href="/">
        <Button>Go to homepage</Button>
      </Link>
    </main>
  );
}
