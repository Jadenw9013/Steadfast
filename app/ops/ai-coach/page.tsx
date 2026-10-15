import { notFound } from "next/navigation";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getReviewerQueue } from "@/lib/ai-coach/reviewer";
import { AiCoachError } from "@/lib/ai-coach/access";
import { ReviewerWorkspace } from "@/components/ai-coach/reviewer-workspace";
export default async function ReviewerPage() {
  const user = await getCurrentDbUser();
  let queue;
  try { queue = await getReviewerQueue(user.id); } catch (error) {
    if (error instanceof AiCoachError) notFound();
    throw error;
  }
  return <ReviewerWorkspace initial={queue} />;
}
