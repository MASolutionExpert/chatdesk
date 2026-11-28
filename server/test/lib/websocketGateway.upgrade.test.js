import { describe, test, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createWebSocketGateway } from "../../lib/websocketGateway.js";

// Regression: an unauthenticated WS upgrade with a malformed cookie
// (`Cookie: sid=%E0`) used to throw an uncaught URIError inside the server's
// "upgrade" listener and kill the whole process. The handler must contain the
// error and destroy the socket instead.
describe("WebSocket Gateway — upgrade hardening", () => {
  function fakeSocket() {
    return {
      destroyed: false,
      destroy: vi.fn(function destroy() {
        this.destroyed = true;
      }),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      remoteAddress: "127.0.0.1",
    };
  }

  function gatewayWithServer(sessionByToken = {}) {
    const server = new EventEmitter();
    const gateway = createWebSocketGateway({
      server,
      getSessionFromToken: (token) => sessionByToken[token] ?? null,
    });
    return { server, gateway };
  }

  test("malformed percent-escape in sid cookie does not crash the process", () => {
    const { server, gateway } = gatewayWithServer();
    const socket = fakeSocket();

    // Pre-fix, the URIError from decodeURIComponent propagated out of the
    // emit call itself (uncaught listener error -> process exit).
    expect(() => {
      server.emit("upgrade", {
        url: "/ws",
        headers: { cookie: "sid=%E0" },
      }, socket, Buffer.alloc(0));
    }).not.toThrow();

    gateway.close();
  });

  test("unparseable URL also cannot crash the process", () => {
    const { server, gateway } = gatewayWithServer();
    const socket = fakeSocket();

    expect(() => {
      server.emit("upgrade", {
        url: "http://[::1", // malformed Host/URL component
        headers: {},
      }, socket, Buffer.alloc(0));
    }).not.toThrow();

    expect(socket.destroy).toHaveBeenCalled();
    gateway.close();
  });

  test("valid sid cookie still authenticates the upgrade without crashing", () => {
    const session = { id: "u-1", username: "alice" };
    const { server, gateway } = gatewayWithServer({ "good-token": session });
    const socket = fakeSocket();

    expect(() => {
      server.emit("upgrade", {
        url: "/ws",
        headers: { cookie: "sid=good-token; other=1" },
      }, socket, Buffer.alloc(0));
    }).not.toThrow();

    gateway.close();
  });
});
