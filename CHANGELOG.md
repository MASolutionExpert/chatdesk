# Changelog

All notable changes to ChatDesk are documented in this file.

## 1.7.0-dev.6

### Fixed

- 🎨 **The default PWA/app icon is now ChatDesk everywhere — the old Songbird swan is gone.** Installing the PWA (iOS Safari "Add to Home Screen", Android Chrome install prompt, the in-app install guide, desktop) still produced the old Songbird swan icon, because every bundled static icon under `client/public/icons` (16/32/180/192/512, maskable, circular, favicon.ico) plus `docs/public/favicon.ico` still carried the swan artwork. The whole set is regenerated from the ChatDesk speech-bubble mark: white rounded-square tiles for Android/manifest, a full-bleed white apple-touch icon for iOS (iOS applies its own mask), maskable variants on a brand-green gradient with a white bubble inside the safe zone, and transparent bubble glyphs for 16/32/favicons.
- 🔁 **Already-cached clients get the new icons immediately, not after a stale-cache limbo.** Two root causes of "old icon persists after deploy" were fixed: (1) the service worker precached the old swan PNGs under a never-bumped cache version — `CACHE_VERSION` is now bumped (1.1.0) so the old cache is deleted and the new art re-precached on update; (2) every static icon URL is now referenced with a `?v=chatdesk` cache-buster (index.html links, web manifest, service worker precache/notification icons, install bar/guide icons) so browsers that still hold a cached swan fetch the fresh bytes instead of reusing them.
- 🩹 **`/favicon.ico` no longer falls through to the SPA HTML shell.** Default installs had no `favicon.ico` at the client root, so the route missed the static file, hit the catch-all and served `index.html` as the favicon (browsers silently ignored it). A multi-size favicon.ico (16/32/48) now ships at `client/public/favicon.ico` too.

**Tests:** client unit 42 files / 447 green; ESLint clean; every generated PNG verified visually (512 tile, maskable pair, apple-touch 180, 16/32 glyphs) and the ICO structure checked byte-level (3 embedded sizes).

**خلاصهٔ فارسی:**

### رفع اشکال

- 🎨 **آیکون پیش‌فرض PWA و اپ حالا همه‌جا ChatDesk است — قوی قدیمی Songbird حذف شد.** هنگام نصب PWA (روی iOS با سافاری «Add to Home Screen»، نصب کروم در اندروید، راهنمای نصب داخل برنامه و دسکتاپ) هنوز آیکون قوِ قدیمی Songbird نصب می‌شد، چون تمام آیکون‌های استاتیک همراه برنامه در `client/public/icons` (اندازه‌های ۱۶/۳۲/۱۸۰/۱۹۲/۵۱۲، نسخه‌های maskable، دایره‌ای و favicon.ico) به‌علاوه `docs/public/favicon.ico` هنوز همان طرح قدیمی را داشتند. کل این مجموعه از نشان حباب-گفتگوی ChatDesk از نو ساخته شد: کاشی‌های مربع-گوشه‌گرد سفید برای اندروید/منیفست، آیکون apple-touch تمام-صفحه سفید برای iOS (خود iOS گوشه‌ها را گرد می‌کند)، نسخه‌های maskable روی گرادیان سبز برند با حباب سفید داخل محدودهٔ امن، و گلیف حباب شفاف برای ۱۶/۳۲ و فاوآیکون‌ها.
- 🔁 **کلاینت‌های دارای کش هم بلافاصله آیکون تازه را می‌گیرند، نه بعد از یک دورهٔ کش-کهنه.** دو ریشهٔ «آیکون قدیمی بعد از استقرار هم می‌ماند» بسته شد: (۱) سرویس‌ورکر آیکون‌های قوِ قدیمی را با نسخهٔ کشی که هرگز bump نمی‌شد پیش‌ذخیره می‌کرد — حالا `CACHE_VERSION` bumped شده (۱.۱.۰) تا کش قدیمی حذف و طرح تازه پیش‌ذخیره شود؛ (۲) همهٔ URLهای آیکون استاتیک حالا با `?v=chatdesk` شکستن-کش ارجاع می‌شوند (لینک‌های index.html، وب منیفست، آیکون‌های پیش‌ذخیره/نوتیفیکیشن سرویس‌ورکر و آیکون‌های نوار/راهنمای نصب) تا مرورگرهایی که هنوز قوِ کش‌شده دارند بایت‌های تازه را بگیرند.
- 🩹 **`/favicon.ico` دیگر به پوستهٔ HTML اسپا ختم نمی‌شود.** در نصب‌های پیش‌فرض هیچ favicon.ico در ریشهٔ کلاینت نبود؛ درخواست به فایل استاتیک نمی‌رسید، به مسیر catch-all می‌افتاد و `index.html` را به‌عنوان فاوآیکون برمی‌گرداند (مرورگرها بی‌صدا نادیده می‌گرفتند). حالا یک favicon.ico چندسایزی (۱۶/۳۲/۴۸) هم در `client/public/favicon.ico` منتشر می‌شود.

**آزمون‌ها:** یونیت کلاینت ۴۲ فایل / ۴۴۷ سبز؛ ESLint پاک؛ همهٔ PNGهای تولیدشده به‌صورت چشمی بازبینی شدند (کاشی ۵۱۲، جفت maskable، apple-touch ۱۸۰، گلیف‌های ۱۶/۳۲) و ساختار ICO در سطح بایت کنترل شد (۳ سایز جاسازی‌شده).

## 1.7.0-dev.5

### Fixed

- 🪄 **Tapping a member's name or avatar in a group no longer stacks two popups.** On touch devices, tapping a sender's name/avatar opened the full profile popup (good) AND, a split second later, the small context menu ("Open profile / Chat / Remove") on top of it — two layers fighting for attention. Root cause: the swipe-reply wrapper holds pointer capture on the message row, so the surface never saw the touch release; the long-press timer survived as an orphan, fired ~300ms after the tap, and opened the menu over the already-open profile modal. The long-press trigger now watches the release at document level (capture phase), so any pointerup/pointercancel cancels the hold no matter where the browser retargets the event — a tap opens only the profile, a deliberate long-press opens only the menu.
- 🪄 **Long-press menus no longer flash open and instantly close.** Same capture mechanics in reverse: after the hold menu opened, the browser's synthesized release click landed on the menu's own backdrop and dismissed it within the same gesture. The release click is now swallowed (document-level, one-shot) when it follows a materialized hold, so long-press menus — sender menu and message menu alike — stay open and usable.

**Tests:** client unit 42 files / 447 green; server 150 files / 1458 green; ESLint clean; verified on-device with real touch emulation (Chromium, iPhone profile): quick tap → profile only; 500ms hold → stable menu; menu item → profile; message-bubble hold → message menu intact.

**خلاصهٔ فارسی:**

### رفع اشکال

- 🪄 **لمس نام یا عکس پروفایل یکی در گروه‌ها دیگر دو پاپ‌آپ روی هم باز نمی‌کند.** در دستگاه‌های لمسی، لمس نام/آواتار فرستنده هم پاپ‌آپ کامل پروفایل را باز می‌کرد (خوب) و هم لحظه‌ای بعد منوی کوچک زمینه («باز کردن نمایه / گفتگو / حذف») را روی همان پاپ‌آپ اصلی — دو لایه که توجه را می‌دزدیدند. ریشهٔ ماجرا: پوشش واکنش-با-کشیدن، capture اشاره‌گر را روی ردیف پیام نگه می‌دارد؛ در نتیجه سطحِ منو هرگز رهاشدن لمس را نمی‌دید و تایمر نگه‌داشتنِ بی‌صاحب می‌ماند، حدود ۳۰۰ میلی‌ثانیه بعد از لمس شلیک می‌کرد و منو را روی پاپ‌آپ پروفایلِ از قبل باز می‌انداخت. حالا تریگر نگه‌داشتن، رهاشدن لمس را در سطح سند (فاز capture) نظاره می‌کند؛ هر pointerup/pointercancel تایمر را باطل می‌کند مهم نیست مرورگر رویداد را به کجا بازنشانه می‌گیرد — لمس فقط پروفایل را باز می‌کند و نگه‌داشتنِ عمدی فقط منو را.
- 🪄 **منوهای لمس-نگه‌داشتن دیگر باز-بستهٔ آنی نمی‌شوند.** همان مکانیک capture به‌صورت معکوس: بعد از باز شدن منو، کلیکِ ساختگیِ مرورگر هنگام رهاکردن انگشت روی پس‌زمینهٔ خود منو می‌نشست و همان لحظه منو را می‌بست. حالا وقتی نگه‌داشتن به منو انجامیده باشد، کلیکِ پس از رهاکردن (یک‌بارمصرف، در سطح سند) بلعیده می‌شود؛ منوهای لمسی — منوی فرستنده و منوی پیام — باز می‌مانند و قابل استفاده‌اند.

**آزمون‌ها:** یونیت کلاینت ۴۲ فایل / ۴۴۷ سبز؛ سرور ۱۵۰ فایل / ۱۴۵۸ سبز؛ ESLint پاک؛ بازبینی روی دستگاه با شبیه‌سازی لمس واقعی (کرومیوم، پروفایل آیفون): لمس سریع ← فقط پروفایل؛ نگه‌داشتن ۵۰۰ms ← منوی پایدار؛ انتخاب آیتم منو ← پروفایل؛ نگه‌داشتن روی حباب پیام ← منوی پیام سالم.

## 1.7.0-dev.4

### Added

