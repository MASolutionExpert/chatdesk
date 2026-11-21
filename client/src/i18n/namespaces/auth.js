/**
 * Auth namespace: the login / sign-up screen and the app shell strings that
 * wrap it (route-loading fallback, auth header, client-side auth errors).
 *
 * `en` holds the English source strings; `fa` mirrors the exact same key
 * shape in Persian. Both objects MUST stay key-identical.
 */
export const auth = {
  en: {
    app: {
      loading: "Loading{dots}",
      logoAlt: "ChatDesk logo",
    },
    errors: {
      unableToSignIn: "Unable to sign in.",
      unableToCreateAccount: "Unable to create account.",
      passwordMismatch: "Passwords do not match.",
    },
  },
  fa: {
    app: {
      loading: "در حال بارگذاری{dots}",
      logoAlt: "لوگوی ChatDesk",
    },
    errors: {
      unableToSignIn: "ورود انجام نشد.",
      unableToCreateAccount: "ساخت حساب کاربری انجام نشد.",
      passwordMismatch: "گذرواژه‌ها یکسان نیستند.",
    },
  },
};
