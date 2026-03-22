import { getIntakePacketByToken } from "@/lib/queries/intake";
import IntakePacketPage from "./intake-packet-page";

export default async function IntakeTokenPage({
    params,
}: {
    params: Promise<{ token: string }>;
}) {
    const { token } = await params;
    const data = await getIntakePacketByToken(token);

    if (!data) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-8">
                <div className="max-w-md text-center">
                    <h1 className="text-2xl font-bold text-zinc-100">Invalid link</h1>
                    <p className="mt-2 text-zinc-400">This intake link is not valid. Please check the link in your email or contact your coach.</p>
                </div>
            </div>
        );
    }

    const { packet, template } = data;

    if (packet.tokenExpiresAt < new Date()) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-8">
                <div className="max-w-md text-center">
                    <h1 className="text-2xl font-bold text-zinc-100">Link expired</h1>
                    <p className="mt-2 text-zinc-400">This intake link has expired. Please contact your coach for a new one.</p>
                </div>
            </div>
        );
    }

    if (packet.submittedAt) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-8">
                <div className="max-w-md text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><path d="M20 6 9 17l-5-5"/></svg>
                    </div>
                    <h1 className="text-2xl font-bold text-zinc-100">Already completed</h1>
                    <p className="mt-2 text-zinc-400">You&apos;ve already submitted your intake forms. No further action needed.</p>
                </div>
            </div>
        );
    }

    const coachName = [packet.coachingRequest.coachProfile.user.firstName, packet.coachingRequest.coachProfile.user.lastName].filter(Boolean).join(" ") || "Your coach";
    const prospectName = packet.coachingRequest.prospectName;

    const sections = template
        ? (template.sections as unknown as { id: string; title: string; questions: { id: string; label: string; type: string; required: boolean }[] }[])
        : [];

    const documents = packet.documents.map(d => ({
        id: d.id,
        coachDocumentId: d.coachDocument.id,
        title: d.coachDocument.title,
        type: d.coachDocument.type as "TEXT" | "FILE",
        content: d.coachDocument.content,
        fileName: d.coachDocument.fileName,
        filePath: d.coachDocument.filePath,
    }));

    return (
        <IntakePacketPage
            token={token}
            coachName={coachName}
            prospectName={prospectName}
            sections={sections}
            documents={documents}
        />
    );
}
