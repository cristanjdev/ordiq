import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import * as facultyRoute from "@/app/api/v1/faculty/route";
import * as fixedBlocksRoute from "@/app/api/v1/fixed-blocks/route";
import * as importsRoute from "@/app/api/v1/imports/route";
import * as offeringsRoute from "@/app/api/v1/offerings/route";
import * as programsRoute from "@/app/api/v1/programs/route";
import * as readinessRoute from "@/app/api/v1/readiness/route";
import * as roomsRoute from "@/app/api/v1/rooms/route";
import * as sectionsRoute from "@/app/api/v1/sections/route";
import * as subjectsRoute from "@/app/api/v1/subjects/route";
import * as termsRoute from "@/app/api/v1/terms/route";
import {
  generateMediumCollegeFixture,
  generateSmallFixture,
  loadFixtureIntoStore,
} from "@/server/modules/fixtures/fixture.generator";
import {
  buildWorkbookBuffer,
  importWorkbookPayload,
  parseWorkbookBuffer,
} from "@/server/modules/imports/imports.service";
import {
  deleteFaculty,
  deleteProgram,
  deleteRoom,
  upsertFaculty,
  upsertProgram,
  upsertRoom,
  upsertSubject,
} from "@/server/modules/master-data/master-data.service";
import {
  getMasterDataState,
  resetMasterDataState,
} from "@/server/modules/master-data/master-data.store";
import { getTermReadinessReport } from "@/server/modules/readiness/readiness.service";
import {
  setAuditSinkForTests,
  type AuditInput,
  type AuditRecord,
} from "@/server/platform/audit";
import {
  createInMemoryAuthStore,
  generateCurrentTotpCode,
  loginStep1Password,
  loginStep2Totp,
  requireDeanSession,
  seedSingleDeanAccount,
  setAuthStore,
} from "@/server/platform/auth";
import { decryptSecret } from "@/server/platform/crypto";
import { resetEnvCacheForTests } from "@/server/platform/env";

