import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "crypto";

const mocks = vi.hoisted(() => ({ authUserId: "" }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

import { NextRequest } from "next/server";
import {
  publishTrainingProgram,
  saveTrainingProgram,
} from "@/app/actions/training-programs";
import {
  POST as createTrainingDraft,
  PUT as updateTrainingDraft,
} from "@/app/api/coach/clients/[clientId]/training/route";
import { POST as publishTrainingRest } from "@/app/api/coach/clients/[clientId]/training/publish/route";
import { GET as getCurrentTraining } from "@/app/api/client/training/current/route";
import { GET as exportTrainingProgram } from "@/app/api/training-programs/[programId]/export/route";
import { POST as importWorkout } from "@/app/api/workout-import/import/route";
import { db } from "@/lib/db";
import {
  getLatestPublishedTrainingProgramForCoach,
  getPublishedTrainingProgram,
  getTrainingProgramForReview,
} from "@/lib/queries/training-programs";

const enabled = process.env.SECURITY_INTEGRATION === "1";

if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/steadfast_security_test"
  ) {
    throw new Error("Dedicated local test database required");
  }
}

const suite = enabled ? describe : describe.skip;

suite("T-952b training-program publish supersede", () => {
  const createdUserIds: string[] = [];
  const createdClientIds: string[] = [];
  const createdCoachIds: string[] = [];

  beforeAll(async () => {
    // Production already has this enum value. The dedicated local test DB must
    // mirror that state even if it was last synced from deployed schema.prisma.
    await db.$executeRawUnsafe(
      `ALTER TYPE "TrainingProgramStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED'`
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await db.trainingProgram.deleteMany({
      where: { clientId: { in: createdClientIds } },
    });
    await db.workoutImport.deleteMany({
      where: { coachId: { in: createdCoachIds } },
    });
    await db.coachClient.deleteMany({
      where: {
        OR: [
          { coachId: { in: createdUserIds } },
          { clientId: { in: createdUserIds } },
        ],
      },
    });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await db.$disconnect();
  });

  async function fixture() {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({
      data: {
        clerkId: coachClerkId,
        email: `coach-${coachClerkId}@example.test`,
        firstName: "Coach",
        isCoach: true,
        activeRole: "COACH",
      },
    });
    const clientClerkId = randomUUID();
    const client = await db.user.create({
      data: {
        clerkId: clientClerkId,
        email: `client-${clientClerkId}@example.test`,
        firstName: "Client",
        isClient: true,
        activeRole: "CLIENT",
      },
    });
    await db.coachClient.create({
      data: { coachId: coach.id, clientId: client.id },
    });
    createdUserIds.push(coach.id, client.id);
    createdClientIds.push(client.id);
    createdCoachIds.push(coach.id);
    mocks.authUserId = coach.clerkId;
    return { coach, client };
  }

  async function createProgram(args: {
    clientId: string;
    weekOf: Date;
    status?: "DRAFT" | "PUBLISHED";
    dayName?: string;
  }) {
    return db.trainingProgram.create({
      data: {
        clientId: args.clientId,
        weekOf: args.weekOf,
        status: args.status ?? "DRAFT",
        publishedAt: args.status === "PUBLISHED" ? new Date() : null,
        days: {
          create: {
            dayName: args.dayName ?? "Day 1",
            sortOrder: 0,
            blocks: {
              create: {
                type: "EXERCISE",
                title: "Squat",
                content: "5x5",
                sortOrder: 0,
              },
            },
          },
        },
      },
    });
  }

  async function expectPublishedState(args: {
    clientId: string;
    supersededIds: string[];
    publishedId: string;
  }) {
    const programs = await db.trainingProgram.findMany({
      where: { clientId: args.clientId },
      select: { id: true, status: true },
    });

    for (const supersededId of args.supersededIds) {
      expect(programs).toContainEqual({
        id: supersededId,
        status: "SUPERSEDED",
      });
    }
    expect(programs).toContainEqual({
      id: args.publishedId,
      status: "PUBLISHED",
    });
    expect(programs.filter((program) => program.status === "PUBLISHED")).toEqual([
      { id: args.publishedId, status: "PUBLISHED" },
    ]);
  }

  async function supersededFixture(args?: {
    previousWeek?: Date;
    replacementWeek?: Date;
  }) {
    const { coach, client } = await fixture();
    const previous = await createProgram({
      clientId: client.id,
      weekOf:
        args?.previousWeek ?? new Date("2026-10-05T00:00:00.000Z"),
      status: "PUBLISHED",
      dayName: "Previous",
    });
    const replacement = await createProgram({
      clientId: client.id,
      weekOf:
        args?.replacementWeek ?? new Date("2026-10-12T00:00:00.000Z"),
      dayName: "Replacement",
    });

    await expect(
      publishTrainingProgram({ programId: replacement.id })
    ).resolves.toEqual({ success: true });
    await expectPublishedState({
      clientId: client.id,
      supersededIds: [previous.id],
      publishedId: replacement.id,
    });
    return { coach, client, previous, replacement };
  }

  const params = (clientId: string) => ({
    params: Promise.resolve({ clientId }),
  });

  function publishRequest(clientId: string, programId: string) {
    return new NextRequest(
      `https://example.test/api/coach/clients/${clientId}/training/publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId }),
      }
    );
  }

  async function createWorkoutImportDraft(coachId: string, clientId: string) {
    const workoutImport = await db.workoutImport.create({
      data: {
        coachId,
        clientId,
        status: "NEEDS_REVIEW",
        draft: {
          create: {
            parsedJson: {
              name: "Imported program",
              notes: "Import fixture",
              days: [],
            },
          },
        },
      },
      select: { draft: { select: { id: true } } },
    });
    if (!workoutImport.draft) throw new Error("Workout import draft missing");
    return workoutImport.draft.id;
  }

  function importRequest(args: {
    draftId: string;
    clientId: string;
    dayName: string;
  }) {
    return new NextRequest("https://example.test/api/workout-import/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draftId: args.draftId,
        saveAsTemplate: false,
        clientId: args.clientId,
        publish: true,
        parsedJson: {
          name: "Imported program",
          notes: "Import fixture",
          days: [
            {
              dayName: args.dayName,
              blocks: [
                { type: "EXERCISE", title: "Deadlift", content: "3x5" },
              ],
            },
          ],
        },
      }),
    });
  }

  it("server action supersedes the client's published program across weeks", async () => {
    await supersededFixture();
  });

  it("REST publish uses the same client-only supersede behavior", async () => {
    const { client } = await fixture();
    const previous = await createProgram({
      clientId: client.id,
      weekOf: new Date("2026-10-19T00:00:00.000Z"),
      status: "PUBLISHED",
    });
    const replacement = await createProgram({
      clientId: client.id,
      weekOf: new Date("2026-10-26T00:00:00.000Z"),
    });

    const response = await publishTrainingRest(
      publishRequest(client.id, replacement.id),
      params(client.id)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    await expectPublishedState({
      clientId: client.id,
      supersededIds: [previous.id],
      publishedId: replacement.id,
    });
  });

  it("workout import publish supersedes through the shared service on repeated imports", async () => {
    const { coach, client } = await fixture();
    const previous = await createProgram({
      clientId: client.id,
      weekOf: new Date("2026-08-31T00:00:00.000Z"),
      status: "PUBLISHED",
    });

    const firstDraftId = await createWorkoutImportDraft(coach.id, client.id);
    const firstResponse = await importWorkout(
      importRequest({
        draftId: firstDraftId,
        clientId: client.id,
        dayName: "Imported one",
      })
    );
    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json();

    const secondDraftId = await createWorkoutImportDraft(coach.id, client.id);
    const secondResponse = await importWorkout(
      importRequest({
        draftId: secondDraftId,
        clientId: client.id,
        dayName: "Imported two",
      })
    );
    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json();

    await expectPublishedState({
      clientId: client.id,
      supersededIds: [previous.id, firstBody.programId],
      publishedId: secondBody.programId,
    });
  });

  it("client current-training read stays available after a supersede", async () => {
    const { client, replacement } = await supersededFixture();
    mocks.authUserId = client.clerkId;

    const response = await getCurrentTraining();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.trainingProgram.id).toBe(replacement.id);
    expect(body.trainingProgram.status).toBe("PUBLISHED");
  });

  it("server-action save and publish-target reads accept a superseded row", async () => {
    const { client, previous } = await supersededFixture();

    await expect(
      publishTrainingProgram({ programId: previous.id })
    ).resolves.toEqual({
      success: false,
      message: "Can only publish drafts",
    });

    await expect(
      saveTrainingProgram({
        clientId: client.id,
        weekStartDate: "2026-10-05",
        days: [{ dayName: "Forked draft", blocks: [] }],
      })
    ).resolves.toEqual({ programId: expect.any(String) });
  });

  it("PDF export loads a just-superseded program", async () => {
    const { previous } = await supersededFixture();

    const response = await exportTrainingProgram(
      new NextRequest(
        `https://example.test/api/training-programs/${previous.id}/export`
      ),
      { params: Promise.resolve({ programId: previous.id }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("coach create and update routes read correctly with a superseded program", async () => {
    const { client, previous } = await supersededFixture();

    const createResponse = await createTrainingDraft(
      new NextRequest(
        `https://example.test/api/coach/clients/${client.id}/training`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            weekOf: "2026-11-02",
            copyFromPublished: true,
          }),
        }
      ),
      params(client.id)
    );
    expect(createResponse.status).toBe(201);

    const updateResponse = await updateTrainingDraft(
      new NextRequest(
        `https://example.test/api/coach/clients/${client.id}/training`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            programId: previous.id,
            days: [{ dayName: "Forked", sortOrder: 0, blocks: [] }],
          }),
        }
      ),
      params(client.id)
    );
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toEqual({
      success: true,
      forkedNewProgramId: expect.any(String),
    });
  });

  it("REST publish reads a superseded target and returns a structured 409", async () => {
    const { client, previous } = await supersededFixture();

    const response = await publishTrainingRest(
      publishRequest(client.id, previous.id),
      params(client.id)
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Can only publish drafts",
      code: "PLAN_NOT_DRAFT",
    });
  });

  it("T-803 review and carry-over queries choose the current published program", async () => {
    const replacementWeek = new Date("2026-10-12T00:00:00.000Z");
    const { client, replacement } = await supersededFixture({ replacementWeek });

    const sameWeek = await getTrainingProgramForReview(
      client.id,
      replacementWeek
    );
    expect(sameWeek.source).toBe("published");
    expect(sameWeek.program?.id).toBe(replacement.id);

    const carriedOver = await getTrainingProgramForReview(
      client.id,
      new Date("2026-10-19T00:00:00.000Z")
    );
    expect(carriedOver.source).toBe("carried-over");
    expect(carriedOver.program?.id).toBe(replacement.id);
    expect(carriedOver.carriedOverFrom).toEqual(replacementWeek);

    await expect(
      getLatestPublishedTrainingProgramForCoach(client.id)
    ).resolves.toMatchObject({ id: replacement.id, status: "PUBLISHED" });
    await expect(getPublishedTrainingProgram(client.id)).resolves.toMatchObject({
      id: replacement.id,
      status: "PUBLISHED",
    });
  });
});
