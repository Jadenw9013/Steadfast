import { redirect } from "next/navigation";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCoachingRequestForIntake } from "@/lib/queries/intake";
import { getOrCreateDefaultTemplate } from "@/app/actions/intake-form";
import { IntakeSession } from "@/components/coach/intake/intake-session";

export default async function IntakePage({ params }: { params: Promise<{ requestId: string }> }) {
    const { requestId } = await params;
    const user = await getCurrentDbUser();
    if (!user.isCoach) redirect("/");

    const request = await getCoachingRequestForIntake(requestId, user.id);
    if (!request) redirect("/coach/leads");

    // Only allow intake when consultation is done
    if (request.consultationStage !== "CONSULTATION_DONE" && request.consultationStage !== "FORMS_SENT") {
        redirect(`/coach/leads/${requestId}`);
    }

    const intakeAnswers = request.intakeAnswers as Record<string, string> | null;
    const existingAnswers = request.formSubmission?.answers as Record<string, unknown> | null;

    // Load coach's intake form template (or create default)
    const sections = await getOrCreateDefaultTemplate(user.id);

    return (
        <div className="mx-auto max-w-2xl py-8 px-4">
            <IntakeSession
                requestId={requestId}
                prospectName={request.prospectName}
                prospectEmail={request.prospectEmailAddr ?? null}
                prefillGoals={intakeAnswers?.goals ?? null}
                existingAnswers={existingAnswers}
                submissionId={request.formSubmission?.id ?? null}
                submissionStatus={request.formSubmission?.status ?? null}
                sections={sections}
            />
        </div>
    );
}
