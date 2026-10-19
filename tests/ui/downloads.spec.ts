import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
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
      suggestion: null,
      holdProbe: false,
      restartRequired: false,
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
          state.settings = args.settings;
          return;
        }
        if (command === "add_download") {
          state.jobs.push({
            id: "test",
            url: args.url,
            destination: `C:\\Downloads\\${args.filename || "sample.zip"}`,
            status: args.later ? "paused" : "completed",
            downloaded: args.later ? 0 : 1048576,
            total: 1048576,
            speed: 0,
            error: null,
          });
          return "test";
        }
        if (command === "suggest_download") {
          if ((window as any).zipzapTest.holdProbe) await new Promise(() => {});
          return (
            (window as any).zipzapTest.suggestion || {
              filename: args.filename || "sample.zip",
              total: 1048576,
              alternative: null,
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
          if ((window as any).zipzapTest.failAction === args.action)
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
        if (command === "select_folder") return "C:\\Downloads";
        if (command === "connect_browser") return;
        if (command === "quit_app") return;
        throw new Error("Unexpected mock command");
      },
    };
  });
  await page.goto("/");
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
  await page.getByLabel("إضافة لوقت لاحق (متوقف حتى تختار الاستئناف)", { exact: true }).check();
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
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.locator("footer")).toContainText("keeps ZipZap running in the system tray");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(closeToTray).toBeChecked();
  await expect(notifications).toBeChecked();
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
