import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const state = {
      jobs: [] as any[],
      queue: { running: true },
      settings: {
        max_concurrent: 2,
        connections: 2,
        speed_limit: 0,
        language: "en",
        download_folder: "C:\\Downloads",
        close_to_tray: false,
        notifications: false,
      },
      folder: "C:\\Downloads",
      version: "0.1.0-beta.1",
      native_error: null,
      tray_available: true,
      notice: null,
    };
    const calls: { command: string; args: any }[] = [];
    (window as any).zipzapTest = {
      state,
      calls,
      failAction: "",
      failActionId: "",
      failAddUrls: [] as string[],
      failAddMessage: "Storage unavailable",
      loseAddAck: "",
      urlNames: false,
      suggestion: null,
      holdProbe: false,
      restartRequired: false,
      failSettings: "",
      autoFolder: "",
      selectedFolder: "C:\\Downloads",
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "snapshot")
          return structuredClone({
            ...state,
            queue: {
              running: state.queue.running,
              waiting: state.jobs.filter((job) => job.status === "queued").map((job) => job.id),
            },
          });
        calls.push({ command, args: structuredClone(args) });
        if (command === "save_settings") {
          if ((window as any).zipzapTest.failSettings)
            throw new Error((window as any).zipzapTest.failSettings);
          state.settings = args.settings;
          return;
        }
        if (command === "add_download") {
          if (args.requestId && state.jobs.some((job) => job.id === args.requestId))
            return args.requestId;
          if ((window as any).zipzapTest.failAddUrls.includes(args.url))
            throw new Error((window as any).zipzapTest.failAddMessage);
          const id = args.requestId || crypto.randomUUID();
          state.jobs.push({
            id,
            url: args.url,
            destination: `${args.destination}\\${args.filename || "sample.zip"}`,
            status: args.later ? "paused" : "completed",
            downloaded: args.later ? 0 : 1048576,
            total: 1048576,
            speed: 0,
            error: null,
          });
          if ((window as any).zipzapTest.loseAddAck === args.url) {
            (window as any).zipzapTest.loseAddAck = "";
            throw new Error("Response unavailable; retry this request");
          }
          return id;
        }
        if (command === "suggest_download") {
          if ((window as any).zipzapTest.holdProbe) await new Promise(() => {});
          return (
            (window as any).zipzapTest.suggestion || {
              filename:
                args.filename ||
                ((window as any).zipzapTest.urlNames
                  ? new URL(args.url).pathname.split("/").pop()
                  : "sample.zip"),
              total: 1048576,
              alternative: null,
              destination:
                (args.automaticFolder && (window as any).zipzapTest.autoFolder) || args.destination,
              category: "compressed",
            }
          );
        }
        if (command === "cancel_probe") return;
        if (command === "set_queue_running") {
          if ((window as any).zipzapTest.failAction === "queue")
            throw new Error("Storage unavailable");
          state.queue.running = args.running;
          return;
        }
        if (command === "move_waiting") {
          const waiting = state.jobs.filter((job) => job.status === "queued");
          const current = waiting.findIndex((job) => job.id === args.id);
          const other = current + (args.direction === "up" ? -1 : 1);
          const left = state.jobs.indexOf(waiting[current]);
          const right = state.jobs.indexOf(waiting[other]);
          [state.jobs[left], state.jobs[right]] = [state.jobs[right], state.jobs[left]];
          return;
        }
        if (command === "replace_link") {
          if ((window as any).zipzapTest.holdProbe) await new Promise(() => {});
          if ((window as any).zipzapTest.restartRequired && !args.restart)
            return { status: "restart_required" };
          const job = state.jobs.find((job) => job.id === args.id);
          job.url = args.url;
          job.status = "paused";
          return { status: "updated", retained_bytes: args.restart ? 0 : job.downloaded };
        }
        if (command === "download_action") {
          if (
            (window as any).zipzapTest.failAction === args.action ||
            (window as any).zipzapTest.failActionId === args.id
          )
            throw new Error("Storage unavailable");
          const job = state.jobs.find((j) => j.id === args.id);
          if (!job) throw new Error("Unknown job");
          if (args.action === "remove") state.jobs = state.jobs.filter((j) => j.id !== args.id);
          else {
            job.status =
              args.action === "resume"
                ? "downloading"
                : args.action === "pause"
                  ? "paused"
                  : "cancelled";
            job.next_retry = null;
            job.failure_reason = null;
          }
          return;
        }
        if (command === "open_download") return;
        if (command === "select_folder") return (window as any).zipzapTest.selectedFolder;
        if (command === "connect_browser") return;
        if (command === "quit_app") return;
        throw new Error("Unexpected mock command");
      },
    };
  });
  await page.goto("/");
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

