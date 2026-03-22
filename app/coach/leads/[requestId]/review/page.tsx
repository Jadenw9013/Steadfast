import { getCurrentDbUser } from "@/lib/auth/roles";
import { notFound } from "next/navigation";
import { getIntakePacketForReview } from "@/lib/queries/intake";
import { Metadata } from "next";
import { ReviewSession } from "@/components/coach/intake/review-session";
import Link from "next/link";

export const metadata: Metadata = { title: "Review Intake | Steadfast" };

export default async function ReviewPage({ params }: { params: Promise<{ requestId: string }> }) {
    const { requestId } = await params;
    const user = await getCurrentDbUser();
    if (!user.isCoach) return <p className="p-8 text-zinc-400">Unauthorized</p>;

    const packet = await getIntakePacketForReview(requestId, user.id);
    if (!packet) notFound();

    const prospectName = packet.coachingRequest.prospectName;

    const answers = packet.formAnswers as {
        sections?: { sectionId: string; sectionTitle: string; answers: { questionId: string; label: string; value: string }[] }[];
    } | null;

    const documents = packet.documents.map(d => ({
        id: d.id,
        title: d.coachDocument.title,
        type: d.coachDocument.type as "TEXT" | "FILE",
        content: d.coachDocument.content,
        fileName: d.coachDocument.fileName,
        signature: d.signature ? {
            signatureType: d.signature.signatureType as "TYPED" | "DRAWN",
            signatureValue: d.signature.signatureValue,
            signedAt: d.signature.signedAt.toISOString(),
        } : null,
    }));

    return (
        <div className="mx-auto max-w-3xl space-y-8">
            <Link href={`/coach/leads/${requestId}`} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                Back to Lead
            </Link>

            <div>
                <h1 className="text-xl font-bold text-zinc-100">Review: {prospectName}</h1>
                <p className="mt-1 text-sm text-zinc-500">
                    Review and edit intake answers. Changes auto-save.
                    {packet.submittedAt && (
                        <span> · Submitted {new Date(packet.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    )}
                </p>
            </div>

            <ReviewSession
                packetId={packet.id}
                requestId={requestId}
                prospectName={prospectName}
                answers={answers}
                coachNotes={packet.coachNotes ?? ""}
                documents={documents}
                consultationStage={packet.coachingRequest.consultationStage}
            />
        </div>
    );
}
