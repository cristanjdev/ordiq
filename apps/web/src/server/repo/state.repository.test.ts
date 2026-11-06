import { describe, expect, it } from "vitest";
import {
  createEmptyMasterDataState,
  facultyAvailabilityKey,
  type FacultyRecord,
  type MasterDataState,
} from "../modules/master-data/master-data.store";
import { applyChanges, diffState, takeSnapshot } from "./state.repository";

function faculty(code: string, name = "Prof. Test"): FacultyRecord {
  return {
    id: `id-${code}`,
    code,
    alias: `ALIAS-${code.slice(-3)}`,
    name,
    programCode: null,
    employmentType: "FULL_TIME_PERMANENT",
    specialization: "Structures",
    education: "MS",
    maxLoadUnits: 21,
    maxLoadHours: 24,
    status: "ACTIVE",
  };
}

function seeded(): MasterDataState {
  const state = createEmptyMasterDataState();
  state.faculty.set("FAC-001", faculty("FAC-001"));
  state.conversations.set("c1", {
    id: "c1",
    termCode: "AY2026-2027-S1",
    title: "t",
    messages: [],
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  });
  return state;
}

describe("state repository change detection", () => {
  it("reports nothing when the state matches the snapshot", () => {
    const state = seeded();
    const changes = diffState(takeSnapshot(state), state, state.aliasCounter);
    expect(changes.count).toBe(0);
  });

  it("detects inserts, Map.set replacements and deletions", () => {
    const state = seeded();
    const snapshot = takeSnapshot(state);
    state.faculty.set("FAC-001", { ...faculty("FAC-001"), name: "Prof. Renamed" });
    state.faculty.set("FAC-002", faculty("FAC-002"));
    state.conversations.delete("c1");

    const changes = diffState(snapshot, state, state.aliasCounter);
    expect(changes.upserts.get("faculty")?.map((c) => c.key).sort()).toEqual([
      "FAC-001",
      "FAC-002",
    ]);
    expect(changes.deletes.get("conversations")).toEqual(["c1"]);
    expect(changes.count).toBe(3);
  });

  it("detects in-place mutation of nested arrays", () => {
    const state = seeded();
    const snapshot = takeSnapshot(state);
    state.conversations.get("c1")?.messages.push({
      id: "m1",
      conversationId: "c1",
      role: "user",
      content: "hello",
      parts: [],
      createdAt: "2026-11-02T00:00:01.000Z",
    });
    const changes = diffState(snapshot, state, state.aliasCounter);
    expect(changes.upserts.get("conversations")).toHaveLength(1);
  });

  it("treats a changed Map key as a change (natural keys are stored)", () => {
    const state = seeded();
    const record = {
      id: "av-1",
      facultyCode: "FAC-001",
      termCode: "AY2026-2027-S1",
      weekday: "MONDAY" as const,
      startMin: 480,
      endMin: 600,
      status: "AVAILABLE" as const,
      reason: "",
    };
    state.facultyAvailability.set(facultyAvailabilityKey(record), record);
    const snapshot = takeSnapshot(state);
    state.facultyAvailability.delete(facultyAvailabilityKey(record));
    state.facultyAvailability.set("custom-key", record);
    expect(diffState(snapshot, state, state.aliasCounter).count).toBe(1);
  });

  it("counts an alias counter change as a change", () => {
    const state = seeded();
    const snapshot = takeSnapshot(state);
    state.aliasCounter += 1;
    expect(diffState(snapshot, state, 0).count).toBe(1);
  });
});

describe("state repository save ordering", () => {
  it("deletes children before parents and upserts parents before children", async () => {
    const state = seeded();
    state.sections.set("CE-1A", {
      id: "sec-1",
      code: "CE-1A",
      programCode: "CE",
      yearLevel: 1,
      studentCount: 38,
    });
    const snapshot = takeSnapshot(state);
    state.programs.set("CE", { id: "p-1", code: "CE", name: "Civil", coordinator: "x" });
    state.conversations.delete("c1");
    state.schedules.set("s1", {
      id: "s1",
      termCode: "AY2026-2027-S1",
      candidateLabel: "A",
      status: "CANDIDATE",
      source: "GENERATED",
      recheckNeeded: false,
      version: 1,
      qualityScore: 90,
      entries: [
        {
          id: "ENT-1",
          offeringCode: "OFF-1",
          facultyCode: "FAC-001",
          roomCode: "R1",
          weekday: "MONDAY",
          startMin: 480,
          endMin: 570,
          pinned: false,
        },
      ],
    });

    const statements: string[] = [];
    const fakeDb = {
      $executeRawUnsafe: async (sql: string) => {
        statements.push(sql.replace(/\s+/g, " ").slice(0, 60));
        return 1;
      },
    };
    await applyChanges(fakeDb as never, diffState(snapshot, state, state.aliasCounter));

    const order = statements.map((s) => s.match(/"([a-z_]+)"/)?.[1]);
    expect(order).toEqual([
      "messages", // child of the deleted conversation goes first
      "conversations",
      "programs", // parent of sections upserted before schedules
      "schedules",
      "schedule_entries", // replaced: delete then insert
      "schedule_entries",
    ]);
    expect(statements[2]).toContain("INSERT INTO");
  });
});
