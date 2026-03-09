import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCheckInById } from "@/lib/queries/check-ins";
import { getMessages } from "@/lib/queries/messages";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

export default async function ClientCheckInDetailPage({
  params,
}: {
  params: Promise<{ checkInId: string }>;
}) {
  const { checkInId } = await params;
  const user = await getCurrentDbUser();

  const checkIn = await getCheckInById(checkInId);
  if (!checkIn) notFound();

  // Authorization: client can only view their own check-ins
  if (checkIn.clientId !== user.id) notFound();

  const messages = await getMessages(checkIn.clientId, checkIn.weekOf);

  const coachMessages = messages.filter((m) => m.senderId !== user.id);

  const submittedLabel = checkIn.submittedAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/client"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label="Back to dashboard"
        >
          &larr;
        </Link>
        <div>
          <h1 className="text-lg font-bold tracking-tight">
            Check-In
          </h1>
          <p className="text-xs text-zinc-500">
            {submittedLabel}
          </p>
        </div>
      </div>

      {/* Status badge */}
      <div>
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            checkIn.status === "REVIEWED"
              ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
          }`}
        >
          {checkIn.status === "REVIEWED" ? "Reviewed" : "Pending Review"}
        </span>
      </div>

      {/* Metrics */}
      <section
        className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/50"
        aria-labelledby="metrics-heading"
      >
        <h2
          id="metrics-heading"
          className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Metrics
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricItem
            label="Weight"
            value={checkIn.weight != null ? `${checkIn.weight} lbs` : null}
          />
          <MetricItem
            label="Diet Compliance"
            value={
              checkIn.dietCompliance != null
                ? `${checkIn.dietCompliance}/10`
                : null
            }
          />
          <MetricItem
            label="Energy Level"
            value={
              checkIn.energyLevel != null
                ? `${checkIn.energyLevel}/10`
                : null
            }
          />
        </div>
      </section>

      {/* Notes */}
      {checkIn.notes && (
        <section
          className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/50"
          aria-labelledby="notes-heading"
        >
          <h2
            id="notes-heading"
            className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
          >
            Notes
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {checkIn.notes}
          </p>
        </section>
      )}

      {/* Photos */}
      {checkIn.photos.length > 0 && (
        <section
          className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/50"
          aria-labelledby="photos-heading"
        >
          <h2
            id="photos-heading"
            className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
          >
            Photos
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {checkIn.photos.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-square overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"
              >
                <Image
                  src={photo.url}
                  alt={`Check-in photo ${photo.sortOrder + 1}`}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, 33vw"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Coach Feedback */}
      <section
        className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/50"
        aria-labelledby="feedback-heading"
      >
        <h2
          id="feedback-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Coach Feedback
        </h2>
        {coachMessages.length > 0 ? (
          <div className="space-y-3">
            {coachMessages.map((msg) => (
              <div key={msg.id} className="space-y-1">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {msg.body}
                </p>
                <p className="text-xs text-zinc-400">
                  {msg.createdAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            No feedback yet. Your coach hasn&apos;t reviewed this check-in.
          </p>
        )}
      </section>
    </div>
  );
}

function MetricItem({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums">
        {value ?? (
          <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>
        )}
      </p>
    </div>
  );
}