- 🗜️ **Telegram-style media compression — media uploads no longer hit the server at full camera size.** Until now every image went up as the raw original bytes: a 12 MP phone photo at ~4 MB bloated messages, upload bandwidth and the server disk. Now:
  - **Images compress in the browser before upload** (both storage drivers): downscaled to a 2560px box (never upscaled) and re-encoded to WebP at quality 0.82 (JPEG fallback where a browser can't encode WebP — verified by magic-byte sniffing, since Safari silently returns PNG). Camera photos drop to a small fraction of their size with no visible quality loss, and the sender's upload gets lighter too.
  - **Safety rules, enforced**: GIF/SVG are never re-encoded (animation/vectors would break); transparency is never destroyed (a PNG/WebP with alpha keeps its original bytes when true WebP encoding is unavailable); documents the user explicitly sends as files are untouched; and the compressed result is only used when it actually saves bytes (≥5% smaller) — already-tiny images pass through unchanged.
  - **Videos compress server-side** (Media Worker): the transcode standard moved from `ultrafast` to the H.264 `veryfast` preset at the same CRF 23 (far better compression per quality) and gained a 1920×1920 downscale box — aspect preserved, never upscaled, even dimensions — so 4K phone recordings stop dominating storage. The raw upload is still deleted after a successful transcode.
  - **Avatars** (user / group / channel, presigned and multipart paths) are re-encoded in the browser to ≤1024px WebP/JPEG.
  - Failure-tolerant by design: any decode/encode hiccup uploads the original bytes; nothing blocks sending.

### Fixed

- 🧹 **Storage hygiene: local orphan sweep.** Multipart uploads land in `DATA_DIR/uploads/messages/` as their final storage location, so a crashed request or a server kill between multer's write and the DB insert left a stray file that nothing ever removed. A new `pruneOrphanLocalUploadFiles` sweep (runs at boot and on every cleanup tick) deletes unreferenced files older than 24h — over-inclusive reference matching (stored_name, storage_key, thumb_storage_key) and a bail-out when the DB cannot be consulted, so live data is never at risk.

**Tests:** server 150 files / 1458 green (4 new orphan-sweep tests on a real temp dir); worker 6 files / 36 green (transcode-command standard test); client unit 42 files / 447 green + 3 real-browser Chromium compression tests (canvas pipeline: 3200×2400 noisy PNG → 2560×1920 WebP, no-gain guard, GIF/SVG pass-through); ESLint clean.

**خلاصهٔ فارسی:**

### افزودن

- 🗜️ **فشرده‌سازی رسانه به سبک تلگرام — دیگر مدیا با حجم کامل دوربین روی سرور نمی‌رود.** تا امروز هر عکس با همان بایت‌های خام اصلی آپلود می‌شد؛ یک عکس ۱۲ مگاپیکسلی حدود ۴ مگابایت، هم پیام‌ها را سنگین می‌کرد هم پهنای باند و دیسک سرور را پر می‌کرد. حالا:
  - **تصاویر در مرورگر و قبل از آپلود فشرده می‌شوند** (برای هر دو درایور ذخیره‌سازی): کوچک‌سازی تا کادر ۲۵۶۰ پیکسل (بدون بزرگ‌نمایی) و کدگذاری مجدد به WebP با کیفیت ۰٫۸۲ (در مرورگرهایی که WebP نمی‌سازند JPEG — با بواسیدن بایت‌های خروجی تشخیص داده می‌شود، چون سافاری بی‌سروصدا PNG تحویل می‌دهد). حجم عکس‌های دوربین به کسری از حجم اصلی می‌رسد بدون افت محسوس کیفیت، و آپلود فرستنده هم سبک‌تر می‌شود.
  - **قواعد ایمنی، تضمین‌شده**: GIF و SVG هرگز بازکدگذاری نمی‌شوند؛ شفافیت هرگز از بین نمی‌رود (PNG/WebP دارای آلفا در نبود WebPِ واقعی با بایت‌های اصلی می‌رود)؛ سندهایی که کاربر آگاهانه به‌عنوان فایل می‌فرستد دست‌نخورده‌اند؛ و نتیجهٔ فشرده فقط وقتی به کار می‌رود که واقعاً حجم را کم کند (حداقل ۵٪) — عکس‌های از قبل کوچک بدون تغییر می‌مانند.
  - **ویدیوها سمت سرور فشرده می‌شوند** (Media Worker): استاندارد ترنسکد از `ultrafast` به پریست `veryfast` در همان CRF 23 منتقل شد (فشرده‌سازی بسیار بهتر در همان کیفیت) و کادر کوچک‌سازی ۱۹۲۰×۱۹۲۰ اضافه شد — حفظ نسبت ابعاد، بدون بزرگ‌نمایی، ابعاد زوج — تا ویدیوهای 4K گوشی دیگر فضای سرور را پر نکنند. فایل خام همچنان بعد از ترنسکد موفق حذف می‌شود.
  - **آواتارها** (کاربر / گروه / کانال، هم مسیر presigned هم multipart) در مرورگر به WebP/JPEG حداکثر ۱۰۲۴ پیکسل بازکدگذاری می‌شوند.
  - از پایه در برابر خطا مقاوم: هر خطای رمزگشایی/کدگذاری یعنی بایت‌های اصلی آپلود می‌شوند؛ هیچ‌چیز ارسال پیام را مسدود نمی‌کند.

### رفع اشکال

- 🧹 **بهداشت فضای ذخیره‌سازی: پاکسازی زائد محلی.** آپلودهای multipart مستقیماً در `DATA_DIR/uploads/messages/` به‌عنوان محل نهایی ذخیره‌سازی نوشته می‌شوند؛ بنابراین یک درخواست نیمه‌کاره یا سرورِ کشته‌شده بین نوشتن multer و درج در پایگاه‌داده یک فایل بی‌صاحب باقی می‌گذاشت که تا امروز هیچ‌چیز آن را حذف نمی‌کرد. پاکسازی تازهٔ `pruneOrphanLocalUploadFiles` (اجرای هنگام بوت و در هر تیک پاکسازی) فایل‌های بدون ارجاعِ قدیمی‌تر از ۲۴ ساعت را حذف می‌کند — تطبیق ارجاع‌ها با احتیاطِ بیش‌شماری (stored_name، storage_key، thumb_storage_key) و انصراف کامل وقتی پایگاه‌داده در دسترس نیست، تا هیچ دادهٔ زنده‌ای در خطر نباشد.

## 1.7.0-dev.3

### Fixed

- 🖼️ **Replaced logo no longer sticks — the old logo kept showing after a new upload, even inside the Personalization tab.** Root cause: three stacked cache layers, none invalidated. Every branding icon was served at a **constant URL** (`/api/branding/logo.png`, `icon-<n>.png`) with a `max-age=300` browser cache, the client kept an in-memory branding payload that was **never refreshed** after an upload, and even a refetch hit the same URL so the browser served the previous PNG. Rebuilt from the root:
  - **Cache-busted versioned URLs**: every branding URL now carries `?v=<upload-timestamp>` (file-mtime fallback if the setting is lost) — a re-upload produces brand-new URLs, so no cache layer anywhere can shadow the new logo. Versioned requests are served `immutable`; unversioned requests revalidate (`no-cache`) instead of trusting stale copies. The **PWA manifest icons** are versioned too, so installed phones pick up the new art.
  - **Live propagation**: the shared client branding cache is force-refreshed after every save/upload/reset, and the entry page now **subscribes** to branding changes — logo, favicon and wordmark update instantly, no reload, no "wait a moment".
  - **Entry-page logo is twice as large** on the login screen (iOS-style flat rounded corners unchanged) so the organization mark reads properly.
  - **The «©2026» token is now editable**: a new *Copyright year* field in the Personalization tab replaces the year element of the bottom copyright line (empty = current year, as before).

**Tests:** 149 server files / 1454 tests green (5 new: fresh-versioned-URLs on re-upload, mtime fallback, immutable/no-cache cache-control, copyright-year round-trip; URL assertions cache-bust-aware); client unit 443 green; ESLint clean.

**خلاصهٔ فارسی:**

- 🖼️ **رفع باگ چسبیدن لوگوی قدیمی — بعد از آپلود لوگوی جدید، همان لوگوی قبلی نشان داده می‌شد؛ حتی در خود صفحهٔ «شخصی‌سازی».** ریشهٔ مشکل: سه لایهٔ انبار موازی که هیچ‌کدام باطل نمی‌شدند — همهٔ آیکون‌ها با **نشانی ثابت** سرو می‌شدند (`max-age=300` در مرورگر)، حافظهٔ برنامگی سمت کلاینت بعد از آپلود **هرگز تازه نمی‌شد**، و حتی با واکشی دوباره، نشانی همان بود و مرورگر همان PNG قبلی را نشان می‌داد. بازسازی از پایه:
  - **نشانی‌های نسخه‌دار با شکستن انبار**: همهٔ نشانی‌های برندینگ حالا `?v=<زمان آپلود>` دارند (با بازگشت به زمان فایل اگر تنظیم گم شده باشد) — هر آپلود تازه نشانی‌های کاملاً نو می‌سازد، پس هیچ لایهٔ انباری در هیچ‌جا نمی‌تواند لوگوی جدید را پشت لوگوی قبلی پنهان کند. درخواست‌های نسخه‌دار `immutable` سرو می‌شوند و درخواست‌های بی‌نسخه همیشه اعتبارسنجی مجدد می‌شوند. **آیکون‌های مانیفست PWA** هم نسخه‌دارند تا گوشی‌های نصب‌شده آرت تازه را بگیرند.
  - **انتشار زنده**: حافظهٔ مشترک برندینگ بعد از هر ذخیره/آپلود/بازنشانی به‌صورت اجباری تازه می‌شود و صفحهٔ ورود حالا **مشترک** تغییرات برندینگ است — لوگو، favicon و نام برنامه بی‌درنگ عوض می‌شوند؛ بدون بارگذاری دوباره و بدون «چند لحظه صبر کنید».
  - **لوگوی صفحهٔ ورود دو برابر بزرگ‌تر شد** (همان حالت فلت با گوشه‌های گرد به سبک iOS) تا نشان سازمان درست خوانده شود.
  - **المان «©2026» حالا قابل ویرایش است**: فیلد تازهٔ *سال کپی‌رایت* در تب شخصی‌سازی، المان سالِ خط کپی‌رایت پایین را عوض می‌کند (خالی = سال جاری، مثل قبل).

## 1.7.0-dev.2

### Added

- 🎨 **Admin Panel → Personalization («شخصی‌سازی»): a new owner tab — between Permissions and Logs — that rebrands the entry page and the About dialog from the roots.**
  - **Organization logo upload, any image format**: upload PNG/JPEG/WebP/GIF/SVG/BMP… and the browser converts it (canvas, centered cover-crop) into a full set of PNG icons — favicon (16/32), apple-touch icon (180), PWA app icon (192/512). With a custom logo the server serves a **dynamic `/manifest.webmanifest`** (organization name + the uploaded icons) and `/favicon.ico`, so installed phones and browser tabs show the organization's own mark. Files live under `DATA_DIR/branding/`; the server gained **zero native image dependencies** — no sharp, nothing to install.
  - **Entry page, fully yours**: the login screen shows the uploaded logo **iOS-style — flat with rounded corners** — and both the wordmark (default `ChatDesk`) and an editable sentence below it (e.g. the organization name) are configurable, so the first page is completely the organization's.
  - **About dialog, editable**: the version stays on top (never editable). Below it, the fixed GitHub/Docker icons are replaced by a **configurable link list** (up to 8 entries; each is an icon — Website globe / GitHub / Docker / Telegram / Email / Railway / ChatDesk — plus its URL, opening in a new tab). The proprietary-software sentence is editable (empty = built-in default), and the **copyright line moved to the very bottom** of the dialog and is editable too (renders as `© <year> <name>`, optional link).
  - **Built from the foundation, extensible**: the config is a validated registry (server `lib/branding.js`) persisted as one JSON row in the existing `app_settings` KV store — **no database migration** — and unknown/missing fields always fall back to defaults, so future options ship without breaking anything. Defaults reproduce the previous About dialog exactly, so unpersonalized installs look unchanged. Every change is audited (`branding.update`, `branding.logo`).
  - **API surface**: owner-gated `GET/PUT /api/admin/branding`, `POST/DELETE /api/admin/branding/logo` (multipart, PNG-signature validated), public `GET /api/branding` + `/api/branding/logo.png` + `/api/branding/icon-<n>.png`. The admin tab uploads, previews, resets; the About panel and the entry page consume the public endpoint (also swapping the favicon link tags live).

**Tests:** 149 server files / 1449 tests green (27 new: patch normalization, PNG-signature guard, config merge/corruption fallback, logo save/reset on a real temp dir, manifest builder, owner gating, public icon serving, audit entries); client unit 443 green; production client build verified; ESLint clean. Docs: bilingual Personalization-tab guide in `docs/Admin-Panel.md` + `docs/fa/Admin-Panel.md`.

**خلاصهٔ فارسی:**

- 🎨 **پنل مدیریت → «شخصی‌سازی»: تب جدید مالک — بالای گزارش‌ها و زیر دسترسی‌ها — که صفحهٔ ورود و پنجرهٔ درباره را از پایه و ریشه برندسازی می‌کند.**
  - **آپلود لوگوی سازمان با هر فرمت تصویری**: هر عکسی (PNG/JPEG/WebP/GIF/SVG/BMP…) آپلود کنید و مرورگر آن را (با بوم، برش مرکزی) به مجموعهٔ کامل آیکون‌های PNG تبدیل می‌کند — favicon (۱۶/۳۲)، آیکون لمسی اپل (۱۸۰)، آیکون اپ PWA (۱۹۲/۵۱۲). با وجود لوگوی سفارشی، سرور **`/manifest.webmanifest` پویا** (نام سازمان + آیکون‌های آپلودشده) و `/favicon.ico` را سرو می‌کند تا گوشی‌های نصب‌شده و تب مرورگر نشانِ خودِ سازمان را نشان دهند. فایل‌ها در `DATA_DIR/branding/` نگه‌داری می‌شوند و سرور **هیچ وابستگی بومی جدیدی برای تصویر ندارد**.
  - **صفحهٔ ورود کاملاً شماست**: صفحهٔ ورود لوگوی آپلودشده را **به سبک آیکون اپ‌های iOS — فلت با گوشه‌های گرد** نشان می‌دهد و هم نام برنامه (پیش‌فرض `ChatDesk`) و هم جملهٔ زیر آن (مثلاً نام سازمان) قابل ویرایش‌اند تا صفحهٔ اول کاملاً اختصاصی شود.
  - **پنجرهٔ درباره، قابل ویرایش**: نسخه بالای پنجره می‌ماند و هرگز قابل ویرایش نیست. زیر آن، دو آیکون ثابت گیت‌هاب/داکر با **فهرست لینک قابل تنظیم** جایگزین شده (تا ۸ مورد؛ هر ردیف یک آیکون — وب‌سایت / گیت‌هاب / داکر / تلگرام / ایمیل / ریلی / چت‌دسک — به‌همراه نشانی، بازشو در تب جدید). جملهٔ نرم‌افزار اختصاصی قابل ویرایش است (خالی = جملهٔ پیش‌فرض) و **خط کپی‌رایت به پایین‌ترین بخش پنجره منتقل شده** و آن هم قابل ویرایش است (`© <سال> <نام>` با لینک اختیاری).
  - **ساخته‌شده از پایه و ریشه، توسعه‌پذیر**: پیکربندی یک رجیستری اعتبارسنجی‌شده (`server/lib/branding.js`) است که به‌صورت یک ردیف JSON در همان جدول `app_settings` ذخیره می‌شود — **بدون مهاجرت پایگاه‌داده** — و فیلدهای ناشناخته/غایب همیشه به پیش‌فرض برمی‌گردند تا گزینه‌های آینده بدون شکستن چیزی اضافه شوند. پیش‌فرض‌ها دقیقاً همان پنجرهٔ دربارهٔ قبلی را بازسازی می‌کنند. هر تغییر در گزارش‌ها ثبت می‌شود (`branding.update`، `branding.logo`).
  - **سطح API**: نقاط پایانی مالک `GET/PUT /api/admin/branding` و `POST/DELETE /api/admin/branding/logo` (multipart با اعتبارسنجی امضای PNG)، و نقاط پایانی عمومی `GET /api/branding` + `/api/branding/logo.png` + `/api/branding/icon-<n>.png`. تب مدیریت آپلود/پیش‌نمایش/بازنشانی را انجام می‌دهد؛ پنجرهٔ درباره و صفحهٔ ورود از نقطهٔ عمومی مصرف می‌کنند (و لینک‌های favicon را هم زنده عوض می‌کنند).

## 1.7.0-dev.1

### Added

- 🔐 **Admin Panel → Permissions: a full role × permission management system, rebuilt from the roots.** Every previously hard-coded role check in ChatDesk is now a configurable matrix. The owner decides who may do what — per role, with a switch for each of the 22 registry permissions, grouped into **Tickets / Direct messages / Calls / Groups & channels**:
  - **Tickets**: create tickets, close & reopen, refer, delete tickets, delete any message in tickets, edit messages in tickets.
  - **Direct messages**: send DMs, delete DM threads, delete own DM messages, delete any DM message, edit DM messages.
  - **Calls**: voice calls, video calls, delete voice-call entries, delete video-call entries.
  - **Groups & channels**: create groups, create channels, leave groups & channels, delete groups, delete channels, delete any message in groups, edit messages in groups.
  - The **owner always has every permission** (locked "Always full" column — cannot be restricted, not even by accident). **Operator** and **User** are switch-configurable; a dot marks custom overrides and a per-cell reset restores the built-in defaults. Changes apply **immediately** (no restart) and every change is audited (`permission.update`).
  - **Defaults reproduce today's behaviour exactly** — out of the box nothing changes: referral stays staff-only, message deletion stays owner-only, moderators stay the only editors. Everything else is now simply configurable.
  - **Extensible from the foundation**: the registry (server `lib/permissions.js`) is the single source of truth — labels, groups and per-role defaults — while the database stores only admin overrides (migration 048, override-or-default). Future versions can add new permissions **without any database migration**: they appear in the matrix automatically with their built-in defaults, and unknown permission keys resolve to deny (fail-closed) on old servers, so older clients never break.
  - **Enforced server-side everywhere**: ticket create/close/refer, DM creation and every DM message/file send, group & channel creation, leaving, group/channel/ticket/DM-thread deletion, per-scope message editing and deletion (delete-any + author-own), voice/video call start, and call-history deletion per call kind — all route through one permission service (cached per role, invalidated on write). `/api/me`, `/api/login` and `/api/register` now embed the caller's allowed permission keys so the client can hide gated UI, while the server remains the sole authority.

**Tests:** 147 server files / 1422 tests green (49 new: registry integrity + defaults parity, migration 048 + service on real SQLite, admin API CRUD + audit, route gates for every new permission key); client unit 443 green (incl. the client-mirror drift test that imports the server registry to prove the two never diverge); 4 new browser tests for the matrix (render, toggle→PUT, override dot + reset→null, failed-PUT revert); ESLint clean on both sides. Docs: bilingual Permissions-tab guide in `docs/Admin-Panel.md` + `docs/fa/Admin-Panel.md`.

**خلاصهٔ فارسی:**

- 🔐 **پنل مدیریت → «دسترسی‌ها»: سامانهٔ کامل مدیریت دسترسی نقش × دسترسی، ساخته‌شده از پایه و ریشه.** هر بررسی نقشِ سخت‌کدشدهٔ قبلی حالا یک ماتریس قابل تنظیم است؛ مالک تعیین می‌کند هر نقش چه کاری می‌تواند بکند — با یک کلید خاموش/روشن برای هر یک از ۲۲ دسترسیِ رجیستری، در چهار گروه **تیکت‌ها / پیام‌رسانی / تماس‌ها / گروه‌ها و کانال‌ها**: ساخت/بستن/ارجاع/حذف تیکت، حذف و ویرایش هر پیام در تیکت، ارسال پیام مسنجری و حذف ترد و پیام‌های خود/هر پیام در مسنجری، تماس صوتی و تصویری و حذف ورودی‌های آن‌ها، ساخت گروه و کانال، ترک گروه و کانال، حذف گروه و کانال، و حذف/ویرایش هر پیام در گروه.
  - **مالک همیشه همهٔ دسترسی‌ها را دارد** (ستون قفل‌شدهٔ «همیشه کامل» — قابل محدودکردن نیست). نقش‌های **اپراتور** و **کاربر** با کلید تنظیم می‌شوند؛ نقطهٔ کنار کلید یعنی مقدار سفارشی و دکمهٔ بازنشانیِ هر خانه به پیش‌فرض برمی‌گرداند. تغییرها بلافاصله اعمال می‌شوند (بدون ری‌استارت) و در گزارش‌ها ثبت می‌شوند (`permission.update`).
  - **پیش‌فرض‌ها دقیقاً رفتار فعلی را بازسازی می‌کنند** — از اول چیزی عوض نمی‌شود: ارجاع فقط برای کارمندان، حذف پیام فقط مالک، ویرایش فقط میدرها. حالا همهٔ این‌ها صرفاً قابل تنظیم‌اند.
  - **توسعه‌پذیر از پایه و ریشه:** رجیستری (`server/lib/permissions.js`) تنها منبع حقیقت است و پایگاه‌داده فقط مقدارهای سفارشی را نگه می‌دارد (مهاجرت ۰۴۸، «سفارشی یا پیش‌فرض»). نسخه‌های آینده می‌توانند دسترسی جدید را **بدون هیچ مهاجرتِ پایگاه‌داده** اضافه کنند — به‌طور خودکار با پیش‌فرض‌هایش در ماتریس ظاهر می‌شود و کلیدهای ناشناخته روی سرورهای قدیمی به «رد» تفسیر می‌شوند (fail-closed) تا نسخه‌های قدیمی نشکنند.
  - **اجرا در سرور، همه‌جا:** ساخت/بستن/ارجاع تیکت، ساخت DM و ارسال هر پیام/فایل مسنجری، ساخت گروه و کانال، ترک، حذف گروه/کانال/تیکت/ترد مسنجری، ویرایش و حذف پیام به تفکیک محدوده (حذف هر پیام + حذف پیام خود)، شروع تماس صوتی/تصویری و حذف تاریخچهٔ تماس به تفکیک نوع — همه از یک سرویس دسترسی واحد عبور می‌کنند (کش per-role با بی‌اعتبارسازی فوری). `/api/me` و ورود و ثبت‌نام حالا کلیدهای دسترسی مجاز را هم برمی‌گردانند تا رابط کاربری دکمه‌های gated را پنهان کند؛ مرجع نهایی همچنان سرور است.

## 1.6.0-dev.5

### Fixed

- 🏷️ **Referred support groups are now named after the referral itself: «ارجاع (creator-username)» in Persian / "Refer (creator-username)" in English** — instead of the generic department name. The label is localized by the referring staff member's UI language (default fa), and the name carries the ticket creator's username so every member instantly sees whose ticket landed in the group. Falls back to the department name only if the ticket's customer can no longer be resolved. Verified live in the browser: the chat list and the group header both show «ارجاع (customer1)».

- 🚪 **Tapping a member's username in a referred support group no longer kicks you out of the chat page — root cause found in the overlay history-sentinel bookkeeping.** The reported flow was reproduced end-to-end: with a member profile modal open, opening the member context menu ("نمایه و …") and choosing an item closed the menu via its own `history.back()`; the pop landed on the **modal's live sentinel entry**, and the open chat's popstate handler misread "the new top is another LIVE sentinel" as "the pop went past me" — calling `closeChat()` and throwing the user out of the conversation while the modal was still on screen. `useOverlayBack` now keeps a **shared module-level mirror of the sentinel history stack**: a back traversal removes exactly the topmost entry, and only the overlay whose OWN entry was removed reacts — every other overlay (including the open chat) treats the pop as internal bookkeeping and stays put. Stale-sentinel disposal is preserved. Regression test added: "closing a menu that sits above a modal keeps the chat underneath open" (6/6 hook tests green).

- 🖱️ **Right-clicking a member's username in a message now opens the member's own menu (Profile / Chat), not the message menu.** The message container's context-menu trigger overwrote the sender's user menu within the same bubbling pass (Reply/Copy/Forward appeared instead). The desktop right-click path now skips interactive children (sender-name button, avatar, file chip) — the same rule the mobile long-press path has always applied — via a new opt-in `skipInteractiveChild` flag on the message surface.

- 🚫 **The dead-end "گفتگو" (Chat) shortcut is hidden for customer members of support threads** — in the member context menu AND the profile modal. `POST /api/chats/dm` refuses customer↔staff pairs by design ("those are tickets"); inside a referred support group the thread is a GROUP, so no existing DM matched and the client actually attempted to CREATE one, which always failed. Worse, the failure was swallowed: the error went to `profileError`, which is only rendered by the self-profile editor — the button just did nothing. Now: the shortcut is hidden for customer targets (chat role vs. account role disambiguated via `user_role`), staff↔staff DMs inside the group stay available, and any residual DM failure renders inline inside the profile modal (`dmError` prop) instead of vanishing.

**Tests:** 143 server files / 1373 tests green (incl. 3 new referral-naming tests: fa label, en label, fallback); 40 client files / 433 unit tests green; `useOverlayBack` browser tests 6/6 green including the new menu-over-modal regression; ESLint clean. End-to-end verified in a real browser (desktop 1280px): referred group naming, member context menus on sender names and inside the group profile, profile modal navigation with the chat page surviving every path, customer/staff menu differentiation.

**خلاصهٔ فارسی:**

- 🏷️ **نام‌گذاری گروه ارجاع اصلاح شد:** گروه ساپورتی بعد از ارجاع حالا «ارجاع (نام‌کاربریِ سازندهٔ تیکت)» نام می‌گیرد (برای رابط انگلیسی: "Refer (username)")، نه نام دپارتمان. برچسب بر اساس زبانِ رابط کاربریِ کارمندی که ارجاع را انجام داده انتخاب می‌شود و نامِ کاربریِ مشتری داخلش می‌آید تا همه فوراً بفهمند تیکتِ چه کسی در گروه است.
- 🚪 **پرش از صفحهٔ چت هنگام لمس نام کاربری اعضا ریشه‌یابی و رفع شد.** با باز بودن مودالِ نمایهٔ عضو، وقتی منوی زمینهٔ عضو («نمایه و …») باز و بسته می‌شد، بسته‌شدن منو یک ورودی تاریخچه را `back()` می‌کرد و popstate روی ورودیِ زندهٔ مودال فرود می‌آمد؛ هندلرِ چتِ باز این را «pop از بالای من گذشت» اشتباه می‌گرفت و `closeChat()` را صدا می‌زد — یعنی کاربر وسط کار از صفحهٔ گفتگو بیرون پرت می‌شد. حالا `useOverlayBack` یک آینهٔ مشترک از پشتهٔ ورودی‌های تاریخچه نگه می‌دارد: فقط مالکِ ورودیِ حذف‌شده واکنش نشان می‌دهد و بقیه (از جمله چتِ باز) سر جایشان می‌مانند.
- 🖱️ **راست‌کلیک روی نام کاربری عضو حالا منوی خودِ عضو (نمایه/گفتگو) را باز می‌کند** نه منوی پیام (پاسخ/کپی/ارسال به دیگران).
- 🚫 **میان‌بر «گفتگو» برای اعضای مشتریِ رشته‌های ساپورت حذف شد** (در منو و مودال نمایه) — سرور به‌هرحال چت مستقیم مشتری↔کارمند را رد می‌کند و خطای قبلی هم بی‌صدا گم می‌شد. گفتگوی کارمند↔کارمند داخل گروه باقی است و خطاهای باقی‌مانده داخل مودال نمایش داده می‌شوند.

## 1.6.0-dev.4

### Fixed

- 🛠️ **The updater could no longer update a self-hosted install: `git checkout dev` aborted with "Your local changes to the following files would be overwritten by checkout: client/package-lock.json, server/package-lock.json"** — reported by a production deployment (`[ERROR] Command failed … git checkout dev … Aborting`, then "WARNING: Failed to checkout dev"). Root cause: `npm install` on the deployment box (whose npm version differs from the one that produced the committed lockfiles) rewrites the tracked `package-lock.json` files, so the working tree is dirty by the time the NEXT update runs — and the updater ran its stash helper (`discard_repo_local_changes`) **after** the `git checkout` instead of **before** it, protecting the pull but leaving the checkout to hit the dirty tree and abort. The updater became unable to update itself past any dirty tree.
  - The stash now runs **before every `git checkout`** at all three call sites: the initial update path (`clone_repo`), the in-app update flow (`checkout active branch`), and the **channel switch** flow (dev ↔ main). Nothing is destroyed — the auto-stash keeps a recoverable copy on the box (`git stash list` inside /opt/chatdesk), and a clean tree simply produces "No local changes to save" and moves on.
  - Recovery for the affected box: re-run the dev one-liner (`curl -fsSL https://raw.githubusercontent.com/MASolutionExpert/chatdesk/dev/scripts/install.sh | REPO_BRANCH=dev bash`) — the freshly downloaded script stashes first and the checkout succeeds.

**Tests:** `bash -n scripts/install.sh` clean; stash-before-checkout ordering verified by inspection at all three call sites; no server/client code touched (previous suites unchanged: 1371 server + 433 client green).

**خلاصهٔ فارسی:** آپدیت‌کننده روی نصب‌های خودمیزبان دیگر کار نمی‌کرد و با خطای «Your local changes … would be overwritten by checkout: package-lock.json» متوقف می‌شد. علت: `npm install` روی سرورِ استقرار، فایل‌های `package-lock.json` تحتِ گیت را بازنویسی می‌کند (نسخهٔ npm سرور با نسخهٔ سازندهٔ lockfile ها فرق دارد) و درخت کاری موقع آپدیتِ بعدی آلوده (dirty) است — ولی آپدیت‌کننده دستور stash را **بعد از** `git checkout` اجرا می‌کرد نه **قبل از** آن؛ یعنی فقط pull محافظت می‌شد و checkout روی درخت آلوده متوقف می‌شد. اصلاح: stash حالا در هر سه مسیر (آپدیت اولیه، جریان آپدیت درون‌برنامه‌ای، و سوییچ کانال dev↔main) **قبل از** هر checkout اجرا می‌شود. هیچ‌چیز از بین نمی‌رود — نسخهٔ خودکار stash روی سرور قابل بازیابی است (`git stash list` داخل /opt/chatdesk). **برای رفع فوری روی سرور:** یک‌لاینر dev را دوباره اجرا کنید — اسکریپتِ تازه‌دانلودشده اول stash می‌زند و checkout موفق می‌شود.

## 1.6.0-dev.3

### Fixed

- 🛡️ **"Close ticket" and "Refer" disappeared from the chat page entirely — root cause identified: the install ended up on the stable (main) channel, which predates the whole helpdesk ticket UI.** The dev.2 code was verified end-to-end in a real browser against a real server (login → ticket → strip → referral dialog) on desktop AND mobile viewports, for both the DM-shaped ticket and a referred support group: the strip, the Refer dialog, the department accordion, and the inTicket badges all render and function. The ticket strip is **absent from main by design**: main is v1.3.0, which has no `tickets` table (migration 045), no ticket strip, and no referral endpoint — so any install that checks out main (e.g. via the updater's **Channel switch** to the stable channel) loses BOTH buttons at once while everything else keeps working, exactly matching the report. Two changes shipped so this cannot bite silently again:
  - **Channel switch now warns before downgrading** (dev → main): the updater prints the target main version, states explicitly that dev-only features (helpdesk ticket UI, referral, …) will disappear until promoted, and requires a separate confirmation before checking out main.
  - **The ticket strip's render gate is now defensive** in the client: the strip renders when the chat is tagged `channel: "support"` **or** still carries ticket furniture (`ticket_status` / a `department_id`) — those fields exist only on helpdesk threads, so a chat list restored from a stale IndexedDB offline cache that is missing the `channel` field can no longer make the strip silently vanish. Messenger chats never carry either field, so the gate stays exact.

**Tests:** 433 client unit tests green, ESLint clean; `bash -n scripts/install.sh` clean; end-to-end verified in a real browser (desktop 1280px + mobile 390px: strip, dialog, search, department accordion all working — screenshots taken during verification). Server suite untouched (1371 tests, previous run).

**خلاصهٔ فارسی:** ناپدید شدن کامل دکمه‌های «بستن تیکت» و «ارجاع» ریشه‌یابی شد: کدِ 1.6.0-dev.2 در مرورگر واقعی (دسکتاپ و موبایل، تیکت معمولی و گروه ارجاع‌شده) به‌طور کامل تست شد و همه‌چیز درست کار می‌کند. علت: کانال **main (پایدار)** نسخهٔ 1.3.0 است و اصلاً رابط تیکت/ارجاع را ندارد — اگر نصب به main سوییچ کند (مثلاً با گزینهٔ Channel switch در منوی آپدیت)، هر دو دکمه یک‌جا حذف می‌شوند. دو تغییر انجام شد: (۱) هنگام سوییچ dev→main آپدیت‌کننده حالا هشدار «کاهش قابلیت» می‌دهد و تأیید جداگانه می‌خواهد؛ (۲) نوار تیکت در کلاینت حالا حتی اگر فیلد `channel` در داده‌های کش‌شده قدیمی نباشد، با `ticket_status`/`department_id` هم تشخیص داده می‌شود و ناپدید نمی‌شود. **اگر روی سرور شما هم دکمه‌ها نیست:** در منوی آپدیتر چک کنید کانال فعلی چیست (Status یا `cat /opt/chatdesk/VERSION`)؛ اگر 1.3.0 است، با همان گزینهٔ Channel switch به کانال Test (dev) برگردید و Rebuild & Restart بزنید — نسخه باید 1.6.0-dev.3 شود و همهٔ امکانات تیکت برمی‌گردد.

## 1.6.0-dev.2

### Fixed

- 🚨 **The referral picker's HTTP 500 on PostgreSQL is fixed — the true production root cause behind "no operators, no departments, search finds nothing" on every self-hosted install.** The candidates endpoint (`GET /api/support/tickets/:chatId/refer-candidates`) crashed with `ERROR: column "last_interaction" does not exist` on PostgreSQL: the candidate directory query's `ORDER BY` referenced the **`last_interaction` output alias inside an expression** (`"(last_interaction IS NULL) ASC, last_interaction DESC, …"`), and PostgreSQL only allows an output column name to **stand alone** in `ORDER BY` — never inside an expression. SQLite resolves aliases anywhere in `ORDER BY`, which is exactly why **all 1,366 unit tests stayed green** while production returned 500 on every open of the dialog. The chain is now fully explained: dev.8's client consumed the raw `fetch` `Response` (fixed in 1.6.0-dev.1), and *behind* it the server 500'd on PostgreSQL — dev.9's "empty picker" and dev.1's visible "Request failed (500)" were the same server crash surfacing through different client behaviors.
  - The ordering is now expressed by **inlining the full correlated subquery** everywhere it is needed (SELECT list + both ORDER BY terms) instead of referencing the alias — valid on SQLite AND PostgreSQL, matching the codebase's existing chat-list ordering convention. "Recent contacts first, never-talked-to last" behaves identically on both engines (SQLite has no `NULLS LAST`).
  - The query construction is extracted into an exported `buildStaffReferCandidatesQuery(knexInstance, …)` so tests can compile it with **both knex dialects** — no more "green on SQLite, dead on PostgreSQL" blind spots.

**Tests:** 143 files / 1371 server tests — five new regression tests in `test/db/staffReferCandidatesDialect.test.js` pin the exact outage: compiling the builder with a **pg** client asserts the `ORDER BY` never references the `last_interaction` alias (only the inlined subquery), keeps the `AS last_interaction` projection for normalization, and lines up the actor binding (1× SELECT, 2× ORDER BY); a real-SQLite scan suite asserts the full unbanned staff directory, department name/last-interaction fields, exclusion of the actor/banned/customers, and recent-contacts-first ordering. 433 client unit tests green (client untouched in this release). ESLint clean.

**خلاصهٔ فارسی:** خطای HTTP 500 پنجرهٔ ارجاع روی PostgreSQL رفع شد — ریشهٔ اصلی «هیچ اپراتوری نمی‌آید، هیچ دپارتمانی نمی‌آید، جستجو هم چیزی پیدا نمی‌کند» در نصب‌های واقعی. پرس‌وجوی فهرست اپراتورها در بند `ORDER BY` از نام مستعار خروجی `last_interaction` **داخل یک عبارت** استفاده می‌کرد (`(last_interaction IS NULL) ASC`)؛ PostgreSQL اجازه نمی‌دهد نام مستعار داخل عبارت بیاید (فقط به‌تنهایی مجاز است) و با خطای `column "last_interaction" does not exist` کل درخواست را 500 می‌کرد. SQLite این محدودیت را ندارد — برای همین هر ۱۳۶۶ تست واحد سبز بود ولی سرور در تولید 500 می‌داد. حالا عبارت کامل subquery به‌جای نام مستعار در همه‌جا (SELECT و ORDER BY) درج می‌شود که روی هر دو دیتابیس معتبر است؛ مرتب‌سازی «مخاطبان اخیر اول» روی هر دو موتور یکسان کار می‌کند. پنج تست رگرسیون جدید با کامپایل pg (نه SQLite) دقیقاً همین خطا را قفل می‌کنند تا دیگر «تست سبز، تولید مرده» تکرار نشود.

## 1.6.0-dev.1

### Fixed

- 🚨 **The referral picker actually loads its data now — the root cause of "no operators, no departments, search finds nothing" is fixed.** The dev.8 client helpers called the raw `fetch` wrapper and consumed the **`Response` object itself as if it were the parsed body** (`apiFetch` never parses JSON — every other call site in the codebase does its own `res.json()`). So `result.candidates` / `result.departments` were *always* `undefined` on every install, the picker rendered its empty state no matter how many operators or departments existed, and search "never recognized operators". Three helpers in `chatApi.js` now parse the body and **throw with the server's message on HTTP errors** via a shared `readJson`:
  - `fetchReferCandidates` → parsed `{ candidates, departments }`;
  - `referTicket` → parsed handoff result — rejections (unknown ID `404`, already a member `409`, closed ticket…) previously vanished silently and the modal closed pretending success;
  - `setTicketStatus` → parsed `{ chatId, ticketId, status, changed }` — the old code read `result.status` off the Response, which is the **HTTP code (200)**, not `"open"`/`"closed"`, feeding garbage into the ticket-strip state.
- 🧹 **The redundant "Refer by ID or username" input is removed** — the top search box already covers it: it matches username, nickname, and the operator's **ID (UUID)** across the full staff directory. One input, one purpose, no duplicated UX.

**Tests:** 40 files / 433 client unit tests — six new contract tests in `chatApiHelpdesk.test.js` pin the exact regression: helpers must resolve to parsed data (never a Response) and must throw with the server's message on 403/409/400. Server untouched. Docs: `docs/Helpdesk-Setup.md` (+ FA) updated to the two-way picker.

**خلاصهٔ فارسی:** ریشهٔ واقعی باگ «اپراتوری برای ارجاع وجود ندارد» پیدا و رفع شد: هلپرهای کلاینت خروجی خام `fetch` (شیء Response) را به‌جای دادهٔ JSON مصرف می‌کردند، پس `candidates` و `departments` همیشه undefined بودند و انتخابگر روی هر نصبی خالی می‌ماند. حالا هر سه هلپر (`fetchReferCandidates`، `referTicket`، `setTicketStatus`) بدنه را parse می‌کنند و روی خطای HTTP با پیام سرور خطا پرتاب می‌کنند — قبلاً خطاهای سرور (مثل «اپراتور پیدا نشد» یا «از قبل عضو است») بی‌صدا نادیده گرفته می‌شدند و `setTicketStatus` به‌جای وضعیت تیکت، کد HTTP یعنی ۲۰۰ را به UI می‌داد. کادر تکراری پایین پنجره هم حذف شد — کادر جستجوی بالا با نام کاربری، نام مستعار و شناسهٔ (UUID) اپراتور کار می‌کند.

## 1.5.0-dev.9

### Fixed

- 🧭 **Ticket referral picker reworked — the "no operators available" dead end is gone.** Two real defects surfaced in production and both are fixed from the root, without touching any other referral logic:
  - **The picker no longer starves itself of candidates.** The candidates endpoint used to exclude the actor *plus everyone already inside the thread*; combined with the "Recent contacts first" sort this could leave an empty-feeling list ("no operator found") in small deployments. `GET /api/support/tickets/:chatId/refer-candidates` now returns the **full staff directory** (every unbanned operator/owner except the actor), and staff who are already members of the thread stay listed but carry an `inTicket: true` flag — the picker shows them **disabled** with an "In this ticket" badge instead of hiding them (the server still refuses them with `409`).
  - **The Cancel button rendered a raw translation key** (`common.cancel` — the key actually lives at `common.actions.cancel`). Fixed; the dialog now shows a real localized label in both UI languages.
  - **A new department → operator browser** inside the same dialog: the endpoint now also returns the full **active department list**, and with an empty search the picker shows "Recent" contacts plus a **"Browse by department"** accordion — click a department to unfold its complete operator list (alias first, department color dot, live operator count). Operators without a department get their own "No department" group, so the picker is never empty while staff exists.
  - **Direct handoff by ID or username**: a dedicated input at the bottom of the dialog accepts an operator **ID (UUID)** or **@username** — a UUID is sent as `operatorId`, anything else as `operatorUsername`, and the server keeps validating the target (staff-only, unbanned, not self, not already in the ticket). Typing in it clears the list selection and vice versa; the **Refer** confirm button works for both paths.
  - **The ticket status strip lost its stray white outline**: the strip around the open-state label and the Refer/Close buttons drew a `border` without a color, which Tailwind v4 resolves to `currentColor` — a bright ring in dark mode. The border is removed and replaced by a barely-there surface tint; the layout is unchanged.

**Tests:** 142 files / 1366 server tests (refer-candidates contract re-pinned: full directory minus self, `inTicket` flags for thread members, active-only department list) and 427 client unit tests — all green; ESLint clean. Docs: `docs/Helpdesk-Setup.md` (+ FA) picker chapter updated.

**خلاصهٔ فارسی:** دو باگ واقعی ارجاع تیکت از ریشه رفع شد. انتخابگر ارجاع دیگر خالی نمی‌ماند: سرور حالا کل فهرست پرسنل (به‌جز خود ارجاع‌دهنده) را برمی‌گرداند و اپراتورهایی که از قبل در تیکت هستند با نشان «در همین تیکت» نمایان ولی غیرفعال می‌مانند. باگ نمایش متن خام `common.cancel` روی دکمهٔ لغو هم اصلاح شد. داخل همان پنجره یک مرورگر «دپارتمان → اپراتور» اضافه شد: روی هر دپارتمان بزنید تا فهرست کامل اپراتورهایش (نام مستعار اول، با نقطهٔ رنگ دپارتمان و شمار اپراتورها) باز شود؛ اپراتورهای بدون دپارتمان در گروه «بدون دپارتمان» می‌آیند. یک کادر «ارجاع با شناسه یا نام کاربری» هم اضافه شده که شناسهٔ اپراتور (UUID) یا @نام‌کاربری را می‌پذیرد و سرور همچنان اعتبار هدف را بررسی می‌کند. در نهایت حاشیهٔ سفید اضافی دور نوار وضعیت تیکت (بستن/ارجاع) حذف شد.

## 1.5.0-dev.8

### Added

- 🔁 **Ticket referral — hand a ticket to another operator and share the thread as a support group.** From the chat window's ticket strip (next to **Close ticket**), staff members now see a **Refer ticket** button (customers never do). The picker lists available operators sorted by **recent contact** (latest exchanged message first) and supports lookup by username, nickname, or user ID. On confirm, one server-side endpoint does the whole handoff:
  - **In-place conversion** (`POST /api/support/tickets/:chatId/refer`): the DM-shaped support thread becomes a **private support group** that keeps its support identity (channel `support` + department tag) — full messenger-group parity (invite link, avatar, member management, settings) while still showing the red-headset "Ticket" badge in the admin panel and the chat window. Reports, admin type filter, and department overview were extended so referred tickets never disappear from the helpdesk surfaces.
  - **Ownership moves with the ticket**: the referred-to operator joins as the group owner and becomes the ticket's operator of record — fair routing counts the open ticket against their workload. Referring again adds further operators; every staff member in the thread can read and reply. The customer is demoted to a plain chat member, a `[[system:referred:<name>]]` message marks the handoff in-thread, and the target operator receives a push notification.
  - **Guards** (backend-first, fully tested): only staff may refer (`403` for customers); messenger chats are refused (`400 not_a_ticket`); closed tickets, non-staff targets, self-referral, and already-member targets are refused; non-member operators get `403`. Candidates endpoint (`GET .../refer-candidates`) is staff-only and excludes the actor plus everyone already in the thread.
  - **Ticket-thread protection** (extends the owner-only deletion policy to the new shape): `hide` (delete thread) and group hard-delete stay **owner-only** for support groups — even the operator who owns the support group gets `403`; the customer can never be dropped (remove-member refuses, group-settings member sync silently restores them); the last staff member cannot abandon the thread by leaving, and staff ownership on leave passes to another staff member — never to a customer. A fresh support request from the same customer always opens a new ticket; a referred group is never silently reused.

**Tests:** 142 files / 1365 server tests (new `supportRefer.test.js`: conversion, role demotion/ownership, operator-of-record re-pointing, system message, realtime fan-out, all guards, and the four referred-ticket protections), 427 client unit tests — all green. Docs: `docs/Helpdesk-Setup.md` (+ FA) — new "Ticket referral" chapter, Admin API table additions, stale role lists corrected to `user | operator | owner`.

**خلاصهٔ فارسی:** ارجاع تیکت اضافه شد — دکمهٔ «ارجاع تیکت» در نوار وضعیت تیکت (فقط برای اپراتورها و owner، نه مشتری‌ها) تیکت را به اپراتور دیگری می‌سپارد؛ انتخابگر بر اساس مخاطبان اخیر مرتب می‌کند و جستجو با نام کاربری/شناسه هم کار می‌کند. با تأیید، ترد پشتیبانی در جا به یک گروه پشتیبانی خصوصی تبدیل می‌شود که همهٔ تنظیمات گروه مسنجر را دارد ولی تگ تیکت/دپارتمانش حفظ می‌شود؛ اپراتور مقصد مالک گروه و ثبت تیکت می‌شود و مسیریابی عادلانه بار را به حساب او می‌گذارد. حذف ترد و گروه همچنان فقط با owner است، مشتری هرگز از ترد حذف نمی‌شود، و آخرین عضو پرسنل نمی‌تواند ترد را با leave رها کند.

## 1.5.0-dev.7

### Changed

- 👥 **The role model is now exactly three roles — owner, operator, customer ("user"); the "admin" role is retired from the root.** The owner creates two kinds of accounts (Operator and Customer) and is the system owner themselves, so the intermediate "admin" role carried no real meaning while leaving dead branches in filters, badges, prompts, and permission checks. Removed end to end, backend-first:
  - **Migration 047** (`server/migrations/047-role-admin-to-operator.js`): every existing `admin` account is normalized to `operator` (staff) — case-insensitive, NULL-safe, idempotent; restored old backups re-run it automatically through the migration tracker. Tested in `server/test/migrations/047-role-admin-to-operator.test.js`.
  - **Admin panel is owner-only**: the panel middleware, `requireAdmin`, avatar-upload bypasses, and the impersonation-return gate now check `isUserOwner` (the retired `isUserAdmin` helper is deleted from `db.js`). Operators are staff inside the messenger/tickets and never touch the panel — matching what the UI already showed.
  - **Emergency claim**: the first claim still mints the owner; a claim while an owner exists now promotes to `operator` (not "admin"), and the lockout gate (`adminClaimAvailable`) checks for an owner, not "any admin/owner".
  - **Role assignment** (`POST /api/admin/users/:id/role`, user create/edit): allowed values are `user | operator | owner`; the "admin" option is gone from the panel modal, the Users-tab role filter (which also **gained the missing Operator filter** — the reported gap), the CLI prompts (`chatdesk-deploy` → Manage Database, `db:user:create/edit`), and `bootstrapAdminUsers` (now promotes to operator).
  - **Client parity**: the Users tab role filter offers Customer / **Operator** / Owner / Banned; the account-type modal offers Customer/Operator in create AND edit mode; the "Server Admin" shield badge and role chip are removed (the retired role renders nothing); profile badges highlight Owner + Operator; the admin-panel entry points and the moderation (edit) gate treat exactly `owner`/`operator` as staff.
  - Unchanged by design: the panel is still called "Admin Panel" (it is the owner's panel); owner protection, one-owner rule, deletion policy (1.5.0-dev.6), departments and ticket routing all keep working — operators were already the ticket-handling staff.

**Tests:** 141 files / 1350 server tests (new: migration 047 normalization/idempotency/NULL-safety; contract re-pinned: owner-only panel gates, claim → operator, role endpoint without "admin"), 427 client unit tests — all green. Docs: `docs/Admin-Panel.md` (+ FA) — three-role model, owner-only panel, claim behavior; `AGENTS.md` — new Role Model law and the DB/Migration Compatibility Law.

## 1.5.0-dev.6

### Changed

- 🔒 **Deletion is now owner-only — messages, tickets, and threads.** ChatDesk is an organizational messenger and a ticketing system, so destructive deletion is reserved for the instance owner alone; admins and operators previously held far-reaching delete powers inherited from the old "moderator" model. Audited surfaces, all now owner-only (everything else keeps working):
  - **Messages** (`POST /api/messages/delete`): only `role: owner` may delete — for everyone or for self. Admins and operators get `403 "Only the owner can delete messages."` (previously they could delete anyone's message for everyone). The owner may delete in any chat without being a member — they are not a member of most tickets. The old group-owner/author/can-post branches are gone.
  - **DM threads & support tickets** (`POST /api/chats/hide`): the "delete thread" action on DM-type chats (every support ticket) is owner-only — admins and operators are rejected like regular users. Group/channel hide stays available to members as leave-and-list-cleanup.
  - **Admin panel chat delete** (`DELETE /api/admin/chats/:id`): full chat/ticket deletion required only `requireAdmin` — any admin could wipe any ticket for everyone. Now `403 Owner access required` unless the actor is the owner.
  - **Admin panel Danger Zone** (`POST /api/admin/maintenance/clear-messages`): wiping the entire message history is owner-only; the "Clear all messages" action is hidden for admins/operators.
  - **Client parity**: the messenger delete menus (`canDeleteMessages`, DM-thread delete, bulk selection filter, delete-for-everyone) and the panel's Chats-tab delete buttons follow the same rule, so non-owners never see an action the server would refuse.

**Tests:** 140 files / 1345 server tests (message-delete contract re-pinned to owner-only incl. non-member owner deletion; hide policy re-pinned: operator/admin 403 on DM threads, owner audited), 427 client unit tests — all green. Docs: `docs/Admin-Panel.md` (+ FA) — owner-privilege bullet, Chats/Delete + Danger Zone notes, and a new "Deletion Policy (owner-only)" table.

## 1.5.0-dev.5

### Added

- 🛠️ **New "Rebuild & Restart" deploy-menu option (`r`).** The Update option only rebuilds when the remote has newer commits — source pulled by hand (or an aborted update) left the running services out of sync with the source tree with no menu path to fix it. The new option re-runs the full source finalization pipeline **without pulling new code and without the "already up to date → downgrade?" prompt**: server/worker/client dependencies, client build, database schema sync, systemd unit refresh, service restarts and nginx reload — with the same failure recovery as the update flow. Docs: `docs/Deployment-Script.md` menu table updated.

## 1.5.0-dev.4

### Fixed

- 🔧 **Updates no longer abort with "Your local changes would be overwritten by merge".** `npm install` on the deployment box rewrites the tracked `client/package-lock.json` / `server/package-lock.json` files, so the next `git pull --ff-only` refused to merge and every update failed until the tree was cleaned by hand. The updater now **auto-stashes** local source modifications (tracked + untracked) before every fast-forward pull — in the update flow, the channel switch flow, and the installer's own repo-sync step. The stash keeps a recoverable copy on the box (`git stash list` inside `/opt/chatdesk`); a clean tree simply moves on. Docs: `docs/Deployment-Script.md` update section updated.

## 1.5.0-dev.3

### Fixed

- 🎫 **Admin chats: ticket threads are now labeled "Ticket", not "Direct messages".** The admin panel's Chats (Messages) tab stamped every support ticket with BOTH labels — the stored chat type is `dm`, so the Type column said "Direct messages" while a second badge said "Ticket". `adminListChats` now derives an explicit **`isTicket`** classification (support-channel DM) on every row; the panel shows a rose headset icon with "Ticket" / «تیکت» in the Type column and the ticket's **department** next to the SUPPORT badge (instead of a duplicate ticket label). Messenger DMs, groups and channels are untouched.
- 📊 **The operator first-response metric is credited to the operator who ACTUALLY answered, not to whoever the ticket was routed to.** In 1.5.0-dev.2 the per-ticket first-response sample rode the ticket row's `operator_id` — the operator fair routing picked **at creation time**. When a different operator answered the ticket (the reported case: a new ticket, answered, and the answering operator's card still showed "—"), the sample landed on the assigned operator and the responder got nothing. The sample now always belongs to the **author of the first staff reply**; only when that author is not on the department roster (a passing admin, a departed operator) does it fall back to the ticket's recorded operator. Conversation-level metrics (assigned / answered / unanswered) still follow the ticket row.

**Tests:** 140 files / 1340 server tests (new: off-roster first-reply fallback, explicit `isTicket` list classification; the "someone else replied first" contract re-pinned to author attribution), 427 client unit tests — all green. Docs: `docs/Helpdesk-Setup.md` metric attribution rewritten (EN + FA), `docs/Admin-Panel.md` Chats tab updated.

## 1.5.0-dev.2

### Changed

- 📊 **The department-report response metric now follows the classic helpdesk definition, end to end.** After operator feedback on 1.5.0-dev.1 (which measured a per-reply latency that blurred the picture), the metric is back to **first response per ticket**, exactly as admins expect it:
  - **Per operator** — mean of (first staff reply − ticket creation) over the operator's **own tickets created in the selected range** (the time-filter / Today / 7-day / 30-day presets all apply). One sample per ticket; tickets with no reply yet stay out of the average.
  - **Department total** — the same average over **ALL answered tickets of the range**, i.e. the combined performance of all its operators (ticket-weighted, not a simple mean of operator means).
  - A first reply written after the window end still belongs to its in-range ticket ("the average of all tickets of the range").
  - ➕ **New "First responses" tile on each operator card** — the number of their in-range tickets that received a reply, i.e. the sample size behind the average, so the figure is verifiable at a glance.
  - `docs/Helpdesk-Setup.md` metric table rewritten (EN + FA); API contract returns `firstResponses` / `avgFirstResponseSeconds` per operator again.

**Tests:** 140 files / 1338 server tests (aggregation contract re-pinned: per-ticket attribution incl. "someone else replied first", multi-ticket operator average, post-window first reply inclusion), 427 client unit tests — all green.

## 1.5.0-dev.1

### Fixed

- 📊 **The operator "Avg response time" in the department report now really measures the operator's own performance** (dev series carry: `1.4.0-dev.9` → `1.5.0-dev.1`). Three root causes fixed in `server/lib/supportReport.js`:
  1. **Misattribution** — response-time samples were credited to the ticket's *assignee*, not to whoever actually wrote the reply: an operator who never replied inherited someone else's latency, while the operator who did reply showed "—". Response times are now attributed to the reply's **author** (if on the department roster); conversation ownership (assigned / answered / unanswered) still follows the ticket.
  2. **Wrong latency basis** — the metric measured (first staff reply − chat creation), one sample per conversation, ignoring every later reply. The operator metric is now **per-reply**: every staff reply authored in the range that answers a *pending* customer message counts, latency = reply − the latest pending customer message, and any staff message resolves the pending request (consecutive staff replies without a new customer question score only the first one). Pending requests may span the range boundary (asked in May, answered in June — the June reply still counts, any chat age).
  3. **Out-of-window samples** — the department's "Avg first response" also counted first replies written *after* the window ended (a chat created June 30, answered July 2 inflated the June average). The department total now only counts first staff replies written inside the range. The operator card label became "Avg response time" / «میانگین زمان پاسخ»; the department total keeps "Avg first response" / «میانگین اولین پاسخ».

**Tests:** 140 files / 1339 server tests (4 new: author-not-assignee attribution, per-reply latency incl. consecutive-reply and window-boundary cases, and out-of-window first-reply exclusion; contract updated to `responses` / `avgResponseSeconds`), 427 client unit tests. Docs: `docs/Helpdesk-Setup.md` metric table rewritten (EN + FA).

## 1.4.0-dev.9

### Added

- ⏳ **Time filter for the admin Chats tab — the same precise range filter as the helpdesk.** From/to date inputs plus **Today / Last 7 days / Last 30 days / All time** presets now filter the chat list by creation date. Backend-first: `GET /api/admin/chats` accepts `createdFrom` / `createdTo` (strict `YYYY-MM-DD`, anything else → 400) and `adminListChats` applies the window in SQL with bounds engineered for the column's MIXED timestamp formats — SQLite's `"YYYY-MM-DD HH:MM:SS"` and ISO `"YYYY-MM-DDTHH:MM:SSZ"` both sort after the bare date prefix (inclusive `>= from`), and the `to` bound is the exclusive next-day start so a late-night ISO timestamp on the last day is still included. UTC day boundaries, matching the support report.

### Changed

- 🎫 **"Support messages" added to the Chat Type filter, right under "Direct messages"** — selecting it surfaces the helpdesk ticket threads (support-channel DMs). Backend: `type=support` maps to `type='dm' AND channel='support'` server-side (the redundant standalone channel filter section was removed from the UI since the type filter now covers it; the `channel` API parameter still works).

### Fixed

- 👥 **The group/channel edit modal now shows the EXISTING members.** Previously, editing a group that visibly had members in the chat list opened an edit page with an empty member selection — the admin could never see the current membership. The modal now loads `GET /api/admin/chats/:id/members` on mount and renders every existing member as a selected chip (the owner stays in the OwnerPicker). The chips are now a real membership editor: kept chips are no-ops on save, removed chips delete the member (`DELETE /api/admin/chats/:id/members/:userId`), new chips add them — with guards so ownership transfer (which rides the PATCH) is never clobbered.

**Tests:** 140 files / 1335 server tests (6 new: real-SQLite integration for the support-type filter and the mixed-format date window incl. spanning/out-of-range/intersect cases, plus API param-passthrough and 400-on-bad-date), 427 client unit tests, **556 client browser tests** — the CI Browser job failure of 1.4.0-dev.8 is also fixed here: the Emergency Claim UI suite is re-pinned to the new gating contract (lockout-only form, Access denied on healthy installs, monitoring sessions never see the form).

## 1.4.0-dev.8

### Fixed

- 🔐 **Security hardening round 2 — the "/admin Emergency Claim" leak, the parked-owner-session logout gap, and two brute-force surfaces, all closed.** **(1) The Emergency Claim token form is no longer shown to everyone.** Any logged-in non-admin who opened `/admin` — including a monitoring session created through the owner's "Log in as user" (which is exactly what appeared when pressing the browser Back button after entering a user's panel) — was greeted by the "Emergency Claim / Admin API Token" prompt. The server was never at risk (the claim endpoint still requires the real token), but the UI leaked the mechanism's existence to every user and offered a probing surface. The client now renders the form ONLY when the server reports a genuine lockout: a new `adminClaimAvailable` field on `GET /api/app/info` (true **only** when `ADMIN_API_TOKEN` is configured AND no admin/owner exists, failing closed on any error) gates the form; every other case renders a bilingual "Access denied" card with a back button, and monitoring sessions are additionally hard-redirected from `/admin` back to the chat — no admin UI at all renders for an impersonation session. **(2) Logging out while monitoring no longer leaves the owner session alive.** `POST /api/logout` now also destroys the owner session parked in the HttpOnly `admin_sid` cookie and clears that cookie (previously the parked session survived up to 14 days in the browser and the session store — an unnecessary risk window). **(3) Brute-force hardening:** the emergency claim endpoint gets its own strict bucket (**10 attempts / 15 min per IP**, previously it rode the 3000/15min admin budget — enough for a human, useless for token guessing), and `/api/login` + `/api/register` get a dedicated **50 / 15 min** bucket so credential stuffing cannot ride the shared chat budget. **(4) Back/forward-cache stale identity:** a bfcache restore (browser Back/Forward) can resurrect a page whose rendered identity no longer matches the session cookie; the app now reloads on `pageshow` with `persisted=true` so `/api/me` re-syncs the identity with the server. Suite: 139 files / 1326 server tests (9 new: claim-gate matrix incl. fail-closed + parked-session logout + defensive same-token edge), 427 client unit tests, 35 worker tests green.

## 1.4.0-dev.7

### Added

- 👤 **Owner impersonation — "Log in as user" lands in the admin panel's Users tab.** The owner can now click the new login button on any user row and drop straight into that user's own app view — no password, no username, one click — for supervision and monitoring. Security is enforced server-first, not by hiding buttons: `POST /api/admin/users/:id/impersonate` hard-gates on the owner role (`owner_only` for anyone else), refuses the owner account itself (`owner_protected`), banned users, self-impersonation and unknown ids; it mints a fresh random session for the target user, parks the owner's real session in a dedicated HttpOnly `SameSite=Lax` `admin_sid` cookie, and never reads, exposes or touches any password. Every minted session is stamped with the acting owner's id (new additive, nullable `sessions.impersonated_by` column — migration 046, guarded ALTER, compatibility sweep per AGENTS.md rule 13), `/api/me` surfaces that stamp as `impersonatedBy`, and the client shows a persistent amber monitoring banner with a "Return to admin panel" button. The return endpoint (`POST /api/admin/impersonate/return`) lives outside the normal admin gate (the working session belongs to the impersonated user) and re-verifies everything itself: the parked cookie must resolve to a live admin/owner session, and the working session must be an impersonation session stamped by THAT owner — a fresh login can never be revoked by a stale parked cookie. On return the owner's session is restored, the minted session is revoked, the side cookie cleared, and both directions are written to the admin audit log (`user.impersonate`, `user.impersonate_return`). Suite: 138 files / 1317 server tests (13 new: full API security matrix + real-SQLite integration for the stamp), 427 client unit tests, 35 worker tests green.

### Changed

- ✂️ **The promote/demote shield buttons are gone from the Users tab.** The inline admin shield toggle (promote to admin / demote from admin) is removed entirely from every row branch — mobile and desktop — because role changes already live in the edit modal, and the duplicate shield was cluttering the list. Role management is unchanged in behavior (`POST /api/admin/users/:id/role` and the edit modal still work exactly as before); the list row is now edit, owner-only "Log in as user", ban, delete. The now-orphaned i18n keys (`promote`, `promoteMsg`, `demote`, `demoteMsg`, `errSelfRole`, `errRoleOwner`, `errRoleAdmins`, `errRoleBanned`, `errDemoteOwner`) were removed from both the English and Persian dictionaries, and `admin.users.loginAs` ("Log in as user" / «ورود به عنوان کاربر») plus the monitoring-banner strings were added bilingually.

## 1.4.0-dev.6

### Fixed

- 🔎 **Full compatibility audit of migration 036 (UUID primary keys) — two more silent Number()-on-UUID bugs found and fixed.** Following the department-report "only the last operator" incident, the ENTIRE codebase was swept for every consumer of the UUID-converted columns (`users.id`, `chats.id`, `chat_messages.id` and all ~25 referencing FKs across `chat_members`, `sessions`, `push_subscriptions`, `tickets`, `admin_audit_logs`, …): every Map/Set key, equality check and SQL binding that coerced a UUID through `Number()`. Two additional real bugs surfaced and are fixed. **(1) The diagnostics chat snapshot (`lib/inspect.js`) reported 0 members for every chat** — it converted chat ids with `Number()`, the member `whereIn` matched nothing, and the per-chat member grouping collapsed onto NaN; it now keys by the raw string UUIDs (verified by new tests that feed real UUID shapes and assert both the grouping and the SQL bindings stay raw). **(2) The startup message-body encryption backfill (`index.js`) silently never encrypted legacy plaintext** — its `UPDATE chat_messages … WHERE id = Number(row.id)` produced `WHERE id = NaN`, matching no row on every boot; the decision logic is now extracted into the pure, testable `lib/storageEncryptionBackfill.js` (`planMessageBodyEncryption`) whose contract pins that the update addresses the RAW id. Everything else audited clean: department ids are legitimately numeric, `remote_channel_*` / `chat_message_files` ids are INTEGER by design, the Postgres INT8 parser only touches bigint flags/counts, and the client (React) uses no numeric coercions on user/chat/message ids. The audit checklist is now a permanent agent law — **AGENTS.md rule 13: "Schema/migration compatibility sweep"** — every future fundamental data-structure change must enumerate affected columns, grep every consumer in `server/` AND `client/`, fix each, and pin the change with tests using real production-shaped fixtures (numeric test ids are what hid this whole bug class in the first place). Suite: 136 files / 1301 server tests, 427 client unit tests green.

## 1.4.0-dev.5

### Fixed

- 🐛 **The department report shows EVERY operator again — the "only the last operator has performance" bug is fixed.** Since migration 036 the `users`, `chats` and `chat_messages` primary keys are TEXT UUIDs, but the support-report aggregation keyed every internal map by `Number(id)` — and `Number("uuid")` is `NaN`. Because JavaScript Maps match `NaN` via SameValueZero, ALL operators, chats, messages and tickets collapsed onto a single "last row wins" bucket: the department page rendered exactly one operator card (the last one on the roster) holding everyone's numbers, per-chat histories merged into one, and staff/customer classification judged by the last user's role. Every key is now `String(id)` (departments keep their INTEGER ids and stay numeric), the message-history query no longer converts chat UUIDs through `Number()` (which silently emptied the `WHERE chat_id IN (...)` clause), and the same NaN pattern in the support overview's legacy fallback (`lastMessageByCustomer` / ticket-open heuristic) now compares ids as strings too. The gap that hid all of this is closed at both layers: three new aggregation tests feed the report real production shapes (UUID user/chat/message ids, integer department ids) and would fail on the old code, plus a brand-new real-database integration suite that builds a department with three operators, real support chats, tickets and messages through the public `db.js` API and asserts the full db → aggregation path end-to-end (it was previously only ever tested through mocks). Suite: 135 files / 1294 server tests, 427 client unit tests green.

### Changed

- ✂️ **Operator report cards slimmed to the eight metrics that describe the person.** Each operator card on the department page drops the last two cards — "Staff replies" and "Customer messages" — keeping conversations (assigned), answered, unanswered, messages, tickets opened / closed / still open and average first response (2×4 grid). The department summary still shows the staff/customer message split; the server keeps computing every metric for both levels.

## 1.4.0-dev.4

### Changed

- 📈 **Per-operator report cards now show the full department-grade metric set.** On the dedicated department page, each operator card replaces the previous seven compact chips with the same ten server-computed metric cards used by the department summary: conversations (assigned), answered, unanswered, messages (every in-range message inside the operator's attributed conversations), tickets opened / closed / still open, average first response, the operator's own staff replies, and customer messages in their conversations. Three of these are new server-side metrics — `messagesInConversations`, `customerMessages`, and `openTickets` per operator — computed by the pure aggregation layer (still driver-neutral for SQLite and PostgreSQL) and covered by 2 new aggregation tests. Suite: 134 files / 1288 server tests, 427 client unit tests green.

## 1.4.0-dev.3

### Added

- 📊 **Department performance report — a dedicated, time-filtered reporting panel per department (backend-first).** The admin Helpdesk tab's "latest support conversations" list is gone (the full history already lives in the messages), and every department name in the summary now opens a dedicated department page: its operators, their status and performance at a glance, and a standard reporting panel with a precise time filter (from/to dates plus Today / 7 days / 30 days / All-time presets). The server owns every number: a new pure aggregation layer (`server/lib/supportReport.js`) computes, per department and per operator, conversations created in the range, messages authored in the range (staff vs customer split), tickets opened / closed / still open, answered vs unanswered conversations, and the average first-response time — all behind the new admin-only `GET /api/admin/support/report?departmentId=&from=&to=` endpoint (401/403 for non-admins, 404 for unknown departments, 400 for invalid ranges). The aggregation is driver-neutral: SQLite and PostgreSQL produce identical numbers, and mixed timestamp formats (SQLite `datetime('now')` vs ISO) normalize to the same UTC instants. A conversation is attributed to its ticket's operator, falling back to the author of the first staff reply for legacy chats. **Tests:** 19 new tests — 13 pure-aggregation tests locking the metric contract for both drivers, 6 API contract tests (auth, param validation, 404, payload passthrough). Suite: 134 files / 1286 server tests, 427 client unit tests green.

## 1.4.0-dev.2

### Added

- 👑 **The system owner: first-setup ownership, permanent protection, owner-only "What's new" (backend-first).** **First-setup rule:** the very first user registered on a fresh installation automatically becomes the **owner** of the whole system (role `owner`) — the permanent owner of everything. **Full access:** the owner has every capability in the project (admin panel, settings, departments, helpdesk, calls — everywhere `isUserAdmin`/role gates apply, the owner passes). **Permanent protection (server-enforced, `403 owner_protected`):** nobody through the app — admins, operators, regular users, and even the owner via the admin panel — can edit, ban, delete, re-role or password-reset the owner account; a second owner can never be promoted while one exists. **Changes to the owner account happen ONLY from the server's interactive menu** (`chatdesk-deploy` → Manage Database → Edit user), which runs directly on the server outside the web surface; the owner's own profile self-service (nickname, avatar, own password) stays available in-app. **"What's new" is owner-only:** a new `GET /api/app/whats-new` endpoint serves the per-version changelog payload exclusively to the owner session (everyone else gets `403 owner_only`), the public `/api/app/info` no longer carries changelog fields, and the client shows the per-version changelog popup and the "What's new" (امکانات جدید) settings entry only when the server granted the payload. **Tests:** new `server/test/api/ownerAccount.test.js` — 16 tests covering the first-setup rule, immutability for every mutation endpoint (admin and owner actors), the one-owner rule, middleware pass-through, and the owner-only what's-new contract. Suite: 1267 server / 427 client unit green.

## 1.4.0-dev.1

### Fixed

- 🐘 **Migration 045 now actually completes on PostgreSQL — "(existing || []).map is not a function" is fixed.** The production incident: on the user's Postgres server the migration created the `tickets` table and indexes, then crashed in the backfill step. Root cause: in Postgres mode the migration context queues every query onto a promise chain, so `getAll`/`db.run` return **Promises** — while migration 045's `up` was written synchronously and treated the result as a plain row array. SQLite mode (and the stubbed CI test context) returns plain arrays, which is why the whole suite was green in CI yet the migration failed on the real server, leaving schema version stuck at 44. The fix: `up` is now async and awaits every `getAll` and every `db.run` in both driver modes; insert errors now propagate to the migration runner instead of being silently swallowed by the chain's catch. **Safe to re-run on the affected server:** the migration is idempotent (`IF NOT EXISTS` + guarded backfill), the existing empty `tickets` table is detected and the backfill fills it — nothing else on the server was changed (schema still at v44, pre-migration backup was taken automatically).
- 🧪 New regression suite `server/test/db/tickets045PostgresBackfill.test.js` (6 tests) reproduces the exact production crash with a thenable (Postgres-style) context: async contract, error propagation, guarded backfill for the partially-applied server state, incomplete-chat skipping, and SQLite-mode equivalence.

## 1.3.0-dev.9

### Changed

- 📐 **New permanent agent law: backend-first build order (`AGENTS.md`).** Every new feature must now be born in the backend — database migration, server logic, API endpoints, authorization, SSE events, API tests — and only after that contract's tests pass may the UI for it be built. A frontend-only implementation (tags/badges/buttons rendering state the server does not own) is explicitly forbidden. This codifies the delivery order that produced the messenger/ticket separation (dev.8: migration 045 `tickets` table → lifecycle/close/reopen APIs → routing from the ticket table → 13 API tests → then the client lifecycle strip).

## 1.3.0-dev.8

### Changed

- 🎫 **Messenger and tickets are now two strictly separated message domains — with the ticket owning its own database table.** A deep backend/database audit found the only separation was the `chats.channel` tag: nothing stopped a customer from opening a direct (messenger) chat with an operator or admin via `POST /api/chats/dm`, completely bypassing department routing, fair assignment and the ticket lifecycle. Three layers now enforce the boundary. **Rules:** customers (role `user`) reach staff (operator/admin/owner) ONLY through the support-request flow (department → fairly-routed operator); the DM endpoint refuses customer↔staff pairs in both directions (403 `support_only`); user↔user and staff↔staff remain messenger flows. **Ticket registry (migration 045):** a new `tickets` table — one ticket per support chat — records customer, department, assigned operator and the open/closed lifecycle with `closed_at`; every existing support chat is backfilled (idempotently). **Lifecycle:** both parties can close or reopen a ticket from the chat window; a closed ticket stops accepting messages (403 `ticket_closed`) until reopened; fair routing now counts each operator's open tickets from the table instead of the old customer-replied-last message heuristic; the admin support overview reports per-chat ticket status. Messenger chats never have a ticket row — direct chats are not affected by the lifecycle at all. Existing legacy customer↔staff threads are left untouched (no data migration); they can no longer be re-opened through the DM endpoint.

### Security

- 🔒 The messenger boundary is now server-enforced, not just a UI convention: the customer→staff direct-message path returns a `support_only` error pointing users at the department picker.

## 1.3.0-dev.7

### Fixed

- 🧪 **CI browser tests are green again — 554 tests, zero 20-second locator hangs.** ChatDesk defaults its UI language to Persian, but component tests render bare components (no `LanguageProvider`) and assert the English labels ("Type a message", "Call failed", …), so every name-based locator (`getByRole("textbox", { name: /type a message/i })`) waited out the full 20-second test timeout — dozens of tests per file, until the whole CI job hit its 10-minute cap. The suite had never actually run in CI (repository Actions were disabled; the check only appeared on the first stable promotion). Three-part fix: the provider-less default i18n context now resolves the persisted language dynamically instead of a hard-coded `fa` (production always mounts the provider, so behavior is unchanged), a new browser-test setup (`client/test/setup/browser-i18n.js`) seeds `localStorage["chatdesk.uiLanguage"] = "en"` before any component mounts, and `ChannelBadge` — the one suite asserting Persian labels on purpose — re-seeds `fa` per test. Locally verified: chromium 51 files / 554 tests all green (MessageComposer now 0.6 s instead of 499 s), unit suite 427 green.

### CI

- ⏱️ The "Run client browser tests" step timeout is raised 10 → 15 minutes for chromium + firefox headroom (healthy runtime is now ~6 minutes).

## 1.3.0-dev.6

### Fixed

- 📊 **The dashboard's "App Memory" gauge is no longer permanently red.** It divided the Node process's live heap (`heapUsed`) by the *currently allocated* heap (`heapTotal`) — but V8's garbage collector deliberately keeps live usage **near** the allocated heap and grows it on demand, so a perfectly healthy process reads 85–95% there. That is exactly what the user saw: ~94% red while the machine had 3.8 GB free and zero leaks. The gauge now measures the heap against its **real ceiling** — the V8 heap limit (`heap_size_limit`, ~4 GB by default, or `--max-old-space-size` when configured), which the server now exposes alongside the existing fields. The same healthy process now reads ~1% green, a genuinely leaking process still turns orange/red as it approaches the limit, and the gauge sublabel shows `used / limit` instead of `used / allocated`. Old server payloads without the new field fall back to the previous behavior.

### Tests

- 6 new tests: the endpoint exposes `heapLimit` ≥ `heapTotal` matching the runtime's actual `heap_size_limit`; the client metric measures against the limit (the screenshot's exact numbers 51 MB/54.1 MB/4 GB now read 1%), caps at 100%, falls back to `heapTotal` for old payloads, and handles empty input. Full suites: server 1232, client 427 (unit), worker 35 — all passing.

## 1.3.0-dev.5

### Fixed

- 📞 **Every call failure now says WHY it failed — in the user's language, on the call screen.** Until now every possible failure collapsed into one generic "Call failed" with a TURN hint, even when the cause had nothing to do with TURN (denied microphone permission, an HTTP (non-HTTPS) deployment, a missing microphone, the server rejecting the call). That made remote diagnosis impossible — a failure report said nothing about the actual cause. Each failure path now carries a precise machine-readable detail, and the call screen renders a specific message for it (English + Persian):
  - **Microphone/camera permission denied**, **no microphone/camera found**, **microphone busy with another app**, and **insecure context (HTTPS required)** each get their own message. An unsupported environment (calls attempted over plain HTTP) no longer fails silently without any feedback either.
  - **Server rejections show the server's own reason** ("The person you are calling is busy", "Calls are disabled on this server", ...) instead of a fake "Call failed".
  - **The TURN hint appears ONLY for a genuine media-path (ICE) failure**, and now says which level failed: relay candidates gathered but the call still failed (check the TURN server's credentials/logs), only STUN worked (classic restrictive NAT — set up TURN), even local candidates failed (the network blocks WebRTC — TURN over TCP/443), or no candidates at all. A short technical line under the message shows the gathered candidate types and whether TURN is configured, so a bug report finally contains the facts.
- 🔌 **Silent signaling failures no longer strand a call screen.** Three places where the call could die without either side ever learning about it:
  - A failed offer/answer relay over WebSocket (call reaped server-side, wrong chat) returned nothing — the sender hung on the calling/cConnected screen until the ring timeout. The gateway now sends `call:error` back to the sending socket with the server's reason (regression-tested).
  - The caller's offer relay and the callee's answer relay now verify delivery over the HTTP fallback too, and fail the call with the reason instead of leaving the other side hanging.
  - A failed `setRemoteDescription(answer)` on the caller only logged to the console, leaving the call dead on screen; it now ends the call as a handshake failure.
- 🔁 **A peer whose answer attempt itself failed no longer reports a bogus "Call declined" to the caller.** The reject path now distinguishes declined / busy / peer-media-failed / unsupported, and the caller's screen shows the matching label.

### Tests

- 17 new tests: WS gateway relay-error → `call:error` emission; media-error classification (permission/device/busy/insecure-context); TURN-configuration detection (`turn:`/`turns:` URLs, arrays, STUN-only); ICE failure verdicts (relay / srflx / host / none) with candidate de-duplication. Full suites: server 1231, client 422 (unit), worker 35 — all passing.

## 1.3.0-dev.4

### Fixed

- 📞 **"Call failed" root causes, round two — the server could poison a chat against itself.** Three defects that made every call attempt fail (often permanently) were found and fixed:
  - **Stale call entries poisoned the chat with 409s.** An active-call entry whose clients had all vanished (SSE-only client whose stream died without a close event, a device that never sent a clean disconnect) stayed in memory forever when `CALL_MAX_DURATION` was unset — and every later dial in that DM then hit `409 Call already in progress` and surfaced "Call failed". Instantly and forever, until the server restarted. Two fixes: the call manager now runs a **stale-call sweep** (default every 30s) that reaps a connected call once BOTH participants have been offline past a 45s grace window (a client mid-reconnect survives; a ringing call stays bounded by its own 60s ring timer), plus an absolute lifetime cap on any call entry; and `startCall` now **takes over** a stale entry instead of returning 409. With the sweep wired to the presence tracker, a leaked entry can no longer exist.
  - **One disconnected session killed the other session's live call.** The WebSocket gateway tore down all of a user's active calls whenever ANY of their sockets closed — closing a second tab, a phone sleeping, or a transient reconnect dropped the user's other session straight into a call the server had already deleted; every further signaling message 404'd and the call died as "Call failed". The gateway now cleans up only when the user's **last** realtime session (WS or SSE) is gone, using the presence tracker.
  - **A redial during the ring failed with 409.** If the caller's browser refreshed mid-ring, the server kept ringing for up to 60s while the caller's screen was gone — and redialling in that window returned `409` → "Call failed". A redial from the same caller now **resumes the same ringing call** instead.
- 🧭 **The failure now explains itself.** When the media path (ICE) genuinely cannot connect — the remaining physical cause, typically a restrictive network such as carrier/home NAT without a TURN relay — the call screen now shows a hint under "Call failed" pointing at the one-command fix (`scripts/setup-turn.sh`), in English and Persian, instead of a dead end.

### Tests

- 9 new server tests: reaper lifecycle (grace window, online participant, lifetime cap, log semantics), stale takeover, redial resume, and the gateway's last-session-only cleanup. Full suites: server 1230, client 406, worker 35 — all passing.

## 1.3.0-dev.3

### Changed

- 🔢 **The version scheme now carries all the way up — no component ever shows two digits.** The previous carry rule stopped one level short: `1.9.0-dev.9` computed the next release as `1.10.0-dev.1`, breaking the promise that nothing above 9 ever appears (and scrambling GitHub's alphabetical tag ordering again, since `1.10.x` sorts before `1.2.x`). The law is now a proper positional carry, like odometer digits:
  - minor, patch and the dev counter are each a **single digit** (0..9; counter 1..9). The major grows freely — it has no left-hand component to carry into, so it is the only place a "10" may ever appear.
  - `1.2.0-dev.9 → 1.3.0-dev.1` (counter carries into minor), **`1.9.0-dev.9 → 2.0.0-dev.1`** (minor overflow carries into major).
  - The release-sync gate rejects any two-digit minor/patch/counter, the promote workflow validates the same shape, and `scripts/test/version-sync.test.bats` pins all of it (carry into minor, carry into major, two-digit rejections).
  - Two promote-workflow defects fixed on the way: the stable-tag collision check tested an **undefined `STABLE_TAG`** variable (it never fired, and the later `git tag` step would have failed with an empty tag), and a second promotion inside one dev series now **bumps the stable base with the same carry law** (`1.2.1 → 1.2.2`, `1.2.9 → 1.3.0`, `1.9.9 → 2.0.0`) instead of erroring out.
- 📄 **Project identity cleanup + proprietary license.** A full-tree sweep found no remaining functional references to the original upstream project outside the LICENSE attribution (the one historical changelog mention was reworded; the upstream name now exists only where the MIT license legally requires it — the third-party attribution paragraph in LICENSE). The project no longer presents itself as open-source: LICENSE replaced with a proprietary MASolutionExpert license (self-hosting your own instance stays permitted; redistribution does not), all `package.json` files switched to `UNLICENSED`, the README badges and License sections (EN + FA), the docs-site footers (EN + FA) and the in-app About panel text (EN + FA) now say proprietary.

## 1.3.0-dev.2

### Added

- 📞 **Call-history report in the admin panel.** The Chats (گفتگوها) tab now has a "Call history" sub-view showing every voice and video call in the instance — caller (avatar/username/nickname), chat, type (voice/video), outcome (answered / outgoing / cancelled / declined / missed / failed), duration and exact time — with search across callers, participants and chats, type/outcome filters, sortable columns, mobile cards + desktop table, and server-side pagination. Backed by the new admin-only `GET /api/admin/calls` endpoint over the existing call-log messages (encrypted user-typed look-alikes can never appear in the report). Full fa/en i18n.
- 🛡️ **One-click TURN relay deployment for 10/10 call quality** (`scripts/setup-turn.sh`). STUN alone cannot connect peers behind symmetric NAT (most mobile carriers); those calls only work through a TURN relay. The new script installs and configures coturn on the ChatDesk host (auto-detects the public IP, generates credentials, opens firewall ports) and wires `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` into the server's `.env` — existing non-empty TURN values are never overwritten. With a relay available, ICE picks the fastest usable path per call and essentially every call connects.

### Changed

- 📶 **Calls now self-heal instead of dying.** When the media path drops (Wi-Fi ↔ mobile data switch, brief network outage), the peer connection previously went straight to "Call failed". The client now attempts one automatic ICE restart with a 10-second recovery window before giving up — transient network switches no longer kill the call. Both sides may attempt the restart simultaneously; the existing perfect-negotiation offer-collision handling resolves the overlap safely. Timer cleanup covers all exit paths (hang-up, failure, unmount, ring-ended).

## 1.3.0-dev.1

### Added

- 🔢 **Engineered version scheme: no more two-digit dev counters.** Dev prereleases used an open-ended counter (`1.2.0-dev.10`, `dev.11`, …), which scrambled GitHub's alphabetical tags/releases ordering (`dev.10` sorts before `dev.2`). The dev counter is now a single digit 1–9; when the next increment would reach `.dev.10` it **carries into the minor version** (`1.2.0-dev.9` → `1.3.0-dev.1`), so alphabetical tag order always equals chronological order. Enforced end-to-end: `scripts/next-dev-version.sh` is the canonical next-version calculator, the release-sync gate rejects any version with a dev counter above 9, and the `chatdesk-deploy` CLI's `dpkg --compare-versions` comparisons remain fully compatible with the scheme. This release is the first to use it: the call-stability work previously staged as `1.2.0-dev.10` ships as **1.3.0-dev.1** (same commit content, clean order).

### Fixed

- 📞 **Calls no longer fail or get stuck — the whole call system was reworked for stability.** After re-enabling calls, every attempt surfaced "Failed call" and callee sessions could stay stuck on the ringing screen, silently auto-rejecting every later call as busy. Root causes and fixes:
  - **Circular-JSON 500 on every accept** (`CALL_MAX_DURATION` set): the max-duration timer handle lived inside the call object, and `POST /api/calls/accept` serialises that object — Node throws on the circular reference and the accept dies. Timers now live outside the call objects in dedicated maps.
  - **Stuck ringing on multi-session accounts**: when a call was accepted/declined/ended on one device, the account's OTHER sessions kept ringing forever and auto-rejected every future call as busy ("Failed call" at dial time). The server now broadcasts `call:ring-ended` to every session of both participants on accept/reject/end/disconnect, and the client leaves the ringing screen when it arrives.
  - **Rings never timed out**: an unanswered call now ends server-side after 60s with a `missed` log entry, a push dismissal, and a "No answer" notice on both sides — instead of ringing forever.
  - **Doomed rings surfaced as failures**: calling someone already in a call now returns `409 callee_busy` before ringing (WS + HTTP), and the caller sees «خط اشغال است / Line busy» instead of "Call failed".
  - **Unsupported clients no longer kill calls**: a session on insecure HTTP / without WebRTC no longer auto-rejects an incoming call (which ended the call for every device of that user); the server's ring timeout is the single authority.
  - **Declined ≠ failed**: call-log semantics were split properly — outgoing / connected / cancelled (caller hung up) / declined (callee rejected) / missed (nobody answered) / failed (technical fault) — with rose styling for never-connected calls and full i18n (fa/en) for call screens and call-log labels, which were previously hardcoded English.
- 🧪 New API test suite for `/api/calls` (84 call-system tests green); full suites re-run: server 1206, client 406, worker 35 — all passing.

## 1.2.0-dev.9

### Fixed

- 🐛 **Picking any action in the message context menu kicked you out of the chat.** After tapping حذف (delete) or forward — whether you completed the action or cancelled it — the app exited the open chat and landed back on the chats list, in every chat and thread. Root cause: when a menu item opened a follow-up dialog (delete-scope, forward), the menu's deferred `history.back()` found the dialog's history entry on top and skipped its own pop, leaving an orphaned `{sbContextMenu: true}` sentinel in the history stack between the chat's entry and the dialog's. When the dialog later closed, its pop landed on that orphaned entry, and the open chat's `useOverlayBack` handler — whose guard only recognised its own key — misread it as a genuine back gesture and called `closeChat()`.
  - Fix in the shared `useOverlayBack` hook: sentinel ownership is now tracked in a module-level registry, so a pop that lands on any overlay's **stale** sentinel (owner already closed without popping) is treated as internal bookkeeping — not a back gesture — and the stale entry is disposed automatically with a follow-up `back()`. Works for every overlay that opens on top of a closing one, not just the context menu.
  - Regression tests: the existing "opening a modal while the context menu closes in the same commit keeps the modal open" suite still passes; no overlay closes unexpectedly when a sibling overlay's stale sentinel is popped.

### Changed

- 🛡️ **Message editing is now a moderator-only capability.** Regular users (نقش user) can no longer edit messages — the ویرایش entry no longer appears in their message context menu, and both server edit paths (`POST /api/messages` with `editMessageId`, and `POST /api/messages/edit`) return 403 `Only moderators can edit messages.` for the `user` role, even on their own messages. Owner/admin/operator keep editing their own messages exactly as before.

## 1.2.0-dev.8

### Fixed

- 🐛 **Nobody could delete a message — the confirm dialog flashed and vanished instantly.** Clicking "حذف" in the message context menu closed the menu and opened the delete-confirmation dialog in the same instant. The menu's own "system back" bookkeeping called `history.back()` while the dialog was pushing its history entry, and the resulting `popstate` closed the freshly opened dialog a split second later — on some browsers the push itself was even swallowed. Result: a dialog that "appeared and immediately disappeared", so **neither side of a chat could ever delete a message** (the same flash hit every dialog opened from a context menu: delete, forward, delete chat).
  - Fix in the shared `useOverlayBack` hook: the close-pop is deferred one tick and re-checks that its own history entry is still the topmost one before popping, plus a `popstate` guard so a sibling overlay's back() can never close a newer overlay. Deferred entries are drained naturally by later back gestures.
  - Regression test added (chromium + firefox): "opening a modal while the context menu closes in the same commit keeps the modal open".

### Added

- 🛡️ **Deletion is now a moderator-only power, with a full audit trail in the Reports (Logs) section.**
  - **Regular users can no longer delete messages** — not even their own (`POST /api/messages/delete` returns 403 for the `user` role). The delete entry no longer even appears in their message context menu.
  - **Regular users can no longer delete threads.** DM-type chats (support tickets are DM chats) are protected server-side (`POST /api/chats/hide` returns 403), and the delete entry / edit-mode remove button is hidden for them. Group/channel cleanup (leave + hide) keeps working exactly as before.
  - **Admins and operators keep full deletion powers** — an operator/admin can now even delete another participant's message "for everyone" inside threads they belong to (previously only the message author or the chat owner could).
  - **Every moderator deletion is logged to the admin audit log** and shows up in the admin panel **Logs tab (گزارش‌ها)** with the actor, timestamp, and details:
    - `message.delete.everyone` — message deleted for everyone (with a short preview of the deleted text);
    - `message.delete.self` — message hidden from the moderator's own view;
    - `thread.delete` — a thread (DM/support chat) removed from view;
    - `chat.delete` — a group/channel destroyed (with its files). File deletion happens through message/thread deletion, so those events are covered by the same entries.

### Security

- 🔐 The policy is enforced **server-side**, not just hidden in the UI: both delete endpoints verify the acting user's role from the database on every request. Regular users cannot bypass the block by crafting requests, and moderators cannot delete outside chats they are a member of (membership checks unchanged).

### Tests

- 🧪 Server suite **1200/1200** green (new: regular-user 403 on both delete scopes, moderator deletes audited with exact action/actor/details, thread-deletion policy for DM vs group, regular-user group hide still allowed). Client unit suite **406/406** green. New browser tests: overlay-back regression (chromium + firefox) and the context-menu delete policy (5 cases). ESLint clean on all touched files.

## 1.2.0-dev.7

### Added

- 🔍 **Per-thread Search — full-history search inside every conversation (profile "Search" action, next to "Files").** Operators can finally find any past message in a thread with a user:
  - searches **any character, word or number** — case-insensitive, literal (typing `%` or `_` finds those characters, no wildcard surprises);
  - matches **message text from BOTH sides** of the thread (including edited text) **and attachment file names**;
  - every result row shows the sender's nickname, the message text with the **match highlighted**, and the full original timestamp (date · time) — clicking a row jumps to the message in the chat (same scroll + flash as the files gallery / reply quotes);
  - "Load more" pagination and a live result counter in the header; debounced input, keyboard-accessible, focus-trapped dialog consistent with the Files gallery design.
- 🌐 i18n fa/en (`modals.threadSearch.*`, `modals.profile.search`) — Persian UI fully translated.

### Security

- 🔐 The search is **members-only** and uses the exact same visibility contract as the files gallery: `GET /api/chats/:chatId/search` requires a session whose username matches the `username` parameter, verifies chat membership (403 otherwise), and messages hidden for everyone — or hidden for the requesting viewer — **never match**. System messages are excluded. No cross-thread or cross-user leakage is possible; operators can only search threads they belong to. (Also re-audited after the dev.6 client-filter removal: all message/file access paths remain gated by server-side membership checks — removing that filter introduced no security hole.)

### Implementation notes

- 💬 Message bodies are **encrypted at rest** (sb-enc-v1, random IV), so SQL `LIKE` cannot match plaintext. The search chunk-scans the thread (500 rows per chunk), decrypts bodies in the app layer, and filters in JS — newest first, with a 50,000-row scan cap so a huge thread can never pin the server. Attachment file names are matched via one batched query per chunk.
- 🧪 Tests: `server/test/db/chatSearch.test.js` (11 cases: both sides, case-insensitivity, single chars/numbers, file-name matches, literal wildcards, system-message exclusion, hidden-for-everyone / viewer-hidden contracts, pagination, empty terms, cross-thread isolation) and `server/test/api/chatSearch.test.js` (auth, pagination, 400/403 contracts) — full server suite **1194/1194** green. New browser suite `ChatSearchModal.test.jsx` (chromium + firefox: typing → results → jump, empty state). Client unit suite 406/406 green; ESLint clean; production client build OK.

## 1.2.0-dev.6

### Fixed

- 🔎 **"کاربری یافت نشد" on ID search — the real root cause (client-side), fixed at last.** Deep diffing against the upstream codebase this project forked from (see LICENSE for attribution) proved the server search chain (`/api/users` route + `searchUsers` SQL) is identical to upstream and works on PostgreSQL — confirmed by `search:doctor` probes on live servers. The breakage happened in the client, one layer above the SQL:
  - The new-DM modal filtered search results through a hidden "existing DM partners" list (`useDmUsernames` → `dmUsernamesRef`), so anyone the searcher already shared a chat with was silently removed and the modal reported "کاربری یافت نشد" for people who obviously exist.
  - **Why it appeared after the ChatDesk changes**: upstream has no helpdesk. ChatDesk stores support tickets as `type: "dm"` chats with `channel: "support"`, so every ticket partner was added to that hidden list too — on helpdesk servers the hidden set covers essentially every user, and every search came back empty. (The upstream filter only hid plain messenger DM partners; ChatDesk inflated it.)
  - **Fix**: the filter is removed entirely. The search now shows every match; starting a chat with someone you already chat with simply re-opens the existing conversation (`POST /api/chats/dm` reuses it — no duplicates), and support-thread partners are searchable again like any other user. `useDmUsernames` was dead code after this and has been deleted.
  - Searching an ID that matches nobody still says "کاربری یافت نشد" — correctly, because the account really does not exist.

### Tests

- 🧪 `useNewChatSearch.atStrip.test.jsx` updated: results now must include existing chat partners (chromium + firefox); the old "partners are filtered" assertion is inverted. Client unit suite 406/406 green; ESLint clean on the touched files.

## 1.2.0-dev.5

### Diagnostics

- 🩺 **`npm run search:doctor`** — new read-only search diagnostic (same discipline as `db:doctor`; never imports db.js, never writes). When the app says "کاربری یافت نشد" for every ID, it pinpoints WHERE the chain breaks on the live server:
  - connected engine, and for PostgreSQL the `server_encoding` / `lc_collate`;
  - the REAL contents of the users table — usernames (flagging mixed-case ones that lowercase-based login/search can never reach), nicknames, roles, bans;
  - the search SQL run twice against the live DB — the OLD raw-LIKE query (pre 1.2.0-dev.4) vs the NEW `lower()`-based query — so "OLD empty but NEW matches" instantly proves the server is still running pre-dev.4 code (update not applied / install tracking the stable channel);
  - probe terms: passed as arguments (`npm run search:doctor @milad ahmadi`) or derived from the stored users.
- 📋 `GET /api/users` now emits a dedicated `[app-debug] api:users:search` log line (query, exclude, matched count, elapsed ms) when APP_DEBUG is enabled — complements the generic `api:request` logging for pinpointing search issues in production.

### Verification

- 🧪 Full server suite 1177/1177 green; `search:doctor` validated end-to-end in the sandbox against a real migrated SQLite database (users registered through the API, doctor run with derived and explicit probes, `@`-prefixed probe correctly demonstrated as OLD-SQL-empty / NEW-SQL-matched).
- 🔬 Search SQL semantics additionally proven against PostgreSQL semantics via pg-mem: the pre-dev.4 raw-LIKE query fails for mixed-case nicknames under PG case-sensitivity while the dev.4 `lower()` query matches.

## 1.2.0-dev.4

### Fixed

- 🔎 **"کاربری یافت نشد" on every ID search in the new-direct-message dialog** — the user search was broken on production deployments in two independent ways, both fixed in the shared search layer (`searchUsers` / `searchPublicGroups` / `searchPublicChannels` in `server/db.js`):
  - **PostgreSQL case-sensitivity**: Postgres `LIKE` is case-sensitive (SQLite's is not, which is why it worked in dev). A search for a mixed-case nickname ("Alice") or group/channel name ("Support Team") with a lowercase query matched nobody. All comparisons now run through `lower()` on both engines — the search is case-insensitive everywhere.
  - **The "@" prefix**: users habitually type `@id` when searching an ID; the old pattern `%@bob%` never matches the stored `bob`, so every ID search returned an empty list. Leading `@` characters are now stripped from the search term server-side (all consumers: `/api/users`, `/api/discover`, group/channel discovery, member pickers, admin panel) and in the client hooks (`useNewChatSearch`, `useDiscoverSearch`) as defense in depth.
  - A term that is empty after stripping (`@`, whitespace) matches nothing instead of falling back to a full-table scan.
- 🧪 Regression suites: `server/test/db/userSearch.test.js` (17 cases: `@` stripping, case-insensitive username/nickname/group/channel matching, empty-term no-match, exclusion) and browser hook suite `useNewChatSearch.atStrip.test.jsx` (chromium + firefox: `@bob` → `bob`, case folding, DM-list filtering).

## 1.2.0-dev.3

### New

- 📁 **Per-thread "Files" gallery** — the profile panel (the page with Chat / Call / Video / Mute) has a new **Files** action. Opening it shows EVERY file shared in that thread by BOTH sides, newest first:
  - each row shows the media thumbnail (image/video poster) or a kind icon (video / audio / document), the file name, its size, the sender's nickname, and the **full original timestamp (date · time)** of the message that carried it;
  - every row has an **options menu**: **Open** (new tab), **Download**, and **Go to message** (closes the gallery and scrolls to the original message with the reply flash);
  - videos still transcoding are marked "Processing"; long threads paginate with a "Load more" button; a counter in the header shows the total number of shared files;
  - works for DMs, groups and channels (the own-thread profile only — member/mention mini-profiles don't offer it), fully localized (fa/en), Persian-aware fonts.
- 🔌 New members-only endpoint `GET /api/chats/:chatId/files` (session + membership enforced) with a dedicated db layer: `listChatFilesForUser` / `countChatFilesForUser`. Messages hidden for everyone — or hidden for the requesting viewer — never leak their files. Local files resolve to the local upload URL; remote/S3 files get presigned URLs; thumbnails resolve through the shared `resolveThumbUrl` logic (app-encrypted thumbs go through the decrypting proxy).

### Tests

- 🧪 `server/test/db/chatFilesGallery.test.js` (both sides listed newest-first, hidden-for-everyone and viewer-hidden filtering — which caught and fixed a `Number(uuid)` NaN bug in the viewer filter — and pagination) and `server/test/api/chatFiles.test.js` (member 200 + payload shape, 403 non-members, 400 missing username, pagination/hasMore, presigned remote URLs).
- 🧪 Browser suite `ChatFilesModal.test.jsx`: rows with sender/size/timestamp, empty state, per-row options menu (jump-to-message callback), load-more button.

## 1.2.0-dev.2

### Changed

- 🏷️ **SUPPORT / MESSENGER channel badges replace the red-headset marker** (follow-up to 1.2.0-dev.1, feedback-driven redesign): the channel of every conversation is now marked with a clean text pill —
  - **SUPPORT** (rose pill) on helpdesk threads opened through the department picker;
  - **MESSENGER** (slate pill) on messenger-style direct chats.
  - Badges appear in the chat list (DM rows), the chat window header (with the department name in the tooltip), on every incoming message's timestamp row (SUPPORT and MESSENGER, symmetric marking), and in the admin panel's Chats tab (mobile cards + desktop table).
  - New shared component `ChannelBadge` replaces `SupportChannelBadge`; tooltip labels localized (fa/en), LTR-pinned for RTL layouts.

### Fixed

- 🔒 **Channel-separation leak closed in the "find user by ID → send message" flow** (`POST /api/chats/dm`): it previously looked up ANY DM between the pair — including an existing **support ticket** — so a plain direct message could land in (and resurrect) the ticket thread. It is now strictly scoped to the pair's `direct` chat and creates a fresh `direct` chat when none exists; the support thread is never touched. The response now also reports `channel: "direct"`. Route-level regression suite added: `server/test/api/channelSeparation.test.js` (asserts `findDmChat` receives `{ channel: "direct" }` / `{ channel: "support", departmentId }` on both flows).
- 🧪 De-flaked `server/test/db/supportChannel.test.js`: the legacy unfiltered `findDmChat` lookup orders by random UUID ids, so its result set was non-deterministic; the test now asserts membership across all of the pair's DM threads.
- 🧪 Browser badge suites (`MessageItem`, admin `ChatsTab`) re-pinned to English via `LanguageProvider` + `chatdesk.uiLanguage` — they had been red since the Persian-default UI change (99fe1dd) and are green again.

### Rules

- 📐 `AGENTS.md` sandbox discipline: work known to be un-installable/un-testable in the sandbox is skipped outright; every check the sandbox CAN run (lint, unit/integration/API tests, installer bats, release-sync gate) MUST be run.

## 1.2.0-dev.1

### New

- 🎫 **Direct messages and support tickets are now two strictly separated, visually distinguishable message types** (migration 044: `chats.channel`):
  - Every conversation is explicitly either **`direct`** (messenger-style, opened by finding a user's ID) or **`support`** (a helpdesk thread opened through the department picker).
  - A support request **never reuses or converts a direct chat** between the same customer and operator anymore — previously it could silently convert an existing messenger chat into a support thread. It only continues an existing support thread for the *same* department; different departments get separate threads.
  - 🔴 New **red headset badge** (`SupportChannelBadge`) marks support-channel threads everywhere: in the chat list (both sides), in the chat header (with the department name in the tooltip), and on every incoming message bubble's timestamp row — so an operator can tell at a glance "this message came from the user via the support section". The sky-blue verify badge (verified identity) and role badges are unchanged and remain distinct markers.
  - Realtime: `chat_message` SSE/WS payloads now carry `chatChannel`, so badges are correct even for freshly created support threads.
  - 🧑‍💼 **Admin panel → Chats**: new "Message Channel" column (Direct messages / 🔴 Support tickets) **and** a new channel filter (All channels / Direct messages / Support tickets) on both desktop table and mobile cards; support rows also show the department name.
- 🧪 New test coverage: `server/test/db/supportChannel.test.js` (channel defaults, department tagging/demotion, strict channel separation in `findDmChat`, `listChatsForUser` channel fields, `adminListChats` filtering) and browser tests for `SupportChannelBadge`.

## 1.1.0-dev.11

### Fixed

- 🏷️ **Update detection could think dev.10 is OLDER than dev.9** — both version comparators (server and client) compared the prerelease part as a plain string, so `"dev.10"` sorted before `"dev.9"`. From dev.10 onward the in-app updater would have offered dev.9 as "newer". Prerelease identifiers now compare per SemVer rules (numeric identifiers numerically), and the GitHub tag fetch paginates (up to 3×100 tags) so the newest release is never missed on a long tag list.
- ⏯️ **`DB_MIGRATION_TIMEOUT_MS=0` now actually disables the migration watchdog** as documented — previously the `0` fell through the `> 0` guard and silently re-enabled the 120s default. A blank value is treated as unset (it can never accidentally disable the watchdog).
- 🩺 **`db:doctor` is now truly read-only** — it no longer imports `server/db.js`, which silently ran the full migration bootstrap (mutating the database from a "diagnostic" tool, without the running-server guard that `db:migrate` has). It reads the schema version directly; the "migration(s) pending" warning is now actually reachable and meaningful.
- 💾 **`pg_dump` pre-migration backup can no longer freeze the updater** — the dump now runs with a hard time limit (`DB_BACKUP_TIMEOUT_MS`, default 120s) and `PGCONNECT_TIMEOUT`, and a timed-out dump is cleaned up instead of leaving a partial file.
- 🚪 **`db:migrate` exits immediately in Postgres mode** — the idle connection pool is destroyed after completion, so the updater no longer pauses ~30s at the end of migrations while the pool times out.
- 🔐 **`POSTGRES_SSL=true` is now honored when the target is a `POSTGRES_URL`/`DATABASE_URL`** (self-signed Postgres servers); an explicit `sslmode=` inside the URL still wins.
- 📜 **Installer: streaming migration output no longer hits "Permission denied"** when `chatdesk-deploy` is run through sudo — the install log is handed to the invoking user and the streaming `tee` falls back to `sudo -n tee` if the log is not writable.

## 1.1.0-dev.10

### New

- 🩺 **Database hardening** — the database layer now fails fast instead of hanging forever, even though the data itself is tiny. This release was built after an update stalled for a long time at "Running database migrations" on a database with only 2–3 accounts: the stall was never about data size, it was the database layer having **no timeouts at all** in Postgres mode (a single unreachable/locked/stalled query could hang forever, and one update involves hundreds of queries).
- 🧪 New **`db:doctor`** diagnostics command (menu: Manage Database → "Database diagnostics (db:doctor)") that reports the engine and connection target, connection latency, schema version vs. latest migration, missing critical tables, leftover interrupted-migration rebuild tables, row counts, database size, and (SQLite) integrity check + WAL health.

### Fixed

- ⏱️ **Fail-fast timeouts everywhere in Postgres mode**: TCP connect (10s), pool acquire (15s), per-statement `statement_timeout` (30s) and `idle_in_transaction_session_timeout` (30s), pool `min: 0` so dead servers are not propped up by stale sockets. Every value is overridable via `DB_CONNECTION_TIMEOUT_MS`, `DB_ACQUIRE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` for large datasets.
- 🚦 **Connectivity preflight before migrations**: 3 quick `SELECT 1` probes with a clear, actionable error naming the exact cause (server not listening / DNS / credentials / SSL / timeout) and the configured target — nothing is modified when the database is unreachable, instead of a silent chain of 60s+ stalls.
- 🛑 **Per-migration watchdog** (`DB_MIGRATION_TIMEOUT_MS`, default 120s): a single migration that refuses to finish is aborted with an error that names the migration and explains that schema version was not advanced — no more frozen "Running database migrations".
- 💾 **Automatic pre-migration backup for Postgres too** via best-effort `pg_dump` into `data/backups/` (SQLite keeps its file-copy backup); a missing `pg_dump` warns instead of blocking.
- 📺 The updater now **streams migration output live** (every migration with its number and elapsed time) instead of capture-and-show-later output that looks frozen; a 15-minute hard ceiling (`DB_MIGRATION_MAX_SECONDS`) force-stops a stuck migration with a pointer to `db:doctor`.

## 1.1.0-dev.9

### Fixed

- 🐢 Update stuck on "Running database migrations": the migration runner re-applied all 43 idempotent migrations on **every** update and every server boot ("self-heal"), which on large databases silently burned minutes with zero output — it looked frozen. The self-heal pass now runs only when a critical table is actually missing (cheap existence check), the schema version prints correctly (previously `[object Promise]`), and each applied migration logs its number and elapsed time so progress is always visible.
- ⌨️ Pressing Ctrl+C during the migration step of an update left the stopped ChatDesk service down behind nginx (**502 Bad Gateway**) — the interrupt handler now automatically restores the service before exiting, in addition to the existing recovery on every other interrupted update path.

### Changed

- 🧭 The updater now warns before migrations that large databases can take several minutes and that interrupting the step can corrupt the schema; migration output streams live instead of staying silent.

## 1.1.0-dev.8

### Changed

- 🧹 Project cleanup: removed the original upstream project's leftovers — the old maintainer's personal email/LinkedIn/Telegram/Railway links (Security Policy, Code of Conduct, Accessibility statement, docs site social links, in-app About panel) now point to the ChatDesk GitHub project; removed the dead `opencode.json` AI-tool config and the graphify/Superpowers sections from `AGENTS.md`; dropped the stale static `1.0.0` version badge from the READMEs and fixed `CONTRIBUTING.md` to route contributions into `dev` (two-channel law). The MIT `LICENSE` retains the original author's copyright line as legally required.

### New

- 📌 The release delivery checklist (installer/CLI sync law) is now recorded as permanent memory in `AGENTS.md` — every future change must pass the release-sync gate, update the installer header, and be registered as a bilingual dev release before being reported. The two-channel mechanism is now also documented in the deployment guide (English and Persian).

## 1.1.0-dev.7

### Fixed

- 🧰 Installer & CLI versioning was broken: the `chatdesk-deploy` CLI stamped its own version with a `sed` pointed at the wrong line, and the installer header (`chatdesk-deploy-version`) had not been bumped since dev.2 — so installed CLIs never self-updated and servers stayed on old versions even after updates. The header is now bumped with every release and stamped correctly; a CI gate (`verify-release-sync.sh`) refuses any push where VERSION, the installer header and CHANGELOG disagree, so this can never drift again.
- 🔀 Update checks are now channel-aware: a Stable-channel install is only offered stable releases and a Test-channel install follows dev prereleases — previously the app mixed both channels when showing "update available".

### New

- 🚦 Two-channel DevOps pipeline end to end: `chatdesk-deploy --status` shows the installed version and channel; the menu banner shows the same; a new **"Switch Test (dev) / Stable (main) channel"** menu action moves an install between channels through the full update pipeline; and a new **"Promote dev to Stable"** GitHub Actions workflow is the single user-triggered path from an approved dev tag to a stable release on `main`. All install/update/channel-switch paths now share one finalization pipeline (dependencies, migrations, client build, CLI sync, systemd, restart, health check).

## 1.1.0-dev.6

### Fixed

- 🛠️ Helpdesk: admin panel department endpoints crashed with an internal error (`ReferenceError`) because the helpdesk database helpers were never wired into the admin panel module — the Helpdesk tab showed "Could not load helpdesk data", department creation failed, and the support picker could not list departments. All department and support-report endpoints now work end to end.
- ➕ The "+" menu in the sidebar now lists "Contact support" first (then private message, group, channel) to match the support-first workflow.

## 1.1.0-dev.6

### Fixed

- 🔧 Installer (CLI Update): the updater stops the ChatDesk service before doing any work, but many failure or early-exit paths (failed dependency install, failed client build, failed migration, failed `git fetch`, aborted prompt, even the "already up to date" exit) returned without restarting the service — leaving the site permanently behind nginx as **502 Bad Gateway**. The updater now restores the service automatically on every interrupted path and verifies the health endpoint after restarting, with clear `journalctl` hints when it cannot come up.

## 1.0.0

First independent release of ChatDesk.

### New Features

- 🎧 Helpdesk mode: departments, operator role and fair routing of support requests
- 🏢 Department picker during customer registration; conversations start in the right queue
- ⚖️ Fair assignment strategies (round-robin / least-busy) for incoming support requests
- 🛡️ Admin panel extensions: operator account management, department management and reports
- 🗂️ Request status, assignment, tags and customer-invisible internal notes
- 🌐 Bilingual (English / Persian) setup guide and documentation
- 🚀 Branch-aware deployment installer with PostgreSQL as the default database

### Inherited Platform Features

- Messenger core: direct messages, groups and channels with realtime SSE
- File uploads, voice messages and video transcoding worker
- Web push notifications (VAPID) and voice/video calls
- Remote channels (Telegram / ChatDesk mirroring)
- Owner admin panel, PWA support and encryption at rest
