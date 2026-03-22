import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getTemplateById } from "@/lib/queries/training-templates";
import { TemplateEditor } from "@/components/coach/training/template-editor";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const user = await getCurrentDbUser();
  const template = await getTemplateById(templateId, user.id);

  if (!template) notFound();

  return (
    <div className="space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/coach/templates/workouts"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:text-zinc-300"
          aria-label="Back to templates"
        >
          &larr; Templates
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{template.name}</h1>
        {template.description && (
          <p className="mt-1.5 text-sm text-zinc-500">{template.description}</p>
        )}
      </section>

      <section className="animate-fade-in" style={{ animationDelay: "80ms" }}>
        <TemplateEditor initialTemplate={template} />
      </section>
    </div>
  );
}