test("empty screen, keyboard form validation, and completed row", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
  await page.getByRole("button", { name: "New download", exact: true }).click();
  await expect(page.getByLabel("Download link", { exact: true })).toBeFocused();
  await page.getByLabel("Download link", { exact: true }).fill("file:///private");
  await page.getByRole("button", { name: "Start download" }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP");
  await page.getByLabel("Download link", { exact: true }).fill("https://example.com/sample.zip");
  await page.getByRole("button", { name: "Start download" }).click();
  await expect(page.getByLabel("Filename", { exact: true })).toHaveValue("sample.zip");
  expect((await calls(page)).filter((call) => call.command === "add_download")).toHaveLength(0);
  await page.getByRole("button", { name: "Start download" }).click();
  await expect(page.getByText("sample.zip", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "100");
  await page.getByRole("searchbox").fill("does-not-exist");
  await expect(page.getByRole("heading", { name: "No matching downloads" })).toBeVisible();
});

test("filename conflicts require review and cancellation stops the probe", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).zipzapTest.suggestion = {
      filename: "ملف.zip",
      total: 100,
      alternative: "ملف (1).zip",
    };
  });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: "تنزيل جديد", exact: true }).click();
  await page.locator("#url").fill("https://example.com/file");
  await page.getByRole("button", { name: "فحص اسم الملف", exact: true }).click();
  await expect(page.locator("#filename")).toHaveValue("ملف.zip");
  await expect(page.getByRole("status").filter({ hasText: "الاسم مستخدم" })).toContainText(
    "ملف (1).zip",
  );
  await page.getByRole("button", { name: "استخدام الاسم البديل", exact: true }).click();
  await expect(page.locator("#filename")).toHaveValue("ملف (1).zip");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: ".research-local/ui/filename-review-ar.png", fullPage: true });
  await page.evaluate(() => {
    (window as any).zipzapTest.holdProbe = true;
  });
  await page.getByRole("button", { name: "فحص اسم الملف", exact: true }).click();
  await expect(page.getByRole("button", { name: "جارٍ فحص الاسم…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await calls(page)).some((call) => call.command === "cancel_probe"))
    .toBeTruthy();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("browser collision offers an editable fresh download without overwriting the open form", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New download", exact: true }).click();
  await page.locator("#url").fill("https://example.com/my-link");
  await page.evaluate(() => {
    (window as any).zipzapTest.state.browser_review = {
      url: "https://example.com/browser-link",
      destination: "C:\\Downloads",
      suggestion: { filename: "report.zip", total: 100, alternative: "report (1).zip" },
    };
  });
  await expect(page.getByRole("button", { name: "Review filename", exact: true })).toBeVisible();
  await expect(page.locator("#url")).toHaveValue("https://example.com/my-link");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Review filename", exact: true }).click();
  await expect(page.locator("#filename")).toHaveValue("report (1).zip");
  await expect(page.locator("#url")).toHaveValue("https://example.com/browser-link");
  await page.locator("#filename").fill("my-report.zip");
});

test("link replacement asks before discarding saved parts and keeps private URLs out of notices", async ({
  page,
}) => {
  await seed(page, [sample("expired.zip", "failed")]);
  await page.getByRole("button", { name: "expired.zip", exact: true }).click();
  await page.getByRole("button", { name: "Replace link", exact: true }).click();
  const input = page.getByLabel("New direct download link", { exact: true });
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await input.fill("https://example.com/new?token=PRIVATE_QUERY");
  await page.evaluate(() => {
    (window as any).zipzapTest.restartRequired = true;
  });
  await page.getByRole("button", { name: "Check and replace", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No changes were made");
  const submit = page.getByRole("button", { name: "Discard partials and replace", exact: true });
  await expect(submit).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByLabel("Discard saved partials and start this download from the beginning", {
      exact: true,
    })
    .check();
  await submit.click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Link updated" })).not.toContainText(
    "PRIVATE_QUERY",
  );
  expect(
    (await calls(page))
      .filter((call) => call.command === "replace_link")
      .map((call) => call.args.restart),
  ).toEqual([false, true]);
});

test("Arabic link replacement is accessible and cancelling the dialog cancels its check", async ({
  page,
}) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await seed(page, [sample("expired.zip", "paused")]);
  await page.getByRole("button", { name: "expired.zip", exact: true }).click();
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: "استبدال الرابط", exact: true }).click();
  await page
    .getByLabel("رابط التنزيل المباشر الجديد", { exact: true })
    .fill("https://example.com/new");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: ".research-local/ui/link-replacement-ar.png", fullPage: true });
  await page.evaluate(() => {
    (window as any).zipzapTest.holdProbe = true;
  });
  await page.getByRole("button", { name: "فحص الرابط واستبداله", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await calls(page)).some((call) => call.command === "cancel_probe"))
    .toBeTruthy();
});

