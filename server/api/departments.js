/**
 * Helpdesk endpoints: department discovery + fair-routed support requests.
 *
 * A support request creates (or reuses) a regular DM chat between the
 * customer and the fairly-selected operator, then tags it with the
 * department id — so the whole messenger stack (SSE, push, files, calls)
 * keeps working without any special casing.
 */
function registerDepartmentRoutes(app, deps) {
  const {
    requireSession,
    requireSessionUsernameMatch,
    listDepartments,
    getDepartmentById,
    pickOperatorForDepartment,
    findDmChat,
    createChat,
    addChatMember,
    createMessage,
    markChatDepartment,
    getChatDepartmentId,
    unhideChat,
    findUserByUsername,
    emitChatEvent,
    emitSseEvent,
    sendPushNotificationToUsers,
  } = deps;

  const awaitMaybe = async (value) => await value;

  // ─── Active departments for the picker UI ───────────────────────────────────
  app.get("/api/departments", async (req, res) => {
    const session = await requireSession(req, res);
    if (!session) return;
    const departments = await awaitMaybe(listDepartments({ activeOnly: true }));
    res.json({ departments });
  });

  // ─── Create / continue a support conversation ───────────────────────────────
  app.post("/api/support/request", async (req, res) => {
      const session = await requireSession(req, res);
      if (!session) return;

      const { departmentId, message, creator } = req.body || {};
      if (!departmentId) {
        return res.status(400).json({ error: "Department is required." });
      }
      if (!creator) {
        return res.status(400).json({ error: "Creator is required." });
      }
      if (!requireSessionUsernameMatch(res, session, creator)) return;

      const department = await awaitMaybe(getDepartmentById(departmentId));
      if (!department || !department.active) {
        return res.status(404).json({ error: "Department not found." });
      }

      const text = String(message || "").trim();
      if (!text) {
        return res.status(400).json({ error: "Message is required." });
      }
      if (text.length > 4000) {
        return res.status(400).json({ error: "Message is too long." });
      }

      const rawCustomer = findUserByUsername(String(creator).toLowerCase());
      const customer =
        rawCustomer && typeof rawCustomer.then === "function"
          ? await rawCustomer
          : rawCustomer;
      if (!customer) {
        return res.status(404).json({ error: "User not found." });
      }

      // Fair routing: fewest open conversations first, round-robin on ties.
      const operator = await awaitMaybe(
        pickOperatorForDepartment(department.id)
      );
      if (!operator) {
        return res.status(503).json({
          error:
            "No operator is available for this department right now. Please try again later.",
        });
      }

      // Reuse the existing DM between this customer and this operator when
      // the pair already has a support conversation (messenger-like threads).
      let chatId = await awaitMaybe(findDmChat(customer.id, operator.id));
      let reused = false;
      if (chatId) {
        const existingDept = await awaitMaybe(getChatDepartmentId(chatId));
        if (existingDept === null || existingDept === Number(department.id)) {
          reused = true;
          if (existingDept === null) {
            await awaitMaybe(markChatDepartment(chatId, department.id));
          }
          const u1 = await awaitMaybe(unhideChat(customer.id, chatId));
          const u2 = await awaitMaybe(unhideChat(operator.id, chatId));
        }
      }

      if (!reused) {
        const rawChatId = await awaitMaybe(createChat(null, "dm"));
        chatId = rawChatId;
        if (!chatId) {
          return res.status(500).json({ error: "Failed to create chat." });
        }
        await awaitMaybe(addChatMember(chatId, customer.id, "owner"));
        await awaitMaybe(addChatMember(chatId, operator.id, "member"));
        await awaitMaybe(markChatDepartment(chatId, department.id));
      }

      const messageId = await awaitMaybe(
        createMessage(chatId, customer.id, text)
      );

      // Realtime fan-out: message event for chat members + list change ping.
      await awaitMaybe(
        emitChatEvent(chatId, {
          type: "chat_message",
          chatId,
          messageId,
          username: customer.username,
          userId: customer.id,
          body: text,
        })
      );
      await awaitMaybe(
        emitSseEvent(operator.username, {
          type: "chat_list_changed",
          chatId,
        })
      );
      await awaitMaybe(
        emitSseEvent(customer.username, {
          type: "chat_list_changed",
          chatId,
        })
      );
      if (typeof sendPushNotificationToUsers === "function") {
        void (async () => {
          try {
            await awaitMaybe(
              sendPushNotificationToUsers([operator.username], {
                title: customer.nickname || customer.username,
                body: text.slice(0, 200) || "New support message",
                data: { chatId },
              })
            );
          } catch {
            // push is best-effort
          }
        })();
      }

      return res.status(201).json({
        chatId,
        operator: {
          username: operator.username,
          nickname: operator.nickname || operator.username,
          color: operator.color || null,
        },
        department: { id: department.id, name: department.name },
      });
    }
  );
}

export { registerDepartmentRoutes };