describe("Phase 1: Secure Data Layer Exit Criteria", () => {
  let auditLogEntries: AuditRecord[] = [];

  beforeEach(() => {
    process.env.DATABASE_URL =
      "postgresql://ordiq:secret@localhost:5432/ordiq";
    process.env.AUTH_SECRET = "auth-secret-at-least-16-chars";
    process.env.APP_ENCRYPTION_KEY = "encryption-key-at-least-16-chars";
    process.env.ENGINE_URL = "http://localhost:8000";
    process.env.ENGINE_TOKEN = "shared-engine-token-123456";
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "gpt-4o-mini";
    process.env.LLM_API_KEY = "sk-test-key";
    process.env.LLM_MONTHLY_TOKEN_BUDGET = "500000";
    resetEnvCacheForTests();

    auditLogEntries = [];
    setAuditSinkForTests({
      async write(input: AuditInput): Promise<AuditRecord> {
        const record: AuditRecord = {
          id: crypto.randomUUID(),
          createdAt: new Date(),
          ...input,
        };
        auditLogEntries.push(record);
        return record;
      },
    });

    setAuthStore(createInMemoryAuthStore());
    resetMasterDataState();
  });

  it("Exit Criterion 1: An unauthenticated request to any data route returns 401, tested by iterating over all routes", async () => {
    const protectedRoutes: Array<{
      name: string;
      method: "GET" | "POST" | "DELETE";
      handler: (req: NextRequest, ctx: unknown) => Promise<Response>;
    }> = [
      { name: "GET /api/v1/terms", method: "GET", handler: termsRoute.GET },
      { name: "POST /api/v1/terms", method: "POST", handler: termsRoute.POST },
      {
        name: "GET /api/v1/programs",
        method: "GET",
        handler: programsRoute.GET,
      },
      {
        name: "POST /api/v1/programs",
        method: "POST",
        handler: programsRoute.POST,
      },
      {
        name: "DELETE /api/v1/programs",
        method: "DELETE",
        handler: programsRoute.DELETE,
      },
      {
        name: "GET /api/v1/faculty",
        method: "GET",
        handler: facultyRoute.GET,
      },
      {
        name: "POST /api/v1/faculty",
        method: "POST",
        handler: facultyRoute.POST,
      },
      {
        name: "DELETE /api/v1/faculty",
        method: "DELETE",
        handler: facultyRoute.DELETE,
      },
      {
        name: "GET /api/v1/subjects",
        method: "GET",
        handler: subjectsRoute.GET,
      },
      {
        name: "POST /api/v1/subjects",
        method: "POST",
        handler: subjectsRoute.POST,
      },
      {
        name: "DELETE /api/v1/subjects",
        method: "DELETE",
        handler: subjectsRoute.DELETE,
      },
      {
        name: "GET /api/v1/sections",
        method: "GET",
        handler: sectionsRoute.GET,
      },
      {
        name: "POST /api/v1/sections",
        method: "POST",
        handler: sectionsRoute.POST,
      },
      {
        name: "DELETE /api/v1/sections",
        method: "DELETE",
        handler: sectionsRoute.DELETE,
      },
      { name: "GET /api/v1/rooms", method: "GET", handler: roomsRoute.GET },
      { name: "POST /api/v1/rooms", method: "POST", handler: roomsRoute.POST },
      {
        name: "DELETE /api/v1/rooms",
        method: "DELETE",
        handler: roomsRoute.DELETE,
      },
      {
        name: "GET /api/v1/offerings",
        method: "GET",
        handler: offeringsRoute.GET,
      },
      {
        name: "POST /api/v1/offerings",
        method: "POST",
        handler: offeringsRoute.POST,
      },
      {
        name: "DELETE /api/v1/offerings",
        method: "DELETE",
        handler: offeringsRoute.DELETE,
      },
      {
        name: "GET /api/v1/fixed-blocks",
        method: "GET",
        handler: fixedBlocksRoute.GET,
      },
      {
        name: "POST /api/v1/fixed-blocks",
        method: "POST",
        handler: fixedBlocksRoute.POST,
      },
      {
        name: "POST /api/v1/imports",
        method: "POST",
        handler: importsRoute.POST,
      },
      {
        name: "GET /api/v1/readiness",
        method: "GET",
        handler: readinessRoute.GET,
      },
    ];

    for (const route of protectedRoutes) {
      const req = new NextRequest("http://localhost:3000/api/v1/test", {
        method: route.method,
        ...(route.method === "POST"
          ? {
              body: JSON.stringify({}),
              headers: { "Content-Type": "application/json" },
            }
          : {}),
      });
      const res = await route.handler(req, {});
      expect(res.status, `${route.name} must return 401`).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("UNAUTHORIZED");
    }
  });

  it("Exit Criterion 2 & 3: Login fails without TOTP, TOTP secret is encrypted at rest, recovery codes are single-use, lockout works, and second account creation is blocked", async () => {
    const { user } = await seedSingleDeanAccount({
      username: "dean",
      email: "dean.cet@mseuf.edu.ph",
      password: "CorrectHorseBatteryStaple!2026",
    });

    await expect(
      seedSingleDeanAccount({
        username: "coordinator",
        email: "coord@mseuf.edu.ph",
        password: "AnotherStrongPassword!2026",
      }),
    ).rejects.toMatchObject({ code: "DEAN_ACCOUNT_ALREADY_EXISTS" });

    const authApiDir = path.resolve(__dirname, "./auth");
    const entries = fs.readdirSync(authApiDir);
    expect(entries).not.toContain("signup");
    expect(entries).not.toContain("register");

    const step1 = await loginStep1Password({
      identifier: "dean",
      password: "CorrectHorseBatteryStaple!2026",
    });
    expect(step1.stage).toBe("ENROLL_TOTP");
    const secretBase32 = step1.totpEnrollment?.secretBase32 ?? "";
    expect(secretBase32.length).toBeGreaterThan(10);

    const preTotpRequest = new NextRequest(
      "http://localhost:3000/api/v1/faculty",
      {
        headers: { Authorization: `Bearer ${step1.sessionToken}` },
      },
    );
    await expect(requireDeanSession(preTotpRequest)).rejects.toMatchObject({
      code: "TOTP_REQUIRED",
      statusCode: 401,
    });

    await expect(
      loginStep2Totp({
        sessionToken: step1.sessionToken,
        code: "000000",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_TOTP_CODE",
      statusCode: 401,
    });

    const validTotp = generateCurrentTotpCode(secretBase32);
    const step2 = await loginStep2Totp({
      sessionToken: step1.sessionToken,
      code: validTotp,
    });
    expect(step2.stage).toBe("ACTIVE");
    const generatedCodes = step2.recoveryCodes ?? [];
    expect(generatedCodes).toHaveLength(8);

    // The password-only token is retired; only the rotated token is authenticated.
    expect(step2.sessionToken).not.toBe(step1.sessionToken);
    await expect(requireDeanSession(preTotpRequest)).rejects.toMatchObject({
      statusCode: 401,
    });
    const authedCtx = await requireDeanSession(
      new NextRequest("http://localhost:3000/api/v1/faculty", {
        headers: { Authorization: `Bearer ${step2.sessionToken}` },
      }),
    );
    expect(authedCtx.user.id).toBe(user.id);
    expect(
      decryptSecret(authedCtx.user.totpSecretEncrypted ?? ""),
    ).toBe(secretBase32);

    const recoveryCode = generatedCodes[0] ?? "";
    const secondLogin = await loginStep1Password({
      identifier: "dean",
      password: "CorrectHorseBatteryStaple!2026",
    });
    expect(secondLogin.stage).toBe("VERIFY_TOTP");
    await expect(
      loginStep2Totp({
        sessionToken: secondLogin.sessionToken,
        code: recoveryCode,
      }),
    ).resolves.toMatchObject({ stage: "ACTIVE" });

    const thirdLogin = await loginStep1Password({
      identifier: "dean",
      password: "CorrectHorseBatteryStaple!2026",
    });
    await expect(
      loginStep2Totp({
        sessionToken: thirdLogin.sessionToken,
        code: recoveryCode,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOTP_CODE" });

    // The rejected recovery code above already counts as failure 1 of 5:
    // password and second-factor failures share one lockout counter.
    for (let i = 0; i < 3; i++) {
      await expect(
        loginStep1Password({
          identifier: "dean",
          password: "wrong-password",
        }),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(
      loginStep1Password({
        identifier: "dean",
        password: "wrong-password",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED", statusCode: 429 });
  });

  it("Exit Criterion 4 & 5: A broken workbook produces row-level errors and writes nothing; valid workbook (.xlsx) imports cleanly and idempotently and writes template/fixtures to disk", async () => {
    const brokenResult = await importWorkbookPayload(
      {
        termCode: "AY2026-2027-S1",
        programs: [
          {
            code: "IE",
            name: "BS Industrial Engineering",
            coordinator: "Coord IE",
          },
        ],
        sections: [
          {
            code: "IE-1A",
            programCode: "UNKNOWN",
            yearLevel: 1,
            studentCount: 38,
          },
          {
            code: "IE-1B",
            programCode: "IE",
            yearLevel: 1,
            studentCount: 38,
            studentId: "2026-0001",
          },
        ],
      },
      { dryRun: false, actor: "dean" },
    );

    expect(brokenResult.status).toBe("FAILED");
    expect(brokenResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheet: "Sections",
          row: 2,
          column: "programCode",
        }),
        expect.objectContaining({
          sheet: "Sections",
          row: 3,
          column: "studentId",
        }),
      ]),
    );
    expect(getMasterDataState().programs.size).toBe(0);
    expect(getMasterDataState().sections.size).toBe(0);

    const small = generateSmallFixture();
    const medium = generateMediumCollegeFixture();
    const xlsxBuffer = await buildWorkbookBuffer({
      termCode: small.term.code,
      programs: small.programs,
      faculty: small.faculty,
      subjects: small.subjects,
      sections: small.sections,
      rooms: small.rooms,
      offerings: small.offerings,
      fixedBlocks: small.fixedBlocks,
      facultyAvailability: small.facultyAvailability,
      facultyQualifications: small.facultyQualifications,
      facultyPreferences: small.facultyPreferences,
      pastSchedule: small.pastSchedule,
    });

    // Persist templates/ordiq-data-gathering-workbook.xlsx, fixtures/small.json, and fixtures/medium.json
    const repoRoot = path.resolve(__dirname, "../../../../..");
    const templatesDir = path.join(repoRoot, "templates");
    const fixturesDir = path.join(repoRoot, "fixtures");
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(
      path.join(templatesDir, "ordiq-data-gathering-workbook.xlsx"),
      xlsxBuffer,
    );
    fs.writeFileSync(
      path.join(fixturesDir, "small.json"),
      JSON.stringify(small, null, 2) + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(fixturesDir, "medium.json"),
      JSON.stringify(medium, null, 2) + "\n",
      "utf8",
    );

    const parsedPayload = await parseWorkbookBuffer(
      xlsxBuffer,
      small.term.code,
    );
    const firstCommit = await importWorkbookPayload(parsedPayload, {
      dryRun: false,
      actor: "dean",
    });
    expect(firstCommit.errors).toEqual([]);
    expect(firstCommit.status).toBe("COMMITTED");
    expect(firstCommit.alreadyCommitted).toBe(false);
    expect(getMasterDataState().faculty.size).toBe(small.faculty.length);
    expect(getMasterDataState().schedules.size).toBe(1);

    const secondCommit = await importWorkbookPayload(parsedPayload, {
      dryRun: false,
      actor: "dean",
    });
    expect(secondCommit.status).toBe("COMMITTED");
    expect(secondCommit.alreadyCommitted).toBe(true);
  });

  it("Exit Criterion 6: No table in Prisma schema can hold individual student records", () => {
    const schemaPath = path.resolve(
      __dirname,
      "../../../../prisma/schema.prisma",
    );
    const schemaText = fs.readFileSync(schemaPath, "utf8");
    expect(schemaText).not.toMatch(/model\s+Student\b/i);
    expect(schemaText).not.toMatch(
      /student_name|student_number|student_email/i,
    );
    expect(schemaText).toContain('studentCount Int      @map("student_count")');
  });

  it("Exit Criterion 7 & Phase 1D: Every create, update, and delete appears in the audit log, master data changes flag recheckNeeded, and medium college fixture passes ISO/IEC 25012 readiness", async () => {
    const medium = generateMediumCollegeFixture();
    expect(medium.programs).toHaveLength(7);
    expect(medium.faculty).toHaveLength(44);
    const totalStudents = medium.sections.reduce(
      (sum: number, s) => sum + s.studentCount,
      0,
    );
    expect(totalStudents).toBe(903);

    await loadFixtureIntoStore(medium, { actor: "dean" });

    const readiness = getTermReadinessReport(medium.term.code);
    expect(readiness.canGenerate).toBe(true);
    expect(readiness.criticalCount).toBe(0);
    expect(readiness.iso25012Scores.overall).toBe(100);

    await upsertSubject(
      {
        code: "CE199",
        name: "Legacy Surveying",
        description: "Legacy course",
        programCode: "CE",
        yearLevel: 1,
        category: "MAJOR",
        units: 3,
        contactHours: 3,
        lectureHours: 3,
        labHours: 0,
        curriculumVersion: "2018",
        isCurrentCurriculum: false,
      },
      { actor: "dean" },
    );

    await upsertRoom(
      {
        code: "EN-LEC-01",
        name: "Engineering Lecture Room 201",
        type: "LECTURE",
        capacity: 20,
        equipment: ["Projector"],
        restrictions: "",
        status: "ACTIVE",
      },
      { actor: "dean" },
    );

    const schedules = Array.from(getMasterDataState().schedules.values());
    expect(schedules[0]?.recheckNeeded).toBe(true);

    auditLogEntries = [];
    await upsertProgram(
      { code: "TEST", name: "BS Test Engineering", coordinator: "Coord Test" },
      { actor: "dean" },
    );
    await upsertProgram(
      {
        code: "TEST",
        name: "BS Test Engineering Updated",
        coordinator: "Coord Test",
      },
      { actor: "dean" },
    );
    await deleteProgram("TEST", { actor: "dean" });

    await upsertFaculty(
      {
        code: "FAC-999",
        name: "Engr. Test Faculty",
        programCode: "CE",
        employmentType: "FULL_TIME_PERMANENT",
        specialization: "Structures",
        education: "MS CE",
        maxLoadUnits: 21,
        maxLoadHours: 24,
        status: "ACTIVE",
      },
      { actor: "dean" },
    );
    await deleteFaculty("FAC-999", { actor: "dean" });

    await deleteRoom("EN-LEC-10", { actor: "dean" });

    expect(auditLogEntries.map((e) => e.action)).toEqual([
      "PROGRAM_CREATED",
      "PROGRAM_UPDATED",
      "PROGRAM_DELETED",
      "FACULTY_CREATED",
      "FACULTY_DELETED",
      "ROOM_DELETED",
    ]);
  });
});

