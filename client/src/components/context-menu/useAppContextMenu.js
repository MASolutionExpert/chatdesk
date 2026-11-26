import { useCallback, useState } from "react";
import {
  Ban,
  Chat,
  CheckCheck,
  Copy,
  Download,
  Forward,
  Pencil,
  Reply,
  Trash,
  User,
  Volume2,
  VolumeX,
} from "../../icons/lucide.js";
import { copyTextToClipboard } from "../../utils/clipboard.js";
import {
  extractMessageBodyText,
  getMessageFiles,
  hasMessageText,
  isCallLogBody,
} from "../../utils/messageContent.js";
import { useI18n } from "../../i18n/index.js";

export function useAppContextMenu({
  activeChatId,
  chats,
  currentUsername,
  canCurrentUserEditGroup,
  canReplyToMessage,
  canEditMessage,
  canDeleteMessageForEveryone,
  // Only moderators (owner/admin/operator) may delete messages at all;
  // regular users never see the delete entry.
  canDeleteMessages = true,
  // Optional predicate (chat) => boolean; returning false hides the
  // thread-delete entry (e.g. regular users cannot delete support threads).
  canDeleteChatThread = null,
  onReplyToMessage,
  onEditMessage,
  onDeleteMessage,
  onForwardMessage,
  onSaveMessageFiles,
  onOpenOrCreateDm,
  onOpenProfile,
  onRemoveGroupMember,
  onMarkChatSeen,
  onToggleChatMute,
  onDeleteChats,
  isOffline: isOfflineProp = false,
  sseConnected = true,
}) {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState(null);

  const findContextMenuLinkTarget = useCallback((eventTarget, targetEl) => {
    const eventNode =
      eventTarget instanceof Element ? eventTarget : eventTarget?.parentElement || null;
    if (!eventNode || !targetEl || !targetEl.contains(eventNode)) return null;
    const anchor = eventNode.closest("a[href]");
    if (!anchor || !targetEl.contains(anchor)) return null;
    const href = String(anchor.href || anchor.getAttribute("href") || "").trim();
    if (!href) return null;
    return href;
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const findExistingDmWithUser = useCallback(
    (username) => {
      const targetUsername = String(username || "").toLowerCase();
      if (!targetUsername) return null;
      return (
        chats.find((chat) => {
          if (chat?.type !== "dm") return false;
          return (chat.members || []).some(
            (member) =>
              String(member?.username || "").toLowerCase() === targetUsername,
          );
        }) || null
      );
    },
    [chats],
  );

  const handleMarkChatSeen = useCallback(
    async (chat) => {
      const chatId = chat?.id || null;
      if (!chatId) return;
      await onMarkChatSeen?.(chat, {
        activeChatId,
      });
    },
    [activeChatId, onMarkChatSeen],
  );

  const openContextMenu = useCallback(
    ({ kind, data, targetEl, event }) => {
      const rect = targetEl?.getBoundingClientRect?.() || null;
      const point = {
        x: Number(event?.clientX || rect?.left || 0),
        y: Number(event?.clientY || rect?.bottom || rect?.top || 0),
      };
      const items = [];

      if (kind === "message") {
        const message = data?.message || null;
        const offline =
          data?.isOffline ??
          (isOfflineProp ||
            sseConnected === false ||
            (typeof navigator !== "undefined" && navigator.onLine === false));
        const hasText = hasMessageText(message);
        const isCallLog =
          !message?._systemEvent &&
          isCallLogBody(extractMessageBodyText(message?.body).trim());
        const linkTarget = findContextMenuLinkTarget(event?.target, targetEl);
        const files = getMessageFiles(message);
        items.push(
          ...(canReplyToMessage
            ? [
                {
                  id: "reply",
                  label: t("modals.context.reply"),
                  icon: Reply,
                  onSelect: () => onReplyToMessage?.(message),
                },
              ]
            : []),
          ...(hasText
            ? [
                {
                  id: linkTarget ? "copy-link" : "copy",
                  label: linkTarget
                    ? t("modals.context.copyLink")
                    : t("modals.context.copyText"),
                  icon: Copy,
                  onSelect: () =>
                    copyTextToClipboard(
                      linkTarget || extractMessageBodyText(message?.body),
                    ),
                },
              ]
            : []),
          ...(hasText && canEditMessage?.(message) && !isCallLog
            ? [
                {
                  id: "edit",
                  label: t("common.actions.edit"),
                  icon: Pencil,
                  disabled: Boolean(offline),
                  onSelect: () => onEditMessage?.(message),
                },
              ]
            : []),
          ...(files.length
            ? [
                {
                  id: "save",
                  label: t("common.actions.save"),
                  icon: Download,
                  onSelect: () => onSaveMessageFiles?.(message),
                },
              ]
            : []),
          ...(isCallLog
            ? []
            : [
                {
                  id: "forward",
                  label: t("modals.context.forward"),
                  icon: Forward,
                  onSelect: () => onForwardMessage?.(message),
                },
              ]),
          ...(canDeleteMessages
            ? [
                {
                  id: "delete",
                  label: t("common.actions.delete"),
                  icon: Trash,
                  danger: true,
                  onSelect: () =>
                    onDeleteMessage?.(message, {
                      allowDeleteForEveryone: Boolean(
                        canDeleteMessageForEveryone?.(message),
                      ),
                    }),
                },
              ]
            : []),
        );
      }

      if (kind === "user") {
        const targetUser = data?.member || data?.user || null;
        const username = String(targetUser?.username || "").toLowerCase();
        const isSelf = username === String(currentUsername || "").toLowerCase();
        const existingDm = findExistingDmWithUser(username);
        // A customer (role "user") inside a support-channel thread can never
        // receive a direct chat: POST /api/chats/dm refuses customer↔staff
        // pairs by design ("those are tickets"). Offering the DM shortcut
        // there produced a dead end — inside a REFERRED support group the
        // thread is a group (not the customer's dm-shaped ticket), so no
        // existing DM matched and the client actually attempted to CREATE
        // one, which the server always refuses. Hide the shortcut when the
        // target is a customer in a support context.
        // NOTE: prefer `user_role` (the account-level role) over `role`,
        // which on chat-member objects is the CHAT role ("owner"/"member")
        // and says nothing about whether the user is a customer.
        const targetRole = String(
          targetUser?.user_role ?? targetUser?.role ?? "",
        ).toLowerCase();
        const isSupportContext =
          String(data?.sourceChatChannel || "") === "support";
        const isCustomerTarget =
          targetRole === "user" ||
          // Operators in the members list carry the role explicitly; a bare
          // username with no role at all is treated as a customer too — the
          // safe side, since customer↔staff DMs are refused either way.
          (!targetRole && data?.sourceChatChannel != null);
        const hideDmShortcut = isSupportContext && isCustomerTarget;
        const isRemovableGroupMember =
          data?.sourceChatType === "group" &&
          canCurrentUserEditGroup &&
          !isSelf &&
          String(targetUser?.role || "").toLowerCase() !== "owner";

        items.push({
          id: "profile",
          label: t("modals.context.openProfile"),
          icon: User,
          onSelect: () => {
            if (typeof data?.onOpenProfile === "function") {
              data.onOpenProfile(targetUser);
              return;
            }
            onOpenProfile?.(targetUser);
          },
        });

        if (!isSelf && !existingDm && !hideDmShortcut) {
          items.push({
            id: "chat",
            label: t("modals.context.chat"),
            icon: Chat,
            onSelect: () => onOpenOrCreateDm?.(targetUser),
          });
        }

        if (isRemovableGroupMember) {
          items.push({
            id: "remove",
            label: t("common.actions.remove"),
            icon: Ban,
            danger: true,
            onSelect: () => onRemoveGroupMember?.(targetUser),
          });
        }
      }

      if (kind === "chat") {
        const chat = data?.chat || null;
        const unreadCount = Number(chat?.unread_count || 0);
        if (unreadCount > 0) {
          items.push({
            id: "seen",
            label: t("modals.context.markAsSeen"),
            icon: CheckCheck,
            onSelect: () => handleMarkChatSeen(chat),
          });
        }
        if (String(chat?.type || "").toLowerCase() !== "saved") {
          items.push({
            id: "mute",
            label: chat?._muted
              ? t("modals.shared.unmute")
              : t("modals.shared.mute"),
            icon: chat?._muted ? Volume2 : VolumeX,
            onSelect: () => onToggleChatMute?.(chat?.id),
          });
        }
        if (canDeleteChatThread?.(chat) !== false) {
          items.push({
            id: "delete",
            label: t("common.actions.delete"),
            icon: Trash,
            danger: true,
            onSelect: () => onDeleteChats?.([chat?.id]),
          });
        }
      }

      if (!items.length) return;
      const message = kind === "message" ? data?.message || null : null;
      setContextMenu({
        kind,
        point,
        items,
        targetEl: targetEl || null,
        targetChatId: activeChatId || null,
        targetMessageKey: message
          ? String(message?._clientId ?? message?._serverId ?? message?.id ?? "")
          : "",
      });
    },
    [
      activeChatId,
      canReplyToMessage,
      canCurrentUserEditGroup,
      currentUsername,
      findContextMenuLinkTarget,
      findExistingDmWithUser,
      handleMarkChatSeen,
      onDeleteChats,
      onDeleteMessage,
      onEditMessage,
      onForwardMessage,
      onSaveMessageFiles,
      onOpenOrCreateDm,
      onOpenProfile,
      onRemoveGroupMember,
      onReplyToMessage,
      onToggleChatMute,
      canDeleteMessageForEveryone,
      canDeleteMessages,
      canDeleteChatThread,
      canEditMessage,
      isOfflineProp,
      sseConnected,
      t,
    ],
  );

  return {
    contextMenu,
    closeContextMenu,
    openContextMenu,
  };
}
