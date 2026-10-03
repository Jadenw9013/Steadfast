import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiCoachingChooser } from "@/components/ai-coach/coaching-chooser";
import type { AiCoachDiscoveryOffer } from "@/lib/ai-coach/discovery";
import type { AiCoachDeliveryState } from "@/lib/ai-coach/operations";

/**
 * S-34 — state-table rows 4 (ENABLED) and 5 (PAUSED / DISABLED_BY_FLAG /
 * ERRORED, which must render byte-identically — `lib/ai-coach/discovery.ts`:
 * "Any gate failure is indistinguishable from unavailable").
 */

const baseOffer: AiCoachDiscoveryOffer = {
  releaseId: "release-1",
  configurationId: "config-1",
  configurationVersion: 1,
  locale: "en-US",
  serviceLabel: "Steadfast AI Coach",
  headline: "Personalized coaching, built around your routine",
  summary: "A short orienting summary of the AI coaching service.",
  informationHeading: "How AI coaching works",
  disclosureParagraphs: [
    "The first disclosure paragraph for the offer.",
    "The second disclosure paragraph for the offer.",
  ],
  consentLabel: "I consent",
  confirmLabel: "Confirm",
  privacyNoticeLabel: "Privacy and Terms",
  continueLabel: "Start AI Coach",
  humanCoachLabel: "Find a human coach",
  eligibilitySummary: "Open to eligible accounts only.",
  privacyNoticeVersion: "v1",
  privacyNoticeUrl: "https://example.test/privacy",
  pricing: null,
};

function render(offer: AiCoachDiscoveryOffer, aiPreparationState: AiCoachDeliveryState) {
  return renderToStaticMarkup(createElement(AiCoachingChooser, { offer, aiPreparationState }));
}

/** Returns the full `<a ...>` opening tag whose `href` matches, regardless of
 * attribute order, so tap-target assertions don't depend on how React or
 * next/link orders `class`/`href`. */
function anchorTag(html: string, href: string): string {
  const anchors = html.match(/<a\s[^>]*>/g) ?? [];
  const match = anchors.find((tag) => tag.includes(`href="${href}"`));
  if (!match) throw new Error(`no <a> tag with href="${href}" found`);
  return match;
}

const PAUSE_SENTENCE = "AI coaching cannot prepare a plan right now.";

describe("S-34 — AiCoachingChooser", () => {
  it("ENABLED (row 4): renders the full offer and not the pause sentence", () => {
    const html = render(baseOffer, "ENABLED");
    for (const value of [
      baseOffer.serviceLabel,
      baseOffer.headline,
      baseOffer.summary,
      baseOffer.informationHeading,
      baseOffer.eligibilitySummary,
      ...baseOffer.disclosureParagraphs,
    ]) {
      expect(html).toContain(value);
    }
    expect(html).toContain(`href="/client/ai-coach/start"`);
    expect(html).toContain(`href="/coaches"`);
    expect(html).toContain(baseOffer.continueLabel);
    expect(html).toContain(baseOffer.humanCoachLabel);
    expect(html).toContain(`href="${baseOffer.privacyNoticeUrl}"`);
    expect(html).toContain(baseOffer.privacyNoticeLabel);
    expect(html).not.toContain(PAUSE_SENTENCE);
  });

  it("PAUSED (row 5): the pause sentence appears exactly once, inside a role=\"status\" element, and both CTAs still work — the component-level degrade rule", () => {
    const html = render(baseOffer, "PAUSED");
    const matches = html.match(new RegExp(PAUSE_SENTENCE, "g")) ?? [];
    expect(matches).toHaveLength(1);
    expect(html).toMatch(/role="status"[^>]*>AI coaching cannot prepare a plan right now\.</);
    expect(html).toContain(`href="/client/ai-coach/start"`);
    expect(html).toContain(`href="/coaches"`);
  });

  it("DISABLED_BY_FLAG and ERRORED render byte-identically to PAUSED — gate failures are indistinguishable on screen", () => {
    const paused = render(baseOffer, "PAUSED");
    const disabledByFlag = render(baseOffer, "DISABLED_BY_FLAG");
    const errored = render(baseOffer, "ERRORED");
    expect(disabledByFlag).toBe(paused);
    expect(errored).toBe(paused);
  });

  it("pricing present: pricing.displayText is rendered", () => {
    const offerWithPricing: AiCoachDiscoveryOffer = {
      ...baseOffer,
      pricing: { productConfigurationId: "price-1", displayText: "$29/month, cancel anytime" },
    };
    const html = render(offerWithPricing, "ENABLED");
    expect(html).toContain("$29/month, cancel anytime");
  });

  it("pricing null: no pricing text is rendered", () => {
    const html = render(baseOffer, "ENABLED");
    expect(html).not.toContain("/month");
  });

  it("copy fence: no comparative, recommending, clinical or clock-time sentence, and no aiDiscoveryReasonCode value, in any of the four states", () => {
    const forbidden =
      /recommend|we suggest|best for you|instead of a human|clinical|guarantee|\bfaster\b|try again (later|in|at)|\d{1,2}:\d{2}/i;
    const reasonCodes = [
      "LIVE_RELEASE_UNAVAILABLE",
      "ACCOUNT_INELIGIBLE",
      "PROVIDER_RESOLUTION_REQUIRED",
      "HUMAN_PROVIDER_ACTIVE",
      "LIVE_PROFILE_REQUIRED",
      "ENTITLEMENT_REQUIRED",
    ];
    for (const state of ["ENABLED", "PAUSED", "DISABLED_BY_FLAG", "ERRORED"] as const) {
      const html = render(baseOffer, state);
      expect(html).not.toMatch(forbidden);
      for (const code of reasonCodes) {
        expect(html).not.toContain(code);
      }
    }
  });

  it("tap targets: min-h-14 on the primary CTA, min-h-12 on the secondary and privacy link", () => {
    const html = render(baseOffer, "ENABLED");
    expect(anchorTag(html, "/client/ai-coach/start")).toContain("min-h-14");
    expect(anchorTag(html, "/coaches")).toContain("min-h-12");
    expect(anchorTag(html, baseOffer.privacyNoticeUrl)).toContain("min-h-12");
  });
});
