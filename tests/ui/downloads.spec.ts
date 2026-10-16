import { test, expect } from "@playwright/test";
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
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "snapshot") return structuredClone(state);
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
          state.jobs = state.jobs.filter((j) => j.id !== args.id);
          return;
        }
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
