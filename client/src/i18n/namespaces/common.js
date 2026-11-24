/**
 * Common namespace: shared labels (actions, states, confirmations) reused
 * across chat and admin surfaces.
 *
 * `en` holds the English source strings; `fa` mirrors the exact same key
 * shape in Persian. Both objects MUST stay key-identical.
 */
export const common = {
  en: {
    actions: {
      save: "Save",
      cancel: "Cancel",
      close: "Close",
      delete: "Delete",
      edit: "Edit",
      done: "Done",
      confirm: "Confirm",
      continue: "Continue",
      back: "Back",
      retry: "Retry",
      search: "Search",
      loading: "Loading…",
      add: "Add",
      remove: "Remove",
      copy: "Copy",
      copied: "Copied",
      reset: "Reset",
      send: "Send",
      open: "Open",
      view: "View",
    },
    states: {
      online: "online",
      offline: "offline",
      error: "Something went wrong.",
      requestFailed: "Request failed.",
      networkError: "Connection error. Please try again.",
    },
    channelBadgeSupport: "Support ticket",
    channelBadgeMessenger: "Messenger chat",
    impersonation: {
      banner: "Owner monitoring: you are browsing as @{username} (session started by @{owner})",
      ownerFallback: "the owner",
      return: "Return to admin panel",
    },
    ticketStatusOpen: "Open",
    ticketStatusClosed: "Closed",
    ticketClose: "Close ticket",
    ticketReopen: "Reopen ticket",
    ticketClosedBanner:
      "This support ticket is closed. Reopen it to continue the conversation.",
    ticketStatusChanged: "Ticket status updated.",
  },
  fa: {
    actions: {
      save: "ذخیره",
      cancel: "لغو",
      close: "بستن",
      delete: "حذف",
      edit: "ویرایش",
      done: "انجام شد",
      confirm: "تأیید",
      continue: "ادامه",
      back: "بازگشت",
      retry: "تلاش دوباره",
      search: "جستجو",
      loading: "در حال بارگذاری…",
      add: "افزودن",
      remove: "حذف",
      copy: "کپی",
      copied: "کپی شد",
      reset: "بازنشانی",
      send: "ارسال",
      open: "باز کردن",
      view: "مشاهده",
    },
    states: {
      online: "آنلاین",
      offline: "آفلاین",
      error: "مشکلی پیش آمد.",
      requestFailed: "درخواست ناموفق بود.",
      networkError: "خطای اتصال. لطفاً دوباره تلاش کنید.",
    },
    channelBadgeSupport: "تیکت پشتیبانی",
    channelBadgeMessenger: "چت پیام‌رسان",
    impersonation: {
      banner: "نظارت مالک: شما به‌عنوان @{username} وارد شده‌اید (نشست آغازشده توسط @{owner})",
      ownerFallback: "مالک",
      return: "بازگشت به پنل مدیریت",
    },
    ticketStatusOpen: "باز",
    ticketStatusClosed: "بسته",
    ticketClose: "بستن تیکت",
    ticketReopen: "بازگشایی تیکت",
    ticketClosedBanner:
      "این تیکت پشتیبانی بسته شده است. برای ادامه گفت‌وگو آن را بازگشایی کنید.",
    ticketStatusChanged: "وضعیت تیکت به‌روزرسانی شد.",
  },
};
