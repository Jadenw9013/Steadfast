import { getCoachingRequestByToken } from "@/lib/queries/signature";
import { SignaturePage } from "./signature-page";

export default async function SignRoute({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const request = await getCoachingRequestByToken(token);

    // Error states — all inline, no redirects
    if (!request) {
        return <ErrorPage title="Invalid Link" message="This link is invalid or has already been used. Please contact your coach for a new link." />;
    }
    if (request.formsTokenExpiresAt && request.formsTokenExpiresAt < new Date()) {
        return <ErrorPage title="Link Expired" message="This link has expired. Please contact your coach to request a new link." />;
    }
    if (request.consultationStage === "FORMS_SIGNED") {
        return <ErrorPage title="Already Signed" message="You have already signed these forms. No further action is needed." />;
    }
    if (request.consultationStage !== "FORMS_SENT") {
        return <ErrorPage title="Invalid Link" message="This link is no longer valid. Please contact your coach." />;
    }
    if (!request.formSubmission) {
        return <ErrorPage title="Form Not Found" message="The intake form could not be found. Please contact your coach." />;
    }

    const coachName = [request.coachProfile.user.firstName, request.coachProfile.user.lastName].filter(Boolean).join(" ") || "Your coach";
    const answers = request.formSubmission.answers as Record<string, unknown>;

    return (
        <div className="min-h-screen bg-[#060d1b]">
            <SignaturePage
                token={token}
                prospectName={request.prospectName}
                coachName={coachName}
                answers={answers}
                prospectHasAccount={!!request.prospectId}
            />
        </div>
    );
}

function ErrorPage({ title, message }: { title: string; message: string }) {
    return (
        <div className="min-h-screen bg-[#060d1b] flex items-center justify-center px-4">
            <div className="max-w-md text-center space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </div>
                <h1 className="text-2xl font-bold text-zinc-100">{title}</h1>
                <p className="text-sm text-zinc-400 leading-relaxed">{message}</p>
                <p className="text-xs text-zinc-600 mt-8">Steadfast</p>
            </div>
        </div>
    );
}
