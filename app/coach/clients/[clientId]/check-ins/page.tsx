import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { getClientCheckIns } from "@/lib/queries/check-ins";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function ClientCheckInsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  await verifyCoachAccessToClient(clientId);

  const client = await db.user.findUnique({ where: { id: clientId } });
  if (!client) notFound();

  const checkIns = await getClientCheckIns(clientId);

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/coach/clients/${clientId}`}
          className="text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
        >
          &larr; Back to profile
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white">
          {client.firstName} {client.lastName}
        </h1>
        <p className="text-sm text-zinc-400">{client.email}</p>
      </div>

      {checkIns.length === 0 ? (
        <div className="sf-glass-card p-12 text-center">
          <p className="text-zinc-400">No check-ins from this client yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {checkIns.map((checkIn) => (
            <Link
              key={checkIn.id}
              href={`/coach/clients/${clientId}/check-ins/${checkIn.id}`}
              className="block rounded-xl border border-white/[0.08] bg-white/[0.04] p-4 transition-colors hover:border-white/[0.14] hover:bg-white/[0.07]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">
                    Week of{" "}
                    {checkIn.weekOf.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                  <div className="mt-1 flex gap-4 text-sm text-zinc-400">
                    {checkIn.weight && <span>{checkIn.weight} lbs</span>}
                    {checkIn.photos.length > 0 && (
                      <span>{checkIn.photos.length} photo(s)</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-zinc-500">
                  {checkIn.createdAt.toLocaleDateString()}
                </p>
              </div>
              {checkIn.notes && (
                <p className="mt-2 text-sm text-zinc-400 line-clamp-2">
                  {checkIn.notes}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
