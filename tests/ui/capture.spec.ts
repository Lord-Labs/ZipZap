import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

async function fixture(
  page: Page,
  replies: string[],
  language = "en",
  delayAction = "",
  delayMs = 0,
) {
  const messages = JSON.parse(
    await readFile(`extensions/browser/_locales/${language}/messages.json`, "utf8"),
  );
  await page.route("**/capture-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><title>Capture fixture</title><main><h1>Files</h1><a id="file" href="/file.zip" download>File</a><a id="query" href="/file.zip?token=private" download>Query</a><a id="new" href="/file.zip" target="_blank">New tab</a><a id="other" href="https://example.org/file.zip">Other site</a><a id="blob" href="blob:https://example.org/abc" download>Blob</a><a id="page" href="/about">Page</a></main></html>',
    }),
  );
  await page.route("**/file.zip*", (route) =>
    route.fulfill({
      headers: { "Content-Disposition": "attachment; filename=file.zip" },
      body: "fixture",
    }),
  );
  await page.addInitScript(
    ({ messages, replies, language, delayAction, delayMs }) => {
      const calls: any[] = [];
      (window as any).captureCalls = calls;
      (window as any).chrome = {
        extension: { inIncognitoContext: false },
        i18n: {
          getUILanguage: () => language,
          getMessage: (key: string) => messages[key]?.message || key,
        },
        runtime: {
          id: "fixture",
          onMessage: { addListener: () => {} },
          sendMessage: async (message: any) => {
            if (message.type === "zipzapPolicyRead") return { enabled: true };
            calls.push(message);
            const state = replies.length > 1 ? replies.shift() : replies[0];
            if (message.action === delayAction)
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            return { state };
          },
        },
      };
    },
    { messages, replies, language, delayAction, delayMs },
  );
  await page.goto("/capture-fixture");
  await page.addScriptTag({ path: "dist/extension/content.js" });
}

for (const language of ["en", "ar"])
  test(`trusted capture queues once and is accessible in ${language}`, async ({ page }) => {
    await fixture(page, ["prepared", "queued"], language);
    let downloads = 0;
    page.on("download", () => downloads++);
    await page.locator("#file").click();
    await expect(page.locator("[data-zipzap]").getByRole("status")).toContainText(
      language === "ar" ? "أُضيف إلى" : "Added to ZipZap",
    );
    const calls = await page.evaluate(() => (window as any).captureCalls);
    expect(calls.map((value: any) => value.action)).toEqual(["prepare", "activate"]);
    expect(calls[0].id).toBe(calls[1].id);
    expect(calls[1].url).toBeUndefined();
    expect(downloads).toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

test("eligibility leaves synthetic, modified, query and unknown links to the browser", async ({
  page,
}) => {
  await fixture(page, ["prepared", "queued"]);
  await page.evaluate(() =>
    window.addEventListener("click", (event) => {
      if (["page", "blob"].includes((event.target as HTMLElement).id)) event.preventDefault();
    }),
  );
  await page.locator("#file").evaluate((node: HTMLAnchorElement) => node.click());
  await page.locator("#file").click({ modifiers: ["Control"] });
  await page.locator("#query").click();
  await page
    .locator("#blob")
    .evaluate((node) =>
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    );
  await page
    .locator("#page")
    .evaluate((node) =>
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    );
  expect(await page.evaluate(() => (window as any).captureCalls)).toEqual([]);
});

test("failed preparation returns once to the browser without recapturing", async ({ page }) => {
  await fixture(page, ["fallback"]);
  const download = page.waitForEvent("download");
  await page.locator("#file").click();
  await download;
  await expect(page.locator("[data-zipzap]").getByRole("status")).toContainText(
    "Returned to the browser",
  );
  expect(
    (await page.evaluate(() => (window as any).captureCalls)).map((value: any) => value.action),
  ).toEqual(["prepare"]);
});

test("late preparation cannot activate after the content timeout fell back", async ({ page }) => {
  await page.clock.install();
  await fixture(page, ["prepared", "queued"], "en", "prepare", 25000);
  const download = page.waitForEvent("download");
  await page.locator("#file").click();
  await page.clock.runFor(20500);
  await download;
  await page.clock.runFor(5000);
  expect(
    (await page.evaluate(() => (window as any).captureCalls)).map((value: any) => value.action),
  ).toEqual(["prepare"]);
});

test("unknown activation and late acknowledgment never create a browser copy and recover the same ID", async ({
  page,
}) => {
  await page.clock.install();
  await fixture(page, ["prepared", "queued", "queued"], "en", "activate", 25000);
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.locator("#file").click();
  await page.clock.runFor(20500);
  await expect(page.locator("[data-zipzap]").getByRole("status")).toContainText(
    "may own this download",
  );
  await page.clock.runFor(5000);
  expect(downloads).toBe(0);
  await page
    .locator("[data-zipzap]")
    .getByRole("button", { name: "Check the same request" })
    .click();
  await expect(page.locator("[data-zipzap]").getByRole("status")).toContainText("Added to ZipZap");
  const calls = await page.evaluate(() => (window as any).captureCalls);
  expect(calls.map((value: any) => value.action)).toEqual(["prepare", "activate", "status"]);
  expect(new Set(calls.map((value: any) => value.id)).size).toBe(1);
  expect(downloads).toBe(0);
});
