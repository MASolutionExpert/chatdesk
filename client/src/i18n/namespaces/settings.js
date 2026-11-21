/**
 * Settings namespace: the settings hub and its panels (profile, security,
 * data, notifications, about, language).
 *
 * `en` holds the English source strings; `fa` mirrors the exact same key
 * shape in Persian. Both objects MUST stay key-identical.
 */
export const settings = {
  en: {
    title: "Settings",
    back: "Back to settings",
    menu: {
      editProfile: "Edit profile",
      savedMessages: "Saved messages",
      adminPanel: "Admin Panel",
      security: "Security",
      data: "Data",
      notifications: "Notifications",
      whatsNew: "What's new",
      about: "About",
      logout: "Log out",
      theme: {
        light: "Light mode",
        dark: "Dark mode",
      },
    },
    profile: {
      title: "Edit profile",
      photo: "Profile photo",
      changePhoto: "Change profile photo",
      removePhoto: "Remove photo",
      nickname: "Nickname",
      username: "Username",
      usernameHint: "Use english letters, numbers, dot (.), and underscore (_).",
      status: "Status",
      statusOnline: "Online",
      statusInvisible: "Invisible",
      invisibleHint: "Invisible makes you appear offline to others.",
      save: "Save profile",
    },
    security: {
      title: "Security",
      currentPassword: "Current password",
      newPassword: "New password",
      confirmPassword: "Confirm new password",
      showCurrent: "Show current password",
      hideCurrent: "Hide current password",
      showNew: "Show new password",
      hideNew: "Hide new password",
      showConfirm: "Show confirm password",
      hideConfirm: "Hide confirm password",
      update: "Update password",
    },
    data: {
      title: "Data",
      cachedSize: "Cached Size",
      chatEntries: "Chat entries",
      messageCache: "Message cache",
      mediaThumbnails: "Media thumbnails",
      videoPosters: "Video posters",
      voiceWaveforms: "Voice waveforms",
      clear: "Clear",
      clearCache: "Clear cache",
      confirmTitle: "Clear cached data",
      confirmDescription:
        "This only removes local cached data from this device. You'll need to reload to refresh the cache.",
    },
    notifications: {
      title: "Notifications",
      show: "Show notifications",
      preview: "Message preview",
    },
    about: {
      title: "About",
      version: "Version",
      unknown: "Unknown",
      rights:
        "All rights reserved. ChatDesk is a free and open-source project, licensed under the MIT License.",
    },
    deleteAccount: {
      title: "Delete account",
      description:
        "This permanently deletes your account, removes your messages, and transfers or deletes any groups/channels you own.",
    },
    language: {
      title: "Language",
      hint: "Choose the interface language. This preference is saved to your account and follows you on every device.",
    },
  },
  fa: {
    title: "تنظیمات",
    back: "بازگشت به تنظیمات",
    menu: {
      editProfile: "ویرایش پروفایل",
      savedMessages: "پیام‌های ذخیره‌شده",
      adminPanel: "پنل مدیریت",
      security: "امنیت",
      data: "داده‌ها",
      notifications: "اعلان‌ها",
      whatsNew: "امکانات جدید",
      about: "درباره",
      logout: "خروج از حساب",
      theme: {
        light: "حالت روشن",
        dark: "حالت تاریک",
      },
    },
    profile: {
      title: "ویرایش پروفایل",
      photo: "عکس پروفایل",
      changePhoto: "تغییر عکس پروفایل",
      removePhoto: "حذف عکس",
      nickname: "نام مستعار",
      username: "نام کاربری",
      usernameHint: "از حروف انگلیسی، عدد، نقطه (.) و زیرخط (_) استفاده کنید.",
      status: "وضعیت",
      statusOnline: "آنلاین",
      statusInvisible: "نامرئی",
      invisibleHint: "در حالت نامرئی، برای دیگران آفلاین به نظر می‌رسید.",
      save: "ذخیره پروفایل",
    },
    security: {
      title: "امنیت",
      currentPassword: "گذرواژه فعلی",
      newPassword: "گذرواژه جدید",
      confirmPassword: "تکرار گذرواژه جدید",
      showCurrent: "نمایش گذرواژه فعلی",
      hideCurrent: "پنهان‌کردن گذرواژه فعلی",
      showNew: "نمایش گذرواژه جدید",
      hideNew: "پنهان‌کردن گذرواژه جدید",
      showConfirm: "نمایش تکرار گذرواژه",
      hideConfirm: "پنهان‌کردن تکرار گذرواژه",
      update: "به‌روزرسانی گذرواژه",
    },
    data: {
      title: "داده‌ها",
      cachedSize: "حجم کش",
      chatEntries: "پیام‌های گفتگو",
      messageCache: "کش پیام‌ها",
      mediaThumbnails: "تصاویر بندانگشتی",
      videoPosters: "پوستر ویدیوها",
      voiceWaveforms: "شکل موج صدا",
      clear: "پاک کردن",
      clearCache: "پاک کردن کش",
      confirmTitle: "پاک کردن داده‌های کش‌شده",
      confirmDescription:
        "این کار فقط داده‌های کش‌شدهٔ محلی را از این دستگاه حذف می‌کند. برای تازه‌سازی کش باید صفحه را دوباره بارگذاری کنید.",
    },
    notifications: {
      title: "اعلان‌ها",
      show: "نمایش اعلان‌ها",
      preview: "پیش‌نمایش پیام",
    },
    about: {
      title: "درباره",
      version: "نسخه",
      unknown: "نامشخص",
      rights:
        "تمام حقوق محفوظ است. ChatDesk یک پروژهٔ آزاد و متن‌باز است و تحت پروانهٔ MIT منتشر شده است.",
    },
    deleteAccount: {
      title: "حذف حساب",
      description:
        "این کار حساب شما را برای همیشه حذف می‌کند، پیام‌های شما را پاک می‌کند و هر گروه/کانالی که مالک آن هستید را منتقل یا حذف می‌کند.",
    },
    language: {
      title: "زبان",
      hint: "زبان رابط کاربری را انتخاب کنید. این تنظیم روی حساب شما ذخیره می‌شود و روی همه دستگاه‌ها همراه شماست.",
    },
  },
};
