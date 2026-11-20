import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { db } = require("./lib/db.ts");
const { requireLocalTestDb } = require("./tests/helpers/require-local-test-db.ts");
requireLocalTestDb();
const base = new URL(process.env.ROUTING_AUDIT_BASE_URL ?? "http://127.0.0.1:4190");
if (!["127.0.0.1", "localhost"].includes(base.hostname)) throw new Error("Local test server required");
const { chromium, expect } = require("@playwright/test");
const marker = randomUUID();
const coach = await db.user.create({ data: { clerkId: marker, email: `${marker}@example.test`, isCoach: true, isClient: false, activeRole: "COACH", firstName: "Synthetic coach" } });
const profile = await db.coachProfile.create({ data: { userId: coach.id, slug: `audit-${marker}` } });
await db.intakeFormTemplate.create({ data: { coachId: coach.id, sections: [{ id: "basics", title: "Basics", questions: [{ id: "goal", label: "Your goal", type: "short_text", required: true }] }] } });
const lead = await db.coachingRequest.create({ data: { coachProfileId: profile.id, prospectName: "Synthetic prospect", prospectEmail: `${randomUUID()}@example.test`, intakeAnswers: {}, consultationStage: "INTAKE_SENT" }, select: { id: true } });
const packet = await db.intakePacket.create({ data: { coachingRequestId: lead.id, token: randomUUID(), tokenExpiresAt: new Date(Date.now() + 86400000) } });
const document = await db.coachDocument.create({ data: { coachId: coach.id, type: "TEXT", title: "Synthetic waiver", content: "Synthetic document for browser verification." } });
await db.intakePacketDocument.create({ data: { intakePacketId: packet.id, coachDocumentId: document.id } });
const signatureToken = randomUUID();
const signatureLead = await db.coachingRequest.create({ data: { coachProfileId: profile.id, prospectName: "Synthetic prospect", prospectEmail: `${randomUUID()}@example.test`, intakeAnswers: {}, consultationStage: "FORMS_SENT", formsToken: signatureToken, formsTokenExpiresAt: new Date(Date.now() + 86400000) }, select: { id: true } });
await db.clientFormSubmission.create({ data: { coachingRequestId: signatureLead.id, answers: {}, status: "SENT" } });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, timezoneId: "America/Los_Angeles", locale: "en-US" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  async function visit(path) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await page.goto(new URL(path, base).href, { waitUntil: "commit", timeout: 20000 }); }
      catch (error) { if (!error.message.includes("ERR_NETWORK_CHANGED") || attempt === 2) throw error; }
    }
  }
  const response = await visit(`/onboarding/intake/${packet.token}`);
  expect(response.status()).toBe(200);
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator("#q-goal").fill("Build a steady routine");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("checkbox").check();
  await page.getByPlaceholder("Type your full name").fill("Synthetic prospect");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Submit my forms" }).click();
  await expect(page.getByText("All done, Synthetic prospect!")).toBeVisible();
  expect((await db.intakePacket.findUniqueOrThrow({ where: { id: packet.id } })).submittedAt).not.toBeNull();
  await visit(`/onboarding/intake/${packet.token}`);
  await expect(page.getByRole("heading", { name: "Already completed" })).toBeVisible();
  await visit(`/onboarding/sign/${signatureToken}`);
  await expect(page.getByRole("button", { name: "Read page aloud" })).toBeVisible();
  await page.getByLabel("Type your full legal name as your signature").fill("Synthetic prospect");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm and Sign" }).click();
  await expect.poll(async () => db.clientFormSignature.count({ where: { coachingRequestId: signatureLead.id } })).toBe(1);
  expect((await db.coachingRequest.findUniqueOrThrow({ where: { id: signatureLead.id }, select: { consultationStage: true } })).consultationStage).toBe("FORMS_SIGNED");
  expect(errors).toEqual([]);
  console.log("PASS: signed-out mobile intake and signature actions, replay handling and hydration on the built app with local synthetic data.");
} finally {
  await browser.close();
  await db.documentSignature.deleteMany({ where: { intakePacketDocument: { intakePacketId: packet.id } } });
  await db.intakePacketDocument.deleteMany({ where: { intakePacketId: packet.id } });
  await db.intakePacket.delete({ where: { id: packet.id } });
  await db.clientFormSignature.deleteMany({ where: { coachingRequestId: signatureLead.id } });
  await db.clientFormSubmission.deleteMany({ where: { coachingRequestId: signatureLead.id } });
  await db.coachingRequest.deleteMany({ where: { id: { in: [lead.id, signatureLead.id] } } });
  await db.coachDocument.delete({ where: { id: document.id } });
  await db.intakeFormTemplate.delete({ where: { coachId: coach.id } });
  await db.coachProfile.delete({ where: { id: profile.id } });
  await db.user.delete({ where: { id: coach.id } });
  await db.$disconnect();
}
