// Stage 4 (LOW) security fixes — Task 4-a callManager tests:
//   5a. caller-busy: a caller already participating in an active call (any
//       chat) gets 409 caller_busy instead of starting an overlapping call.
//   5b. race: a simultaneous double-start of the same chat can no longer
//       overwrite the winner's active call (re-decision before
//       activeCalls.set), and same-caller redial still resumes the ring.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createCallManager } from "../lib/callManager.js";

const CHAT_A = "11111111-1111-4111-8111-111111111111";
const CHAT_B = "22222222-2222-4222-8222-222222222222";
const ALICE_ID = "a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4";
const BOB_ID = "b0b0b0b0-c1c1-4d2d-9e3e-f5f5f5f5f5f5";
const CAROL_ID = "c0c0c0c0-d1d1-4e2e-af3f-060606060606";

const users = {
  alice: { id: ALICE_ID, username: "alice", nickname: "Alice" },
  bob: { id: BOB_ID, username: "bob", nickname: "Bob" },
  carol: { id: CAROL_ID, username: "carol", nickname: "Carol" },
};

const userById = (id) =>
  users[Object.keys(users).find((k) => users[k].id === id)];

function baseDeps({ findUserByIdImpl } = {}) {
  return {
    isMember: vi.fn(() => true),
    findChatById: vi.fn((chatId) => ({ id: chatId, type: "dm" })),
    listChatMembers: vi.fn((chatId) =>
      chatId === CHAT_A
        ? [
            { id: ALICE_ID, username: "alice" },
            { id: BOB_ID, username: "bob" },
          ]
        : [
            { id: ALICE_ID, username: "alice" },
            { id: CAROL_ID, username: "carol" },
          ],
    ),
    findUserById: findUserByIdImpl || vi.fn(userById),
    emitToUser: vi.fn(),
    sendPushNotificationToUsers: vi.fn(),
    createCallMessage: vi.fn(() => "call-msg-id"),
    // Keep the test hermetic: no background sweep timer, no long ring timers.
    sweepIntervalMs: 0,
    ringTimeoutMs: 600000,
  };
}

describe("callManager caller-busy + start race (low4a)", () => {
  const managers = [];

  function freshManager(deps = {}) {
    const manager = createCallManager({ ...baseDeps(), ...deps });
    managers.push(manager);
    return manager;
  }

  afterEach(async () => {
    // Tear down any ring left up by a test so no timers leak.
    for (const manager of managers) {
      for (const chatId of [CHAT_A, CHAT_B]) {
        if (manager.getActiveCall(chatId)) {
          await manager.endCall({ user: users.alice, chatId });
        }
      }
      manager.cleanupUserCalls?.("alice");
      manager.cleanupUserCalls?.("bob");
      manager.cleanupUserCalls?.("carol");
    }
    managers.length = 0;
  });

  it("returns 409 caller_busy when the caller is already in another call", async () => {
    const manager = freshManager();
    const first = await manager.startCall({ user: users.alice, chatId: CHAT_A });
    expect(first.status).toBe(200);

    const second = await manager.startCall({ user: users.alice, chatId: CHAT_B });
    expect(second.status).toBe(409);
    expect(second.code).toBe("caller_busy");
    // The original call in CHAT_A is untouched.
    expect(manager.getActiveCall(CHAT_A)).toBe(first.call);
    expect(manager.getActiveCall(CHAT_B)).toBeUndefined();
  });

  it("returns 409 when a callee of a ringing call tries to start a call elsewhere", async () => {
    const manager = freshManager();
    const ring = await manager.startCall({ user: users.alice, chatId: CHAT_A });
    expect(ring.status).toBe(200);

    // bob is the callee of the ringing call in CHAT_A.
    const bobStart = await manager.startCall({ user: users.bob, chatId: CHAT_B });
    expect(bobStart.status).toBe(409);
    expect(["callee_busy", "caller_busy"]).toContain(bobStart.code);
    expect(manager.getActiveCall(CHAT_A)).toBe(ring.call);
    expect(manager.getActiveCall(CHAT_B)).toBeUndefined();
  });

  it("does NOT flag caller-busy for the same-chat redial resume path", async () => {
    const manager = freshManager();
    const first = await manager.startCall({ user: users.alice, chatId: CHAT_A });
    expect(first.status).toBe(200);

    const redial = await manager.startCall({ user: users.alice, chatId: CHAT_A });
    expect(redial.status).toBe(200);
    expect(redial.call).toBe(first.call);
    expect(redial.code).toBeUndefined();
  });

  it("simulated concurrent double-start: loser gets 409 and the winner's call is not overwritten", async () => {
    // Park BOTH startCall flows at findUserById so both pass the
    // "existing call?" check before either reaches activeCalls.set —
    // exactly the await-window race from the review.
    const gates = [];
    const manager = freshManager(
      baseDeps({
        findUserByIdImpl: vi.fn((id) => {
          if (gates.length < 2) {
            return new Promise((resolve) => gates.push({ id, resolve }));
          }
          return userById(id);
        }),
      }),
    );

    const p1 = manager.startCall({ user: users.alice, chatId: CHAT_A });
    const p2 = manager.startCall({ user: users.alice, chatId: CHAT_A });
    await new Promise((r) => setTimeout(r, 0)); // let both flows park at findUserById
    expect(gates.length).toBe(2);

    // Winner finishes first and installs its ring.
    gates[0].resolve(users.bob);
    const r1 = await p1;
    expect(r1.status).toBe(200);
    const winnerCall = r1.call;

    // The loser resumes only after the winner's call is live: it must be
    // rejected (callee-busy / existing-call decision), never overwrite.
    gates[1].resolve(users.bob);
    const r2 = await p2;
    expect(r2.status).toBe(409);
    expect(r2.call).toBeUndefined();
    expect(["callee_busy", "caller_busy"]).toContain(r2.code);

    // Exactly one active call, and it is the winner's.
    expect(manager.getActiveCall(CHAT_A)).toBe(winnerCall);
    expect(winnerCall.callerUsername).toBe("alice");
  });

  it("simulated both-sides double-start: second side gets 409, no overwrite", async () => {
    // Alice and bob both press "call" in the same DM at the same time.
    const gates = [];
    const manager = freshManager(
      baseDeps({
        findUserByIdImpl: vi.fn((id) => {
          if (gates.length < 2) {
            return new Promise((resolve) => gates.push({ id, resolve }));
          }
          return userById(id);
        }),
      }),
    );

    const pAlice = manager.startCall({ user: users.alice, chatId: CHAT_A });
    const pBob = manager.startCall({ user: users.bob, chatId: CHAT_A });
    await new Promise((r) => setTimeout(r, 0)); // let both flows park at findUserById
    expect(gates.length).toBe(2);

    gates[0].resolve(users.bob); // alice's callee
    const rAlice = await pAlice;
    expect(rAlice.status).toBe(200);
    const winnerCall = rAlice.call;

    gates[1].resolve(users.alice); // bob's callee (alice)
    const rBob = await pBob;
    expect(rBob.status).toBe(409);
    expect(rBob.call).toBeUndefined();

    // The active call is still alice's ring (caller alice), not bob's.
    const active = manager.getActiveCall(CHAT_A);
    expect(active).toBe(winnerCall);
    expect(active.callerUsername).toBe("alice");
  });
});
