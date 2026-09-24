import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("T-1011 hidden discovery and onboarding contract", () => {
  it("renders only release-bound discovery copy with accessible landmarks and controls", () => {
    const page = source("app/ai-coach/page.tsx");
    for (const binding of [
      "offer.serviceLabel",
      "offer.headline",
      "offer.summary",
      "offer.informationHeading",
      "offer.eligibilitySummary",
      "offer.disclosureParagraphs",
      "offer.continueLabel",
      "offer.humanCoachLabel",
      "offer.privacyNoticeLabel",
    ]) {
      expect(page).toContain(binding);
    }
    expect(page).toContain('id="main-content"');
    expect(page).toContain('aria-labelledby="ai-coach-heading"');
    expect(page).toContain("min-h-14");
    expect(page).toContain("min-h-12");
    expect(page).not.toMatch(/REQUIRED HUMAN DECISION|clinically validated|risk-free/i);
  });

  it("keeps discovery unreachable without an active persisted release and blocks missing disclosure", () => {
    const discovery = source("lib/ai-coach/discovery.ts");
    const page = source("app/ai-coach/page.tsx");
    const onboarding = source("components/ai-coach/experience.tsx");
    expect(discovery).toContain("assertActiveAiCoachLiveReleaseReady()");
    expect(discovery).toContain("catch {");
    expect(discovery).toContain("return null");
    expect(page).toContain("if (!offer) notFound()");
    expect(onboarding).toContain('view.experience.mode === "LIVE" && !liveDisclosure');
    expect(onboarding).toContain("No enrollment or coaching action");
  });

  it("T-989: also requires the enrollment flag, independently of the activation row", () => {
    const discovery = source("lib/ai-coach/discovery.ts");
    // Two independent gates on the single discovery choke point every
    // user-facing surface (`/ai-coach`, the `/coaches` promo, and
    // `getClientProvider`'s in-transaction offer) reads through: the
    // activation row stays the CLI-only source of truth, and this env flag
    // is a second, instantly-revertible off-switch on top of it, per the
    // standing "AI Coach flags stay OFF" rule.
    expect(discovery).toContain("isAiCoachEnrollmentEnabled()");
    expect(discovery.match(/if \(!isAiCoachEnrollmentEnabled\(\)\) return null;/g)?.length).toBe(2);
  });
});
