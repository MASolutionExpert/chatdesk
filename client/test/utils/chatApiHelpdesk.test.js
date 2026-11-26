import { describe, test, expect, vi, afterEach } from "vitest";
import {
  fetchReferCandidates,
  referTicket,
  setTicketStatus,
} from "../../src/api/chatApi.js";

const originalFetch = globalThis.fetch;

// Regression guard for the dev.9/dev.10 referral outage: the helpdesk helpers
// must resolve to PARSED DATA, never to the raw fetch Response — the old
// versions returned the Response object itself, so `result.candidates` was
// always undefined and every install saw "no operators" in the referral
// picker. They must also THROW on HTTP errors with the server's message
// instead of silently pretending success.
describe("chatApi helpdesk helpers return parsed data and throw on HTTP errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  test("fetchReferCandidates resolves to parsed candidates + departments", async () => {
    const payload = {
      candidates: [
        { id: "22222222-2222-4222-b222-222222222222", username: "carol", inTicket: false },
      ],
      departments: [{ id: 7, name: "Billing", color: "#10b981", active: true }],
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    }));

    const result = await fetchReferCandidates({
      chatId: "aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa1",
      creator: "bob",
    });

    // The resolved value must be the parsed body — not a Response object.
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(result.candidates[0].username).toBe("carol");
    expect(Array.isArray(result.departments)).toBe(true);
    expect(result.departments[0].name).toBe("Billing");
  });

  test("fetchReferCandidates throws with the server message on 403", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "Only staff can refer tickets." }),
    }));

    await expect(
      fetchReferCandidates({
        chatId: "aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa1",
        creator: "alice",
      }),
    ).rejects.toThrow(/only staff/i);
  });

  test("referTicket throws with the server message on 409 (already a member)", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: "This operator is already a member of the ticket.",
      }),
    }));

    await expect(
      referTicket({
        chatId: "aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa1",
        creator: "bob",
        operatorUsername: "carol",
      }),
    ).rejects.toThrow(/already a member/i);
  });

  test("referTicket resolves to the parsed handoff result on success", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        chatId: "aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa1",
        converted: true,
        referredTo: { username: "carol" },
      }),
    }));

    const result = await referTicket({
      chatId: "aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa1",
      creator: "bob",
      operatorUsername: "carol",
    });
    expect(result.converted).toBe(true);
    expect(result.referredTo.username).toBe("carol");
  });

  test("setTicketStatus resolves to the parsed ticket status (not the HTTP status)", async () => {
    // The old version returned the raw Response, whose .status is the HTTP
    // code (200) — the caller then pushed "200" into the UI state instead of
    // "open"/"closed".
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        chatId: "aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa1",
        ticketId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        status: "closed",
        changed: true,
      }),
    }));

    const result = await setTicketStatus({
      chatId: "aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa1",
      action: "close",
      creator: "bob",
    });
    expect(result.status).toBe("closed");
    expect(result.changed).toBe(true);
  });

  test("setTicketStatus throws on 400 not_a_ticket", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "Not a support conversation." }),
    }));

    await expect(
      setTicketStatus({
        chatId: "aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa1",
        action: "close",
        creator: "bob",
      }),
    ).rejects.toThrow(/not a support conversation/i);
  });
});
