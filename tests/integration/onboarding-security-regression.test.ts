import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import type { Prisma } from "@/app/generated/prisma/client";

const state = vi.hoisted(() => ({ user: null as unknown, afterUpload: null as null | (() => Promise<void>), emailSent: true }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: async () => {
  if (!state.user) throw new Error("Not authenticated");
  return state.user;
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn(async () => ({ success: state.emailSent })) }));
vi.mock("@/lib/supabase/document-storage", () => ({ uploadCoachDocument: vi.fn(async () => { await state.afterUpload?.(); }) }));

import { submitIntakePacket, uploadSignedDocument, removeSignedUpload } from "@/app/actions/intake";
import { submitOnboardingResponse } from "@/app/actions/client-onboarding";
import { approveCoachingRequest, resendInvite } from "@/app/actions/coaching-requests";
import { getCoachQuestionnaireResponse, getPendingClientQuestionnaire } from "@/lib/onboarding/questionnaire";
import { submitSignature } from "@/app/actions/signature";
import { sendClientInvite } from "@/app/actions/client-invites";
import { acceptClientInviteForUser } from "@/lib/activation";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

suite("onboarding authorization, completeness and replay", () => {
  const users: string[] = [];
  const leads: string[] = [];
  beforeEach(() => { vi.clearAllMocks(); state.user = null; state.afterUpload = null; state.emailSent = true; });
  afterAll(async () => {
    const packets = await db.intakePacket.findMany({ where: { coachingRequestId: { in: leads } }, select: { id: true } });
    const packetIds = packets.map(packet => packet.id);
    await db.documentSignature.deleteMany({ where: { intakePacketDocument: { intakePacketId: { in: packetIds } } } });
    await db.intakePacketDocument.deleteMany({ where: { intakePacketId: { in: packetIds } } });
    await db.intakePacket.deleteMany({ where: { id: { in: packetIds } } });
    await db.storageCleanupOutbox.deleteMany({ where: { storagePath: { startsWith: "signed-uploads/" }, OR: packetIds.map(id => ({ storagePath: { startsWith: `signed-uploads/${id}/` } })) } });
    await db.clientInvite.deleteMany({ where: { OR: [{ requestId: { in: leads } }, { coachId: { in: users } }] } });
    await db.clientFormSignature.deleteMany({ where: { coachingRequestId: { in: leads } } });
    await db.clientFormSubmission.deleteMany({ where: { coachingRequestId: { in: leads } } });
    await db.coachingRequest.deleteMany({ where: { id: { in: leads } } });
    await db.coachDocument.deleteMany({ where: { coachId: { in: users } } });
    await db.intakeFormTemplate.deleteMany({ where: { coachId: { in: users } } });
    await db.onboardingResponse.deleteMany({ where: { clientId: { in: users } } });
    await db.onboardingForm.deleteMany({ where: { coachId: { in: users } } });
    await db.clientCoachingContext.deleteMany({ where: { clientId: { in: users } } });
    await db.coachClient.deleteMany({ where: { clientId: { in: users } } });
    await db.coachProfile.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  async function account(coach = false) {
    const id = randomUUID();
    const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: coach, isClient: !coach, activeRole: coach ? "COACH" : "CLIENT" } });
    users.push(user.id);
    return user;
  }

  async function packetFixture(withDocument = false) {
    const coach = await account(true);
    const profile = await db.coachProfile.create({ data: { userId: coach.id, slug: `audit-${randomUUID()}` } });
    await db.intakeFormTemplate.create({ data: { coachId: coach.id, sections: [{ id: "basics", title: "Basics", questions: [{ id: "goal", label: "Goal", type: "short_text", required: true }] }] } });
    const lead = await db.coachingRequest.create({ data: { coachProfileId: profile.id, prospectName: "Synthetic prospect", prospectEmail: `${randomUUID()}@example.test`, intakeAnswers: {}, consultationStage: "INTAKE_SENT" }, select: { id: true } });
    leads.push(lead.id);
    const packet = await db.intakePacket.create({ data: { coachingRequestId: lead.id, token: randomUUID(), tokenExpiresAt: new Date(Date.now() + 86400000) } });
    const document = withDocument ? await db.coachDocument.create({ data: { coachId: coach.id, title: "Synthetic waiver", type: "TEXT", content: "Synthetic" } }) : null;
    const packetDocument = document ? await db.intakePacketDocument.create({ data: { intakePacketId: packet.id, coachDocumentId: document.id } }) : null;
    return { coach, lead, packet, document, packetDocument };
  }

  function payload(fixture: Awaited<ReturnType<typeof packetFixture>>) {
    return { token: fixture.packet.token, answers: { goal: "Build habits" }, documentSignatures: fixture.packetDocument && fixture.document ? [{ intakePacketDocumentId: fixture.packetDocument.id, coachDocumentId: fixture.document.id, signatureType: "TYPED" as const, signatureValue: "Synthetic prospect" }] : [] };
  }

  async function questionnaire() {
    const coach = await account(true);
    const client = await account();
    const link = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id }, select: { id: true } });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "HUMAN", activeCoachClientId: link.id } });
    const form = await db.onboardingForm.create({ data: { coachId: coach.id, questions: [{ id: "goal", label: "Goal", type: "shortText", required: true }] } });
    state.user = client;
    return { coach, client, form };
  }

  async function submitQuestionnaire(input: Parameters<typeof submitOnboardingResponse>[0]) {
    try {
      return await submitOnboardingResponse(input);
    } catch (error) {
      if (error instanceof Error && error.message === "REDIRECT:/client") return { success: true };
      throw error;
    }
  }

  it("rejects signatures targeting a different client's packet without any writes", async () => {
    const attacker = await packetFixture();
    const victim = await packetFixture(true);
    const input = payload(attacker);
    input.documentSignatures = payload(victim).documentSignatures;
    expect(await submitIntakePacket(input)).toMatchObject({ success: false });
    expect(await db.documentSignature.count({ where: { intakePacketDocumentId: victim.packetDocument!.id } })).toBe(0);
    expect((await db.intakePacket.findUniqueOrThrow({ where: { id: attacker.packet.id } })).submittedAt).toBeNull();
  });

  it("rejects an own-packet signature whose underlying coach document was substituted", async () => {
    const owner = await packetFixture(true);
    const stranger = await packetFixture(true);
    const input = payload(owner);
    input.documentSignatures[0].coachDocumentId = stranger.document!.id;
    expect(await submitIntakePacket(input)).toMatchObject({ success: false });
    expect(await db.documentSignature.count({ where: { intakePacketDocumentId: owner.packetDocument!.id } })).toBe(0);
  });

  it("refuses empty signatures", async () => {
    const fixture = await packetFixture(true);
    const input = payload(fixture);
    input.documentSignatures[0].signatureValue = "   ";
    expect(await submitIntakePacket(input)).toMatchObject({ success: false });
  });

  it("refuses missing required answers before completing a packet", async () => {
    const fixture = await packetFixture();
    expect(await submitIntakePacket({ ...payload(fixture), answers: {} })).toMatchObject({ success: false });
    expect((await db.intakePacket.findUniqueOrThrow({ where: { id: fixture.packet.id } })).submittedAt).toBeNull();
  });

  it.each(["ACTIVE", "DECLINED"] as const)("never rewinds a %s lead when an old packet is submitted", async stage => {
    const fixture = await packetFixture();
    await db.coachingRequest.update({ where: { id: fixture.lead.id }, data: { consultationStage: stage }, select: { id: true } });
    await submitIntakePacket(payload(fixture));
    expect((await db.coachingRequest.findUniqueOrThrow({ where: { id: fixture.lead.id }, select: { consultationStage: true } })).consultationStage).toBe(stage);
  });

  it("allows only one winner for concurrent token submissions", async () => {
    const fixture = await packetFixture();
    const results = await Promise.all([submitIntakePacket(payload(fixture)), submitIntakePacket({ ...payload(fixture), answers: { goal: "Second submission" } })]);
    expect(results.filter(result => result.success)).toHaveLength(1);
  });

  it("refuses expired tokens", async () => {
    const fixture = await packetFixture();
    await db.intakePacket.update({ where: { id: fixture.packet.id }, data: { tokenExpiresAt: new Date(0) } });
    expect(await submitIntakePacket(payload(fixture))).toMatchObject({ success: false });
  });

  it("accepts a complete packet and refuses a replay", async () => {
    const fixture = await packetFixture(true);
    expect(await submitIntakePacket(payload(fixture))).toEqual({ success: true });
    expect(await submitIntakePacket(payload(fixture))).toMatchObject({ success: false });
  });

  it("refuses intake for a deactivated coach", async () => {
    const fixture = await packetFixture();
    await db.user.update({ where: { id: fixture.coach.id }, data: { isDeactivated: true } });
    expect(await submitIntakePacket(payload(fixture))).toMatchObject({ success: false });
  });

  it("refuses an empty legacy questionnaire instead of bypassing required questions", async () => {
    const { client, form } = await questionnaire();
    expect(await submitQuestionnaire({ formId: form.id, answers: [] })).toMatchObject({ success: false });
    expect(await db.onboardingResponse.count({ where: { clientId: client.id } })).toBe(0);
  });

  it("refuses an inactive legacy questionnaire", async () => {
    const { form } = await questionnaire();
    await db.onboardingForm.update({ where: { id: form.id }, data: { isActive: false } });
    expect(await submitQuestionnaire({ formId: form.id, answers: [{ questionId: "goal", answer: "Build habits" }] })).toMatchObject({ success: false });
  });

  it("refuses a stale coach's legacy questionnaire even if its old relationship still exists", async () => {
    const { client, form } = await questionnaire();
    const currentCoach = await account(true);
    const currentLink = await db.coachClient.create({ data: { coachId: currentCoach.id, clientId: client.id }, select: { id: true } });
    await db.clientCoachingContext.update({ where: { clientId: client.id }, data: { activeCoachClientId: currentLink.id } });
    expect(await submitQuestionnaire({ formId: form.id, answers: [{ questionId: "goal", answer: "Build habits" }] })).toMatchObject({ success: false });
  });

  it("accepts valid legacy answers", async () => {
    const { form } = await questionnaire();
    expect(await submitQuestionnaire({ formId: form.id, answers: [{ questionId: "goal", answer: "Build habits" }] })).toMatchObject({ success: true });
  });

  it("can resend an invite for a signed-up prospect who has not joined the roster", async () => {
    const fixture = await packetFixture();
    const client = await account();
    state.user = fixture.coach;
    await db.coachingRequest.update({ where: { id: fixture.lead.id }, data: { status: "APPROVED", prospectId: client.id, prospectEmailAddr: client.email }, select: { id: true } });
    expect(await resendInvite(fixture.lead.id)).toMatchObject({ success: true });
    expect(await db.coachClient.count({ where: { coachId: fixture.coach.id, clientId: client.id } })).toBe(0);
    expect(await db.clientInvite.count({ where: { requestId: fixture.lead.id, status: "PENDING" } })).toBe(1);
  });

  it("does not approve a phone-only lead when no invite can be delivered", async () => {
    const fixture = await packetFixture();
    state.user = fixture.coach;
    await db.coachingRequest.update({ where: { id: fixture.lead.id }, data: { prospectEmail: "+15551234567", prospectEmailAddr: null, prospectId: null }, select: { id: true } });
    await expect(approveCoachingRequest(fixture.lead.id)).rejects.toThrow(/email/i);
    expect((await db.coachingRequest.findUniqueOrThrow({ where: { id: fixture.lead.id }, select: { status: true } })).status).toBe("PENDING");
  });

  it("never returns another coach's legacy onboarding answers", async () => {
    const { coach, client, form } = await questionnaire();
    await db.onboardingResponse.create({ data: { clientId: client.id, coachId: coach.id, formId: form.id, answers: [{ questionId: "goal", answer: "Private answer" }] } });
    const otherCoach = await account(true);
    expect(await getCoachQuestionnaireResponse(otherCoach.id, client.id)).toBeNull();
    expect(await getCoachQuestionnaireResponse(coach.id, client.id)).not.toBeNull();
  });

  it("uses the current coach's form rather than the first relationship", async () => {
    const { client } = await questionnaire();
    const currentCoach = await account(true);
    const link = await db.coachClient.create({ data: { coachId: currentCoach.id, clientId: client.id }, select: { id: true } });
    await db.clientCoachingContext.update({ where: { clientId: client.id }, data: { activeCoachClientId: link.id } });
    const form = await db.onboardingForm.create({ data: { coachId: currentCoach.id, questions: [] } });
    const provider = { origin: "HUMAN", resolutionRequired: false, coachId: currentCoach.id };
    expect(await getPendingClientQuestionnaire(client.id, provider)).toMatchObject({ id: form.id });
    expect(await getPendingClientQuestionnaire(client.id, { ...provider, resolutionRequired: true })).toBeNull();
    expect(await getPendingClientQuestionnaire(client.id, { ...provider, origin: "AI" })).toBeNull();
  });

  it("makes repeated legacy submissions idempotent without replacing answers", async () => {
    const { client, form } = await questionnaire();
    const input = { formId: form.id, answers: [{ questionId: "goal", answer: "Original" }] };
    expect(await submitQuestionnaire(input)).toMatchObject({ success: true });
    expect(await submitQuestionnaire({ ...input, answers: [{ questionId: "goal", answer: "Replacement" }] })).toMatchObject({ success: true });
    expect((await db.onboardingResponse.findUniqueOrThrow({ where: { clientId: client.id } })).answers).toEqual(input.answers);
  });

  it("finishes an uploaded file without a duplicate-signature failure", async () => {
    const fixture = await packetFixture(true);
    await db.coachDocument.update({ where: { id: fixture.document!.id }, data: { type: "FILE" } });
    const upload = new FormData();
    upload.set("token", fixture.packet.token);
    upload.set("intakePacketDocumentId", fixture.packetDocument!.id);
    upload.set("file", new File(["synthetic pdf"], "signed.pdf", { type: "application/pdf" }));
    expect(await uploadSignedDocument(upload)).toMatchObject({ success: true });
    const input = payload(fixture);
    input.documentSignatures[0].signatureValue = "FILE_UPLOADED:signed.pdf";
    expect(await submitIntakePacket(input)).toEqual({ success: true });
    expect(await removeSignedUpload({ token: fixture.packet.token, intakePacketDocumentId: fixture.packetDocument!.id })).toMatchObject({ success: false });
  });

  it("does not trust a forged file-upload marker", async () => {
    const fixture = await packetFixture(true);
    await db.coachDocument.update({ where: { id: fixture.document!.id }, data: { type: "FILE" } });
    const input = payload(fixture);
    input.documentSignatures[0].signatureValue = "FILE_UPLOADED:fake.pdf";
    expect(await submitIntakePacket(input)).toMatchObject({ success: false });
  });

  it("fails closed if a previously stored signature points at another coach's document", async () => {
    const fixture = await packetFixture(true);
    const stranger = await packetFixture(true);
    await db.documentSignature.create({ data: { intakePacketDocumentId: fixture.packetDocument!.id, coachDocumentId: stranger.document!.id, signatureType: "TYPED", signatureValue: "Corrupt historical signature" } });
    expect(await submitIntakePacket({ ...payload(fixture), documentSignatures: [] })).toMatchObject({ success: false });
  });

  it("refuses an upload when the packet is completed while storage is writing", async () => {
    const fixture = await packetFixture(true);
    await db.coachDocument.update({ where: { id: fixture.document!.id }, data: { type: "FILE" } });
    state.afterUpload = async () => { await db.intakePacket.update({ where: { id: fixture.packet.id }, data: { submittedAt: new Date() } }); };
    const upload = new FormData();
    upload.set("token", fixture.packet.token);
    upload.set("intakePacketDocumentId", fixture.packetDocument!.id);
    upload.set("file", new File(["synthetic pdf"], "signed.pdf", { type: "application/pdf" }));
    expect(await uploadSignedDocument(upload)).toMatchObject({ success: false });
    expect(await db.documentSignature.count({ where: { intakePacketDocumentId: fixture.packetDocument!.id } })).toBe(0);
    expect(await db.storageCleanupOutbox.count({ where: { storagePath: { startsWith: `signed-uploads/${fixture.packet.id}/` } } })).toBe(1);
  });

  it("serializes signatures so a concurrent replay is a refusal rather than a crash", async () => {
    const fixture = await packetFixture();
    const token = randomUUID();
    await db.coachingRequest.update({ where: { id: fixture.lead.id }, data: { formsToken: token, formsTokenExpiresAt: new Date(Date.now() + 86400000), consultationStage: "FORMS_SENT" }, select: { id: true } });
    await db.clientFormSubmission.create({ data: { coachingRequestId: fixture.lead.id, answers: {}, status: "SENT" } });
    const input = { token, signatureType: "TYPED" as const, signatureValue: "Synthetic prospect" };
    const results = await Promise.all([submitSignature(input), submitSignature(input)]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(await db.clientFormSignature.count({ where: { coachingRequestId: fixture.lead.id } })).toBe(1);
    expect((await db.clientFormSubmission.findUniqueOrThrow({ where: { coachingRequestId: fixture.lead.id } })).status).toBe("SIGNED");
  });

  it("rolls back a signature if advancing the lead fails, allowing a clean retry", async () => {
    const fixture = await packetFixture();
    const token = randomUUID();
    await db.coachingRequest.update({ where: { id: fixture.lead.id }, data: { formsToken: token, formsTokenExpiresAt: new Date(Date.now() + 86400000), consultationStage: "FORMS_SENT" }, select: { id: true } });
    await db.clientFormSubmission.create({ data: { coachingRequestId: fixture.lead.id, answers: {}, status: "SENT" } });
    const client = (globalThis as unknown as { prisma: typeof db }).prisma;
    const realTransaction = client.$transaction.bind(client);
    const transaction = vi.spyOn(client, "$transaction").mockImplementationOnce((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => realTransaction(async tx => {
      const wrapped = new Proxy(tx, { get(target, property) {
        if (property !== "coachingRequest") return Reflect.get(target, property);
        return new Proxy(tx.coachingRequest, { get(delegate, method) {
          if (method === "update") return () => Promise.reject(new Error("Synthetic stage failure"));
          return Reflect.get(delegate, method);
        } });
      } });
      return work(wrapped);
    })) as typeof db.$transaction);
    const input = { token, signatureType: "TYPED" as const, signatureValue: "Synthetic prospect" };
    try {
      expect(await submitSignature(input)).toMatchObject({ success: false });
    } finally {
      transaction.mockRestore();
    }
    expect(await db.clientFormSignature.count({ where: { coachingRequestId: fixture.lead.id } })).toBe(0);
    expect((await db.coachingRequest.findUniqueOrThrow({ where: { id: fixture.lead.id }, select: { consultationStage: true } })).consultationStage).toBe("FORMS_SENT");
    expect(await submitSignature(input)).toMatchObject({ success: true });
  });

  it("renews an expired pending direct invite instead of blocking the coach forever", async () => {
    const coach = await account(true);
    const client = await account();
    state.user = coach;
    const old = await db.clientInvite.create({ data: { coachId: coach.id, email: client.email, name: "Synthetic client", expiresAt: new Date(0) } });
    expect(await sendClientInvite({ name: "Synthetic client", email: client.email })).toMatchObject({ success: true, emailSent: true });
    const renewed = await db.clientInvite.findUniqueOrThrow({ where: { id: old.id } });
    expect(renewed.inviteToken).not.toBe(old.inviteToken);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await acceptClientInviteForUser(old, client)).toMatchObject({ success: false });
    expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: client.id } })).toBe(0);
  });

  it("keeps a reusable private link when the email provider refuses delivery", async () => {
    const coach = await account(true);
    const client = await account();
    state.user = coach;
    state.emailSent = false;
    const first = await sendClientInvite({ name: "Synthetic client", email: client.email });
    expect(first).toMatchObject({ success: true, emailSent: false, inviteToken: expect.any(String) });
    state.emailSent = true;
    expect(await sendClientInvite({ name: "Synthetic client", email: client.email })).toMatchObject({ success: true, emailSent: true, inviteToken: "inviteToken" in first ? first.inviteToken : "missing" });
    expect(await db.clientInvite.count({ where: { coachId: coach.id, email: client.email, status: "PENDING" } })).toBe(1);
  });

  it("limits direct invite resends without creating duplicate invitations", async () => {
    const coach = await account(true);
    state.user = coach;
    const email = `${randomUUID()}@example.test`;
    for (let attempt = 0; attempt < 3; attempt++) expect(await sendClientInvite({ name: "Synthetic client", email })).toMatchObject({ success: true });
    expect(await sendClientInvite({ name: "Synthetic client", email })).toMatchObject({ error: expect.stringContaining("Too many") });
    expect(await db.clientInvite.count({ where: { coachId: coach.id, email } })).toBe(1);
  });
});
