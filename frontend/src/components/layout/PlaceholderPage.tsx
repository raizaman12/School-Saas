import { Card, CardContent } from "@/components/ui";

/** Used for nav destinations whose full module UI lands in Day 12. */
export function PlaceholderPage({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      <Card>
        <CardContent className="py-10 text-center text-sm text-slate-500">
          {description ?? `The ${title} module UI is being built next.`}
        </CardContent>
      </Card>
    </div>
  );
}
