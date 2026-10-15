/**
 * S-19 dead end 1 — the shared restriction projection.
 *
 * `planRequestIsSafetyBlocked` is the predicate `requestAiRun` throws
 * `SAFETY_RESTRICTED` on. `deriveSafetyRestriction` is what the client sees.
 * If those two ever disagree the client is back to discovering the refusal as
 * a 409, so the equivalence is asserted here over every permission triple.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AiDomainPermission, AiSafetyDisposition } from "@/app/generated/prisma/client";
import {
  deriveSafetyRestriction,
  planRequestIsSafetyBlocked,
  SAFETY_RESTRICTED_PLAN_MESSAGE,
} from "@/lib/ai-coach/safety-restriction";

const PERMISSIONS: AiDomainPermission[] = ["ALLOW", "HOLD_ONLY", "PAUSED"];
const DISPOSITIONS: AiSafetyDisposition[] = ["CLEAR", "CLARIFY", "RESTRICTED", "REFER", "URGENT"];

describe("S-19 — the client-readable safety restriction", () => {
  it("returns null only for a fully clear account", () => {
    expect(
      deriveSafetyRestriction({
        disposition: "CLEAR",
        permissions: { nutrition: "ALLOW", strength: "ALLOW", cardio: "ALLOW" },
      })
    ).toBeNull();
  });

  it("reports the changed-allergen case exactly as the wizard's second pass leaves it", () => {
    expect(
      deriveSafetyRestriction({
        disposition: "RESTRICTED",
        permissions: { nutrition: "PAUSED", strength: "ALLOW", cardio: "ALLOW" },
      })
    ).toEqual({
      disposition: "RESTRICTED",
      restrictedDomains: ["NUTRITION"],
      planRequestBlocked: true,
      clientCanResolve: false,
      resolvedBy: "AUTHORIZED_REVIEWER",
    });
  });

  it("never claims the client can resolve it, for any state that produces a notice", () => {
    for (const disposition of DISPOSITIONS) {
      for (const nutrition of PERMISSIONS) {
        for (const strength of PERMISSIONS) {
          for (const cardio of PERMISSIONS) {
            const permissions = { nutrition, strength, cardio };
            const notice = deriveSafetyRestriction({ disposition, permissions });
            // The notice and the run guard are the same answer.
            if (notice)
              expect(notice.planRequestBlocked).toBe(planRequestIsSafetyBlocked(permissions));
            else expect(planRequestIsSafetyBlocked(permissions)).toBe(false);
            if (notice) {
              expect(notice.clientCanResolve).toBe(false);
              expect(notice.resolvedBy).toBe("AUTHORIZED_REVIEWER");
            }
            // A blocked plan request always has something to show the client.
            if (planRequestIsSafetyBlocked(permissions)) expect(notice).not.toBeNull();
          }
        }
      }
    }
  });

  it("is never wider than the amber banner it replaced (disposition !== CLEAR always renders)", () => {
    for (const disposition of DISPOSITIONS.filter((d) => d !== "CLEAR")) {
      expect(
        deriveSafetyRestriction({
          disposition,
          permissions: { nutrition: "ALLOW", strength: "ALLOW", cardio: "ALLOW" },
        })
      ).not.toBeNull();
    }
  });

  it("run-command raises exactly the message this module owns — one string, one source", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/ai-coach/run-command.ts"),
      "utf8"
    );
    expect(source).toContain("SAFETY_RESTRICTED_PLAN_MESSAGE");
    // The literal must not have been left behind next to the constant.
    expect(source).not.toContain(SAFETY_RESTRICTED_PLAN_MESSAGE);
  });

  it("only resolveAiSafety can restore a domain permission — every other writer can only restrict", () => {
    // Every `AiCoachProfile` write whose payload touches a domain permission.
    const calls: { file: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full.endsWith(path.join("app", "generated"))) continue;
          walk(full);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          const source = fs.readFileSync(full, "utf8");
          for (const match of source.matchAll(/aiCoachProfile\.(?:update|upsert|updateMany)\(/g)) {
            // The call text up to the first `});` is enough to see its `data`.
            const start = match.index ?? 0;
            const end = source.indexOf("});", start);
            const text = source.slice(start, end === -1 ? source.length : end);
            if (/(?:nutrition|strength|cardio)Permission/.test(text))
              calls.push({ file: path.relative(process.cwd(), full), text });
          }
        }
      }
    };
    for (const dir of ["lib", "app", "components"]) walk(path.join(process.cwd(), dir));

    expect([...new Set(calls.map((call) => call.file))].sort()).toEqual([
      "lib/ai-coach/client-commands.ts", // ALLERGIES: pauses on a new concern
      "lib/ai-coach/evidence.ts", // a reported concern: pauses every domain
      "lib/ai-coach/safety-resolution.ts", // the ONLY restore, reviewer-scoped
      "lib/ai-coach/safety.ts", // submitSafetyDisclosure: monotone ratchet
    ]);
    // None of the other three may hand a domain back to ALLOW.
    for (const call of calls.filter((c) => !c.file.endsWith("safety-resolution.ts"))) {
      expect({ file: call.file, restores: /"ALLOW"/.test(call.text) }).toMatchObject({
        file: call.file,
        restores: false,
      });
    }
  });
});