test("queue priority uses keyboard moves independently of sorting and hold is saved", async ({
  page,
}) => {
  await seed(page, [
    sample("z.zip", "queued"),
    sample("a.zip", "queued"),
    sample("paused.zip", "paused"),
  ]);
  await page.getByRole("button", { name: "a.zip", exact: true }).click();
  const details = page.locator(".selection-details");
  await expect(details).toContainText("2 / 2");
  await page.getByRole("button", { name: "Filename", exact: true }).click();
  expect((await calls(page)).filter((call) => call.command === "move_waiting")).toHaveLength(0);
  const up = page.getByRole("button", { name: "Move up in queue", exact: true });
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(details).toContainText("1 / 2");
  await expect(up).toBeDisabled();
  await page.getByRole("button", { name: "Hold queue", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Queue held" })).toBeVisible();
  await page.getByRole("button", { name: "paused.zip", exact: true }).click();
  await expect(page.getByRole("button", { name: "Move up in queue", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Start queue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    (window as any).zipzapTest.failAction = "queue";
  });
  await page.getByRole("button", { name: "Hold queue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save the queue change");
  await expect(page.getByRole("status").filter({ hasText: "Queue running" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("add for later remains paused and queue controls have Arabic labels", async ({ page }) => {
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: "تعليق الطابور", exact: true }).click();
  await page.getByRole("button", { name: "تنزيل جديد", exact: true }).click();
  await page.locator("#url").fill("https://example.com/file");
  await page.locator("#filename").fill("later.zip");
  await page
    .getByRole("checkbox", { name: "إضافة لوقت لاحق (متوقف حتى تختار الاستئناف)", exact: true })
    .check();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "إضافة لوقت لاحق", exact: true }).click();
  await page.getByRole("button", { name: "later.zip", exact: true }).click();
  await expect(page.getByRole("button", { name: "استكمال", exact: true })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "الطابور معلّق" })).toBeVisible();
  await page.setViewportSize({ width: 780, height: 560 });
  await page.screenshot({ path: ".research-local/ui/queue-controls-ar.png", fullPage: true });
});

test("tray and notification preferences require explicit opt-in and unavailable tray stays disabled", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const closeToTray = page.getByLabel(
    "Keep downloads running in the system tray when closing the window",
    { exact: true },
  );
  const notifications = page.getByLabel("Notify me about completed or failed downloads", {
    exact: true,
  });
  await expect(closeToTray).not.toBeChecked();
  await expect(notifications).not.toBeChecked();
  await closeToTray.check();
  await notifications.check();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page
    .locator(".category-rules fieldset")
    .last()
    .getByLabel("Category name", { exact: true })
    .fill("Tray documents");
  await page
    .locator(".category-rules fieldset")
    .last()
    .getByLabel("Extensions, separated by commas", { exact: true })
    .fill("traydocs");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.locator("footer")).toContainText("keeps ZipZap running in the system tray");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(closeToTray).toBeChecked();
  await expect(notifications).toBeChecked();
  await expect(
    page.locator(".category-rules fieldset").last().getByLabel("Category name", { exact: true }),
  ).toHaveValue("Tray documents");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Quit ZipZap", exact: true }).click();
  expect((await calls(page)).some((call) => call.command === "quit_app")).toBeTruthy();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as any).zipzapTest.state.tray_available = false;
  });
  await expect(page.locator("footer")).toContainText("pauses active downloads");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("dialog[open]")).toContainText("system tray is unavailable");
  await closeToTray.uncheck();
  await expect(closeToTray).toBeDisabled();
});

test("Arabic switches direction and settings persist", async ({ page }) => {
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "الإعدادات", exact: true }).click();
  await page.getByLabel("حد السرعة (KiB/s)", { exact: true }).fill("256");
  await page.getByRole("button", { name: "حفظ الإعدادات" }).click();
  await expect(page.getByRole("status").filter({ hasText: "تم حفظ" })).toBeVisible();
  await page.getByRole("button", { name: "الإعدادات", exact: true }).click();
  await expect(page.getByLabel("حد السرعة (KiB/s)", { exact: true })).toHaveValue("256");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("accessible empty screen and modal at desktop and narrow sizes", async ({ page }) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "New download", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  for (const width of [780, 375]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

const sample = (id: string, status = "paused", total: number | null = 1048576) => ({
  id,
  status,
  destination: `C:\\Downloads\\${id}`,
  url: `https://example.com/${id}`,
  downloaded: status === "completed" ? total || 0 : 1024,
  total,
  speed: status === "downloading" ? 1024 : 0,
  error: status === "failed" ? "Connection lost" : null,
});

async function seed(page: Page, jobs: ReturnType<typeof sample>[]) {
  await page.evaluate((jobs) => {
    (window as any).zipzapTest.state.jobs = jobs;
  }, jobs);
  await expect(page.locator("tbody tr")).toHaveCount(jobs.length);
}

async function calls(page: Page) {
  return page.evaluate(() => (window as any).zipzapTest.calls);
}

test("storage estimates and repair guidance remain localized and accessible", async ({ page }) => {
  await seed(page, [
    { ...sample("space.zip", "failed"), error: "Storage error: full. fixture failure" },
    sample("unknown.bin", "paused", null),
  ]);
  await page.getByRole("button", { name: "space.zip", exact: true }).click();
  const details = page.locator(".selection-details");
  await expect(details).toContainText("Peak storage estimate");
  await expect(details).toContainText("2 MiB");
  await expect(details).toContainText("Free space, then retry");
  await expect(details).toContainText("Estimates do not guarantee free space");
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(details).toContainText("وفر مساحة ثم أعد المحاولة");
  await page.getByRole("button", { name: "unknown.bin", exact: true }).click();
  await expect(details).toContainText("حجم غير معروف");
  await page.setViewportSize({ width: 780, height: 560 });
  await page.getByRole("button", { name: "تنزيل جديد", exact: true }).click();
  await expect(page.locator("#storage-help")).toContainText("الحجم غير معروف");
  await expect(page.locator("#storage-help")).toContainText("NTFS");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: ".research-local/ui/storage-recovery-ar.png", fullPage: true });
});

