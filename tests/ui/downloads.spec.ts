import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      jobs: [] as any[],
      settings: {
        max_concurrent: 2,
        connections: 2,
        speed_limit: 0,
        language: "en",
        download_folder: "C:\\Downloads",
      },
      folder: "C:\\Downloads",
      version: "0.1.0-beta.1",
      native_error: null,
      notice: null,
    };
    const calls: { command: string; args: any }[] = [];
    (window as any).zipzapTest = { state, calls, failAction: "" };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "snapshot") return structuredClone(state);
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
            status: "completed",
            downloaded: 1048576,
            total: 1048576,
            speed: 0,
            error: null,
          });
          return "test";
        }
        if (command === "download_action") {
          if ((window as any).zipzapTest.failAction === args.action)
            throw new Error("Storage unavailable");
          const job = state.jobs.find((j) => j.id === args.id);
          if (!job) throw new Error("Unknown job");
          if (args.action === "remove") state.jobs = state.jobs.filter((j) => j.id !== args.id);
          else
            job.status =
              args.action === "resume"
                ? "downloading"
                : args.action === "pause"
                  ? "paused"
                  : "cancelled";
          return;
        }
        if (command === "open_download") return;
        if (command === "select_folder") return "C:\\Downloads";
        if (command === "connect_browser") return;
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
  await expect(page.getByText("sample.zip", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "100");
  await page.getByRole("searchbox").fill("does-not-exist");
  await expect(page.getByRole("heading", { name: "No matching downloads" })).toBeVisible();
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
