import { MarkReviewedButton } from "@/components/coach/review/mark-reviewed-button";
import { PhotoLightbox } from "@/components/coach/review/photo-lightbox";

type Photo = {
  id: string;
  url: string;
  storagePath: string;
  sortOrder: number;
};

type CheckIn = {
  id: string;
  weight: number | null;
  dietCompliance: number | null;
  energyLevel: number | null;
  notes: string | null;
  status: string;
  isPrimary: boolean;
  createdAt: Date;
  photos: Photo[];
};

export function CheckInSummary({
  checkIn,
  weightDelta,
}: {
  checkIn: CheckIn | null;
  weightDelta: number | null;
}) {
  if (!checkIn) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center dark:border-zinc-700 dark:bg-[#0a1224]">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-lg dark:bg-zinc-800">
          &#128203;
        </div>
        <p className="mt-3 text-sm font-semibold">No check-in submitted yet</p>
        <p className="mt-1 text-xs text-zinc-500">
          You can still prepare this week&apos;s meal plan.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              checkIn.status === "REVIEWED" ? "bg-green-500" : "bg-blue-500"
            }`}
            aria-hidden="true"
          />
          <span
            className={`text-xs font-medium ${
              checkIn.status === "REVIEWED"
                ? "text-green-600 dark:text-green-400"
                : "text-blue-600 dark:text-blue-400"
            }`}
          >
            {checkIn.status === "REVIEWED" ? "Reviewed" : "New"}
          </span>
          <span className="text-xs text-zinc-400">
            &middot; {checkIn.createdAt.toLocaleDateString()}
          </span>
        </div>
        {checkIn.status !== "REVIEWED" && (
          <MarkReviewedButton checkInId={checkIn.id} />
        )}
      </div>

      {/* Metrics — weight prominent */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Weight
          </p>
          {checkIn.weight != null ? (
            <div className="mt-1">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold tabular-nums leading-none">
                  {checkIn.weight}
                </span>
                <span className="text-xs text-zinc-400">lbs</span>
              </div>
              {weightDelta != null && weightDelta !== 0 && (
                <span
                  className={`mt-0.5 block text-xs font-medium ${
                    weightDelta < 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-amber-500 dark:text-amber-400"
                  }`}
                >
                  {weightDelta > 0 ? "+" : ""}{weightDelta} lbs
                </span>
              )}
            </div>
          ) : (
            <p className="mt-1 text-2xl font-bold text-zinc-300 dark:text-zinc-600">&mdash;</p>
          )}
        </div>
        <MetricCard
          label="Diet"
          value={checkIn.dietCompliance}
          suffix="/10"
        />
        <MetricCard
          label="Energy"
          value={checkIn.energyLevel}
          suffix="/10"
        />
      </div>

      {/* Notes */}
      {checkIn.notes && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-400">
            Notes
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{checkIn.notes}</p>
        </div>
      )}

      {checkIn.photos.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400">
            Photos
          </p>
          <PhotoLightbox photos={checkIn.photos} />
        </div>
      )}

    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | null;
  suffix: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
        {label}
      </p>
      {value != null ? (
        <div className="mt-1 flex items-baseline gap-0.5">
          <span className="text-2xl font-bold tabular-nums leading-none">{value}</span>
          <span className="text-xs text-zinc-400">{suffix}</span>
        </div>
      ) : (
        <p className="mt-1 text-2xl font-bold text-zinc-300 dark:text-zinc-600">&mdash;</p>
      )}
    </div>
  );
}