test("retry status exposes attempts, deadline and localized cause without blocking controls", async ({
  page,
}) => {
  await seed(page, [
    {
      ...sample("retry.zip", "downloading"),
      error: "Server returned HTTP 429",
      attempt: 1,
      next_retry: Date.now() + 30000,
      failure_reason: "rate_limited",
    } as ReturnType<typeof sample>,
  ]);
  await page.getByRole("button", { name: "retry.zip", exact: true }).click();
  const details = page.locator(".selection-details");
  await expect(details).toContainText("Attempt");
  await expect(details).toContainText("1 / 3");
  await expect(details).toContainText("Next retry");
  await expect(details).toContainText("server asked to slow down");
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(details).toContainText("المحاولة التالية");
  await expect(details).toContainText("طلب الخادم تخفيف الطلبات");
  await details.focus();
  await expect(details).toBeFocused();
  await page.getByRole("button", { name: "إيقاف مؤقت", exact: true }).click();
  await expect(details).not.toContainText("المحاولة التالية");
  expect(
    (await calls(page)).some(
      (call: any) => call.command === "download_action" && call.args.action === "pause",
    ),
  ).toBeTruthy();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("selection drives toolbar actions and clears when a file is hidden or removed", async ({
  page,
}) => {
  const toolbar = page.getByRole("group", { name: "Download actions" });
  await seed(page, [
    sample("active.zip", "downloading"),
    sample("done.exe", "completed"),
    sample("retry.pdf", "failed"),
  ]);
  await expect(toolbar.getByRole("button", { name: "Resume", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "active.zip", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "active.zip", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(toolbar.getByRole("button", { name: "Open file", exact: true })).toBeDisabled();
  await toolbar.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(toolbar.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  await toolbar.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(toolbar.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  await toolbar.getByRole("button", { name: "Cancel download", exact: true }).click();
  await expect(
    toolbar.getByRole("button", { name: "Remove from history", exact: true }),
  ).toBeEnabled();
  await toolbar.getByRole("button", { name: "Remove from history", exact: true }).click();
  await expect(page.getByRole("button", { name: "active.zip", exact: true })).toHaveCount(0);
  await expect(
    toolbar.getByRole("button", { name: "Remove from history", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "done.exe", exact: true }).click();
  await toolbar.getByRole("button", { name: "Open file", exact: true }).click();
  await toolbar.getByRole("button", { name: "Show in folder", exact: true }).click();
  expect(
    (await calls(page)).filter((c: any) => c.command === "open_download").map((c: any) => c.args),
  ).toEqual([
    { id: "done.exe", reveal: false },
    { id: "done.exe", reveal: true },
  ]);
  await page.getByRole("searchbox").fill("retry");
  await expect(toolbar.getByRole("button", { name: "Open file", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "retry.pdf", exact: true }).click();
  await toolbar.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(toolbar.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
});

test("categories combine with search and status filters clear the category", async ({ page }) => {
  await seed(page, [
    sample("archive.ZIP"),
    sample("report.PDF", "completed"),
    sample("track.mp3"),
    sample("setup.exe"),
    sample("movie.webm"),
    sample("README", "cancelled"),
    sample("zip", "cancelled"),
  ]);
  await page.getByRole("button", { name: "Compressed", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "archive.ZIP", exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("report");
  await expect(page.getByRole("heading", { name: "No matching downloads" })).toBeVisible();
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(page.getByRole("button", { name: "report.PDF", exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("");
  for (const [category, name] of [
    ["Music", "track.mp3"],
    ["Programs", "setup.exe"],
    ["Video", "movie.webm"],
    ["Other files", "README"],
  ]) {
    await page.getByRole("button", { name: category, exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(category === "Other files" ? 2 : 1);
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page
    .getByRole("navigation", { name: "Filter downloads" })
    .getByRole("button", { name: /^Completed/ })
    .click();
  await expect(page.getByRole("button", { name: "report.PDF", exact: true })).toBeVisible();
});

test("table sorts naturally, keeps unknown sizes last, and preserves selection across snapshots", async ({
  page,
}) => {
  await seed(page, [
    sample("part10.zip", "paused", 2048),
    sample("part2.zip", "completed", 1024),
    sample("unknown", "downloading", null),
  ]);
  await page.getByRole("button", { name: "part10.zip", exact: true }).click();
  await page
    .getByRole("columnheader", { name: /Filename/ })
    .getByRole("button")
    .click();
  await expect(page.locator("tbody .file-select")).toHaveText([
    "part2.zip",
    "part10.zip",
    "unknown",
  ]);
  await page
    .getByRole("columnheader", { name: /Total size/ })
    .getByRole("button")
    .click();
  await expect(page.locator("tbody .file-select")).toHaveText([
    "part2.zip",
    "part10.zip",
    "unknown",
  ]);
  await page
    .getByRole("columnheader", { name: /Total size/ })
    .getByRole("button")
    .click();
  await expect(page.getByRole("columnheader", { name: /Total size/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect(page.locator("tbody .file-select")).toHaveText([
    "part10.zip",
    "part2.zip",
    "unknown",
  ]);
  await page.evaluate(() => {
    (window as any).zipzapTest.state.jobs[0].status = "downloading";
  });
  await expect(
    page
      .getByRole("group", { name: "Download actions" })
      .getByRole("button", { name: "Pause", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "part10.zip", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("progressbar", { name: "unknown Downloading" })).not.toHaveAttribute(
    "value",
  );
  await page
    .getByRole("columnheader", { name: /Status/ })
    .getByRole("button")
    .click();
  await expect(page.locator("tbody .file-select")).toHaveText([
    "part2.zip",
    "unknown",
    "part10.zip",
  ]);
});

test("pause all covers active and queued jobs and stops on a command failure", async ({ page }) => {
  await seed(page, [
    sample("first.zip", "downloading"),
    sample("next.zip", "queued"),
    sample("done.zip", "completed"),
  ]);
  await page.evaluate(() => {
    (window as any).zipzapTest.failAction = "pause";
  });
  await page.getByRole("button", { name: "Pause all", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Storage unavailable");
  expect(
    (await calls(page)).filter((c: any) => c.command === "download_action").map((c: any) => c.args),
  ).toEqual([{ id: "first.zip", action: "pause" }]);
  await page.evaluate(() => {
    (window as any).zipzapTest.failAction = "";
  });
  await page.getByRole("button", { name: "Pause all", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause all", exact: true })).toBeDisabled();
  expect(
    (await calls(page))
      .filter((c: any) => c.command === "download_action")
      .slice(1)
      .map((c: any) => c.args),
  ).toEqual([
    { id: "first.zip", action: "pause" },
    { id: "next.zip", action: "pause" },
  ]);
});

test("failed removal retains the selected file and allows retry", async ({ page }) => {
  await seed(page, [sample("keep.zip", "completed")]);
  await page.getByRole("button", { name: "keep.zip", exact: true }).click();
  await page.evaluate(() => {
    (window as any).zipzapTest.failAction = "remove";
  });
  await page.getByRole("button", { name: "Remove from history", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Storage unavailable");
  await expect(page.getByRole("button", { name: "keep.zip", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.evaluate(() => {
    (window as any).zipzapTest.failAction = "";
  });
  await page.getByRole("button", { name: "Remove from history", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(0);
});

test("selected actions keep per-item results and retry only still eligible downloads", async ({
  page,
}) => {
  await seed(page, [
    sample("first.zip", "downloading"),
    sample("second.zip", "queued"),
    sample("later.zip", "paused"),
    sample("done.zip", "completed"),
  ]);
  await page.getByRole("checkbox", { name: "Select download first.zip", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("checkbox", { name: "Select download second.zip", exact: true }).check();
  await page.evaluate(() => {
    (window as any).zipzapTest.failActionId = "first.zip";
  });
  await page.getByRole("button", { name: "Pause selected", exact: true }).click();
  await expect(page.locator(".bulk-results")).toContainText("first.zip: Storage unavailable");
  await expect(page.locator(".bulk-results")).toContainText("second.zip: Action saved");
  expect(
    (await calls(page))
      .filter((call) => call.command === "download_action")
      .map((call) => call.args.id),
  ).toEqual(["second.zip", "first.zip"]);
  await page.evaluate(() => {
    (window as any).zipzapTest.failActionId = "";
  });
  await page.getByRole("button", { name: "Pause selected", exact: true }).click();
  await expect(page.locator(".bulk-results")).toHaveText(["first.zip: Action saved"]);
  expect(
    (await calls(page))
      .filter((call) => call.command === "download_action")
      .map((call) => call.args.id),
  ).toEqual(["second.zip", "first.zip", "first.zip"]);
  await page.getByRole("button", { name: "Resume / retry selected", exact: true }).click();
  await expect(page.locator(".bulk-results li")).toHaveCount(2);
  expect(
    (await calls(page))
      .filter((call) => call.command === "download_action")
      .slice(-2)
      .map((call) => call.args),
  ).toEqual([
    { id: "second.zip", action: "resume" },
    { id: "first.zip", action: "resume" },
  ]);
});

test("bulk destructive actions confirm the captured set and history removal keeps completed output", async ({
  page,
}) => {
  await seed(page, [
    sample("active.zip", "downloading"),
    sample("paused.zip", "paused"),
    sample("done.zip", "completed"),
    sample("failed.zip", "failed"),
  ]);
  await page.getByRole("checkbox", { name: "Select all visible downloads", exact: true }).check();
  await page.getByRole("button", { name: "Cancel selected downloads", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Confirm affected downloads (2)" });
  await expect(confirmation.locator("li")).toHaveText(["paused.zip", "active.zip"]);
  await expect(confirmation).toContainText("discard their partial data");
  await page.keyboard.press("Escape");
  expect((await calls(page)).filter((call) => call.command === "download_action")).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel selected downloads", exact: true }).click();
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect(page.locator(".bulk-results li")).toHaveCount(2);
  expect(
    (await calls(page))
      .filter((call) => call.command === "download_action")
      .map((call) => call.args.action),
  ).toEqual(["cancel", "cancel"]);
  await page.getByRole("button", { name: "Remove selected history", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Completed files are kept");
  await expect(page.getByRole("dialog").locator("li")).toHaveCount(4);
  await page.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(0);
});

test("Ctrl and Shift selection follows visible order and Arabic keyboard checkboxes remain accessible", async ({
  page,
}) => {
  await seed(page, [
    sample("a.zip", "failed"),
    sample("b.zip", "paused"),
    sample("c.zip", "completed"),
  ]);
  await page.getByRole("button", { name: "c.zip", exact: true }).click();
  await page.getByRole("button", { name: "a.zip", exact: true }).click({ modifiers: ["Shift"] });
  await expect(
    page.getByRole("checkbox", { name: "Select all visible downloads", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "b.zip", exact: true }).click({ modifiers: ["Control"] });
  await expect(
    page.getByRole("checkbox", { name: "Select download b.zip", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("checkbox", { name: "تحديد التنزيل b.zip", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("checkbox", { name: "تحديد كل التنزيلات الظاهرة", exact: true }),
  ).toBeChecked();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("searchbox", { name: "ابحث في التنزيلات" }).fill("a.zip");
  await expect(page.getByRole("button", { name: "a.zip", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("searchbox").clear();
  await expect(
    page.getByRole("checkbox", { name: "تحديد التنزيل b.zip", exact: true }),
  ).not.toBeChecked();
});

test("batch preview validates limits, URL duplicates and filename collisions before enqueue", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).zipzapTest.urlNames = true;
  });
  await page.getByRole("button", { name: "Add multiple links", exact: true }).click();
  const links = page.getByLabel("Links, one per line", { exact: true });
  await links.fill(
    Array.from({ length: 101 }, (_, index) => `https://example.com/${index}.zip`).join("\n"),
  );
  await page.getByRole("button", { name: "Preview / recheck links", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("between 1 and 100");
  expect((await calls(page)).filter((call) => call.command === "suggest_download")).toHaveLength(0);
  await links.fill(
    "https://example.com/a.zip\nhttps://example.com/a.zip#same\nfile:///bad\nhttps://other.example/a.zip\nhttp://user:pass@example.com/b.zip",
  );
  await page.getByRole("button", { name: "Preview / recheck links", exact: true }).click();
  await expect(page.locator(".batch-rows li")).toHaveCount(5);
  await expect(page.locator(".batch-rows")).toContainText("Duplicate link");
  await expect(page.locator(".batch-rows")).toContainText("Another included row");
  await expect(
    page.getByRole("button", { name: "Add ready links (0)", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Filename 4", { exact: true }).fill("b.zip");
  await page.getByRole("button", { name: "Preview / recheck links", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add ready links (2)", exact: true }),
  ).toBeEnabled();
  expect((await calls(page)).filter((call) => call.command === "add_download")).toHaveLength(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
});

test("batch retries capacity failures and lost acknowledgements with stable IDs without readding accepted rows", async ({
  page,
}) => {
  await page.evaluate(() => {
    const mock = (window as any).zipzapTest;
    mock.urlNames = true;
    mock.failAddUrls = ["https://example.com/b.zip"];
    mock.failAddMessage = "Queue history limit reached; remove old completed downloads";
    mock.loseAddAck = "https://example.com/c.zip";
  });
  await page.getByRole("button", { name: "Add multiple links", exact: true }).click();
  await page
    .getByLabel("Links, one per line", { exact: true })
    .fill("https://example.com/a.zip\nhttps://example.com/b.zip\nhttps://example.com/c.zip");
  await page
    .getByRole("checkbox", { name: "Add for later (paused until you resume)", exact: true })
    .check();
  await page.getByRole("button", { name: "Preview / recheck links", exact: true }).click();
  await page.getByRole("button", { name: "Add for later (3)", exact: true }).click();
  await expect(page.locator(".batch-rows")).toContainText("Queue history limit reached");
  await expect(page.locator(".batch-rows")).toContainText("Response unavailable");
  await expect(page.locator(".batch-rows li").first()).toContainText("Accepted by the app");
  const first = (await calls(page)).filter((call) => call.command === "add_download");
  expect(first).toHaveLength(3);
  expect(first.every((call) => call.args.later && call.args.requestId)).toBeTruthy();
  await expect(page.getByLabel("Filename 2", { exact: true })).toBeDisabled();
  await page.evaluate(() => {
    (window as any).zipzapTest.failAddUrls = [];
  });
  await page.getByRole("button", { name: "Add for later (2)", exact: true }).click();
  await expect(
    page.locator(".batch-rows li").filter({ hasText: "Accepted by the app" }),
  ).toHaveCount(3);
  const replay = (await calls(page)).filter((call) => call.command === "add_download");
  expect(replay.slice(3).map((call) => call.args.requestId)).toEqual(
    first.slice(1).map((call) => call.args.requestId),
  );
  expect(await page.evaluate(() => (window as any).zipzapTest.state.jobs.length)).toBe(3);
  expect(
    await page.evaluate(() =>
      (window as any).zipzapTest.state.jobs.every((job: any) => job.status === "paused"),
    ),
  ).toBeTruthy();
});

test("batch preview cancellation stops the current metadata probe and Arabic dialog is usable by keyboard", async ({
  page,
}) => {
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: "إضافة عدة روابط", exact: true }).click();
  await page
    .getByLabel("الروابط، رابط في كل سطر", { exact: true })
    .fill("https://example.com/a.zip\nhttps://example.com/b.zip");
  await page.evaluate(() => {
    (window as any).zipzapTest.holdProbe = true;
  });
  await page.getByRole("button", { name: "معاينة الروابط / إعادة فحصها", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () => (await calls(page)).filter((call) => call.command === "suggest_download").length,
    )
    .toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const requests = await calls(page);
  expect(requests.find((call) => call.command === "cancel_probe")?.args.id).toBe(
    requests.find((call) => call.command === "suggest_download")?.args.id,
  );
  await page.evaluate(() => {
    (window as any).zipzapTest.holdProbe = false;
  });
  await page.getByRole("button", { name: "إضافة عدة روابط", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 700 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("batch accepts exactly 100 preview rows and occupied names need explicit correction", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).zipzapTest.urlNames = true;
  });
  await page.getByRole("button", { name: "Add multiple links", exact: true }).click();
  await page
    .getByLabel("Links, one per line", { exact: true })
    .fill(
      Array.from({ length: 100 }, (_, index) => `https://example.com/file-${index}.zip`).join("\n"),
    );
  await page.getByRole("button", { name: "Preview / recheck links", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add ready links (100)", exact: true }),
  ).toBeEnabled();
  expect((await calls(page)).filter((call) => call.command === "suggest_download")).toHaveLength(
    100,
  );
  expect((await calls(page)).filter((call) => call.command === "add_download")).toHaveLength(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add multiple links", exact: true }).click();
  await page
    .getByLabel("Links, one per line", { exact: true })
    .fill("https://example.com/taken.zip");
  await page.evaluate(() => {
    (window as any).zipzapTest.suggestion = {
      filename: "taken.zip",
      alternative: "taken (1).zip",
      total: null,
    };
  });
  await page.getByRole("button", { name: "Preview / recheck links", exact: true }).click();
  await expect(page.locator(".batch-rows")).toContainText("taken (1).zip");
  await expect(
    page.getByRole("button", { name: "Add ready links (0)", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Filename 1", { exact: true }).fill("taken (1).zip");
  await page.evaluate(() => {
    (window as any).zipzapTest.suggestion = null;
  });
  await page.getByRole("button", { name: "Preview / recheck links", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add ready links (1)", exact: true }),
  ).toBeEnabled();
});

test("category edits save custom Unicode and multi-dot filters without moving old destinations", async ({
  page,
}) => {
  await seed(page, [
    sample("archive.tar.GZ", "completed"),
    sample("note.عربي", "paused"),
    sample("unknown", "completed"),
  ]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  const rule = page.locator(".category-rules fieldset").last();
  await rule.getByLabel("Category name", { exact: true }).fill("حزم خاصة");
  await rule.getByLabel("Extensions, separated by commas", { exact: true }).fill("tar.gz, عربي");
  await page.evaluate(() => {
    (window as any).zipzapTest.selectedFolder = "C:\\Archives";
  });
  await rule.getByRole("button", { name: "Choose category folder حزم خاصة", exact: true }).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByRole("button", { name: "حزم خاصة", exact: true }).click();
  await expect(page.locator("tbody .file-select")).toHaveText(["note.عربي", "archive.tar.GZ"]);
  expect(
    await page.evaluate(() =>
      (window as any).zipzapTest.state.jobs.map((job: any) => job.destination),
    ),
  ).toEqual([
    "C:\\Downloads\\archive.tar.GZ",
    "C:\\Downloads\\note.عربي",
    "C:\\Downloads\\unknown",
  ]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.locator(".category-rules fieldset").last().getByLabel("Category name", { exact: true }),
  ).toHaveValue("حزم خاصة");
  await expect(
    page.locator(".category-rules fieldset").last().locator("input[readonly]"),
  ).toHaveValue("C:\\Archives");
  await page.getByRole("button", { name: "Restore default categories", exact: true }).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "حزم خاصة", exact: true })).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(page.getByRole("button", { name: "مضغوطة", exact: true })).toBeVisible();
});

test("category draft cancellation and localized rejected saves preserve existing rules", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#category-name-compressed").fill("Unsaved label");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Compressed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: "الإعدادات", exact: true }).click();
  await expect(page.locator("#category-name-compressed")).toHaveValue("مضغوطة");
  await page.evaluate(() => {
    (window as any).zipzapTest.failSettings =
      "An extension belongs to more than one category; remove the duplicate rule";
  });
  await page.locator("#category-ext-compressed").fill("ZIP, pdf");
  await page.getByRole("button", { name: "حفظ الإعدادات", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("يوجد امتداد في أكثر من فئة");
  await page.setViewportSize({ width: 375, height: 700 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("manual category folder is reviewed before add and explicit folder choice takes precedence", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).zipzapTest.autoFolder = "C:\\Archives";
  });
  await page.getByRole("button", { name: "New download", exact: true }).click();
  await page.locator("#url").fill("https://example.com/file.zip");
  await page.locator("#filename").fill("file.zip");
  await page.getByRole("button", { name: "Start download", exact: true }).click();
  await expect(page.locator("#destination")).toHaveValue("C:\\Archives");
  expect((await calls(page)).filter((call) => call.command === "add_download")).toHaveLength(0);
  await page.getByRole("button", { name: "Start download", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    (await calls(page)).filter((call) => call.command === "add_download")[0].args.destination,
  ).toBe("C:\\Archives");
  await page.getByRole("button", { name: "New download", exact: true }).click();
  await page.locator("#url").fill("https://example.com/explicit.zip");
  await page.locator("#filename").fill("explicit.zip");
  await page.evaluate(() => {
    (window as any).zipzapTest.selectedFolder = "C:\\Chosen";
  });
  await page.getByRole("button", { name: "Choose folder", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Use category folder suggestions", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Start download", exact: true }).click();
  const adds = (await calls(page)).filter((call) => call.command === "add_download");
  expect(adds[1].args.destination).toBe("C:\\Chosen");
  expect(
    (await calls(page)).filter((call) => call.command === "suggest_download").at(-1)?.args
      .automaticFolder,
  ).toBe(false);
  await expect(page.locator("tbody tr")).toHaveCount(2);
});

test("appearance, keyboard column resizing, visibility and sort choices save and reset", async ({
  page,
}) => {
  await seed(page, [sample("a.zip", "completed"), sample("b.zip", "paused")]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance", { exact: true }).selectOption("light");
  await expect(
    page.getByRole("checkbox", { name: "Show column Filename", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: "Show column Website", exact: true }).uncheck();
  await page.getByRole("slider", { name: /Column width Filename/ }).focus();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("columnheader", { name: "Website", exact: true })).toHaveCount(0);
  await expect(page.locator("th").first()).toHaveCSS("width", "800px");
  await page
    .getByRole("columnheader", { name: /Filename/ })
    .getByRole("button")
    .click();
  await expect(page.locator("tbody .file-select")).toHaveText(["a.zip", "b.zip"]);
  await page
    .getByRole("columnheader", { name: /Filename/ })
    .getByRole("button")
    .click();
  await expect(page.locator("tbody .file-select")).toHaveText(["b.zip", "a.zip"]);
  expect(await page.evaluate(() => (window as any).zipzapTest.state.settings.view.descending)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("slider", { name: /Column width Filename/ })).toHaveValue("800");
  await page.getByRole("button", { name: "Reset columns and sorting", exact: true }).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Website", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).zipzapTest.state.settings.view.sort)).toBe(
    "recent",
  );
});

test("system appearance follows media changes and failed sort saves retain the previous order", async ({
  page,
}) => {
  await seed(page, [sample("a.zip", "completed"), sample("b.zip", "completed")]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance", { exact: true }).selectOption("system");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.evaluate(() => {
    (window as any).zipzapTest.failSettings = "Storage unavailable";
  });
  await page
    .getByRole("columnheader", { name: /Filename/ })
    .getByRole("button")
    .click();
  await expect(page.getByRole("alert")).toContainText("Storage unavailable");
  await expect(page.locator("tbody .file-select")).toHaveText(["b.zip", "a.zip"]);
  expect(await page.evaluate(() => (window as any).zipzapTest.state.settings.view.sort)).toBe(
    "recent",
  );
});

test("keyboard context actions use validated commands, expose failures and return focus after removal", async ({
  page,
}) => {
  await seed(page, [sample("active.zip", "downloading"), sample("done.zip", "completed")]);
  const active = page.getByRole("button", { name: "active.zip", exact: true });
  await active.focus();
  await page.keyboard.press("Shift+F10");
  const context = page.getByRole("dialog", { name: "File actions", exact: true });
  await expect(context).toBeVisible();
  await expect(context.getByRole("button", { name: "Open file", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    (window as any).zipzapTest.failAction = "pause";
  });
  await context.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(context.getByRole("alert")).toContainText("Storage unavailable");
  await page.evaluate(() => {
    (window as any).zipzapTest.failAction = "";
  });
  await context.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(context).not.toBeVisible();
  await expect(active).toBeFocused();
  await page.getByRole("button", { name: "done.zip", exact: true }).click({ button: "right" });
  await context.getByRole("button", { name: "Remove from history", exact: true }).click();
  await expect(context).not.toBeVisible();
  const confirmation = page.getByRole("dialog", { name: "Confirm affected downloads (1)" });
  await expect(confirmation.locator("li")).toHaveText(["done.zip"]);
  expect((await calls(page)).filter((call) => call.args?.action === "remove")).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "done.zip", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "done.zip", exact: true }).click({ button: "right" });
  await context.getByRole("button", { name: "Remove from history", exact: true }).click();
  await confirmation.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect(page.getByRole("button", { name: "done.zip", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Download table", exact: true })).toBeFocused();
  await page.keyboard.press("Control+f");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.getByRole("searchbox").fill("active");
  await page.keyboard.press("Control+a");
  expect(await page.getByRole("searchbox").inputValue()).toBe("active");
  await page.getByRole("region", { name: "Download table", exact: true }).focus();
  await page.keyboard.press("Control+n");
  await expect(page.locator("#url")).toBeFocused();
  await page.keyboard.press("Escape");
});

test("context cancellation confirms only the chosen file before discarding partial data", async ({
  page,
}) => {
  await seed(page, [sample("active.zip", "downloading"), sample("other.zip", "paused")]);
  const file = page.getByRole("button", { name: "active.zip", exact: true });
  const context = page.getByRole("dialog", { name: "File actions", exact: true });
  const confirmation = page.getByRole("dialog", { name: "Confirm affected downloads (1)" });
  await file.click({ button: "right" });
  await context.getByRole("button", { name: "Cancel download", exact: true }).click();
  await expect(confirmation.locator("li")).toHaveText(["active.zip"]);
  await expect(confirmation).toContainText("discard their partial data");
  await page.keyboard.press("Escape");
  expect((await calls(page)).filter((call) => call.command === "download_action")).toHaveLength(0);
  await file.focus();
  await page.keyboard.press("Shift+F10");
  await context.getByRole("button", { name: "Cancel download", exact: true }).click();
  await confirmation.getByRole("button", { name: "Confirm action", exact: true }).click();
  await expect(page.locator(".bulk-results li")).toHaveCount(1);
  expect(
    (await calls(page))
      .filter((call) => call.command === "download_action")
      .map((call) => call.args),
  ).toEqual([{ id: "active.zip", action: "cancel" }]);
});

test("light RTL long filenames remain operable at minimum size and doubled render scale", async ({
  page,
}) => {
  const name = "ملف-طويل-".repeat(8) + ".zip";
  await seed(page, [sample(name, "failed")]);
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: "الإعدادات", exact: true }).click();
  await page.getByLabel("المظهر", { exact: true }).selectOption("light");
  await page.getByRole("button", { name: "حفظ الإعدادات", exact: true }).click();
  await page.setViewportSize({ width: 780, height: 560 });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  const file = page.getByRole("button", { name, exact: true });
  await file.focus();
  await page.keyboard.press("Shift+F10");
  const dialog = page.getByRole("dialog", { name: "إجراءات الملف", exact: true });
  await expect(dialog.getByRole("button", { name: "إعادة المحاولة", exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(file).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("workspace-light-rtl-2x.png") });
});

test("populated table is accessible in English and Arabic, including narrow viewports", async ({
  page,
}) => {
  await seed(page, [
    sample("example.zip", "downloading"),
    sample("document.pdf", "failed"),
    sample("setup.exe", "completed"),
  ]);
  await page.getByRole("button", { name: "example.zip", exact: true }).click();
  for (const width of [1200, 780, 375]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "example.zip", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "إيقاف مؤقت", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.screenshot({ path: test.info().outputPath("workspace-ar.png") });
});
