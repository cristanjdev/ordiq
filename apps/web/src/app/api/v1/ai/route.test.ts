import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Exercise the conversation actions independently of sign-in.
vi.mock("@/server/http/dean-route", () => ({
  withDeanRoute:
    (handler: (request: NextRequest, auth: { user: { username: string } }) => Promise<Response>) =>
    (request: NextRequest) =>
      handler(request, { user: { username: "dean" } }),
}));

import { getMasterDataState } from "../../../../server/modules/master-data/master-data.store";
import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/v1/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    undefined,
  );
}

function addConversation(id: string) {
  const state = getMasterDataState();
  state.conversations.set(id, {
    id,
    termCode: "AY2026-2027-S1",
    title: "Which classes are unscheduled?",
    messages: [],
    createdAt: "2026-11-01T08:00:00.000Z",
    updatedAt: "2026-11-01T08:05:00.000Z",
  });
  return state;
}

describe("AI conversation actions", () => {
  it("renames a conversation without moving it in the recent list", async () => {
    const state = addConversation("conv-rename");
    const res = await post({
      action: "rename_conversation",
      conversationId: "conv-rename",
      title: "  CHEM 113 coverage  ",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ conversation: { id: "conv-rename", title: "CHEM 113 coverage" } });
    const conv = state.conversations.get("conv-rename");
    expect(conv?.title).toBe("CHEM 113 coverage");
    expect(conv?.updatedAt).toBe("2026-11-01T08:05:00.000Z");
  });

  it("rejects an empty name", async () => {
    addConversation("conv-empty");
    const res = await post({ action: "rename_conversation", conversationId: "conv-empty", title: "   " });
    expect(res.status).toBe(422);
    expect(getMasterDataState().conversations.get("conv-empty")?.title).toBe("Which classes are unscheduled?");
  });

  it("reports a conversation that no longer exists", async () => {
    const res = await post({ action: "rename_conversation", conversationId: "missing", title: "Anything" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("deletes a conversation", async () => {
    const state = addConversation("conv-delete");
    const res = await post({ action: "delete_conversation", conversationId: "conv-delete" });
    expect(res.status).toBe(200);
    expect(state.conversations.has("conv-delete")).toBe(false);
  });
});
