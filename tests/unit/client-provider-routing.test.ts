import { describe, expect, it } from "vitest";
import {
  rendersAiWorkspace,
  rendersCoachingChooser,
  type ClientProviderState,
} from "@/lib/queries/client-provider";
import type { AiCoachDiscoveryOffer } from "@/lib/ai-coach/discovery";

/**
 * S-34 — the pure predicate truth table. These are the only two functions
 * the six client route guards (`app/client/layout.tsx`, `app/client/page.tsx`,
 * `app/client/plan/page.tsx`, `app/client/training/page.tsx`,
 * `app/client/meal-plan/page.tsx`, `app/client/check-in/page.tsx`) may call
 * to decide between the AI workspace, the coaching chooser, and today's
 * client surfaces — so the whole routing decision is pinned here once.
 */

const offer: AiCoachDiscoveryOffer = {
  releaseId: "release-1",
  configurationId: "config-1",
  configurationVersion: 1,
  locale: "en-US",
  serviceLabel: "Steadfast AI Coach",
  headline: "headline",
  summary: "summary",
  informationHeading: "information heading",
  disclosureParagraphs: ["one disclosure"],
  consentLabel: "consent",
  confirmLabel: "confirm",
  privacyNoticeLabel: "Privacy & Terms",
  continueLabel: "continue",
  humanCoachLabel: "Find a human coach",
  eligibilitySummary: "eligibility",
  privacyNoticeVersion: "v1",
  privacyNoticeUrl: "/terms",
  pricing: null,
};

function base(overrides: Partial<ClientProviderState>): ClientProviderState {
  return {
    origin: "NONE",
    revision: 0,
    resolutionRequired: false,
    activeCoachClientId: null,
    coachId: null,
    relationshipStartedAt: null,
    aiPreviewAvailable: false,
    aiDiscovery: null,
    aiDiscoveryReasonCode: null,
    ...overrides,
  };
}

describe("S-34 — rendersAiWorkspace / rendersCoachingChooser truth table", () => {
  it("origin AI, no offer: workspace true, chooser false", () => {
    const p = base({ origin: "AI" });
    expect(rendersAiWorkspace(p)).toBe(true);
    expect(rendersCoachingChooser(p)).toBe(false);
  });

  it("origin AI with an offer present: workspace true, chooser false — origin wins", () => {
    const p = base({ origin: "AI", aiDiscovery: offer, aiPreviewAvailable: true });
    expect(rendersAiWorkspace(p)).toBe(true);
    expect(rendersCoachingChooser(p)).toBe(false);
  });

  it("origin NONE, synthetic preview available, no offer: workspace true, chooser false — the regression that keeps fixture accounts on today's behavior", () => {
    const p = base({ origin: "NONE", aiPreviewAvailable: true, aiDiscovery: null });
    expect(rendersAiWorkspace(p)).toBe(true);
    expect(rendersCoachingChooser(p)).toBe(false);
  });

  it("origin NONE, live offer: workspace false, chooser true", () => {
    const p = base({ origin: "NONE", aiPreviewAvailable: true, aiDiscovery: offer });
    expect(rendersAiWorkspace(p)).toBe(false);
    expect(rendersCoachingChooser(p)).toBe(true);
  });

  it("resolution required, with an offer: both false", () => {
    const p = base({ origin: "NONE", resolutionRequired: true, aiDiscovery: offer });
    expect(rendersAiWorkspace(p)).toBe(false);
    expect(rendersCoachingChooser(p)).toBe(false);
  });

  it("origin HUMAN: both false", () => {
    const p = base({ origin: "HUMAN" });
    expect(rendersAiWorkspace(p)).toBe(false);
    expect(rendersCoachingChooser(p)).toBe(false);
  });

  it("bare origin NONE, no offer, no preview: both false", () => {
    const p = base({});
    expect(rendersAiWorkspace(p)).toBe(false);
    expect(rendersCoachingChooser(p)).toBe(false);
  });
});
