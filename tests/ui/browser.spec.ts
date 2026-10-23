import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function popup(
  page: Page,
  states: string[],
  language = "en",
  missing = false,
  submit = true,
) {
  const messages = JSON.parse(
    await readFile(`extensions/browser/_locales/${language}/messages.json`, "utf8"),
  );
  await page.route("**/extension/*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    await route.fulfill({ path: `dist/extension/${name}` });
  });
  await page.addInitScript(
    ({ states, language, messages, missing }) => {
      const calls: any[] = [];
      (window as any).nativeCalls = calls;
      (window as any).chrome = {
        i18n: {
          getUILanguage: () => language,
          getMessage: (key: string) => messages[key]?.message || key,
        },
        action: { setBadgeText: async () => {} },
        runtime: {
          sendNativeMessage: (_host: string, message: any, callback: (value: unknown) => void) => {
            calls.push(message);
            const state = states.length > 1 ? states.shift() : states[0];
            if (missing)
              (window as any).chrome.runtime.lastError = {
                message: "private C:\\Users\\secret ?token=secret",
              };
            callback(
              state === "legacy"
                ? { ok: true, id: message.id }
                : message.action === "health"
                  ? {
                      version: 2,
                      id: message.id,
                      state: "health",
                      app_ready: state === "health_ready",
                      host_version: "0.2.0-beta.1",
                      capabilities: ["explicit"],
                    }
                  : {
                      version: 2,
                      id: message.id,
                      state: state === "destination" ? "rejected" : state,
                      ...(state === "destination" ? { code: "destination" } : {}),
                    },
            );
            delete (window as any).chrome.runtime.lastError;
          },
        },
      };
    },
    { states, language, messages, missing },
  );
  await page.goto("/extension/popup.html");
  if (!submit) return;
  await page.locator("#url").fill("https://example.com/file?token=private");
  await page.locator("form button").click();
}

for (const language of ["en", "ar"]) {
  test(`browser distinguishes receipt from queued in ${language}`, async ({ page }) => {
    await page.clock.install();
    await popup(page, ["received", "queued"], language);
    await expect(page.locator("#status.pending")).toBeVisible();
    await expect(page.locator("form button")).toBeDisabled();
    await page.clock.runFor(350);
    await expect(page.locator("#status.success")).toBeVisible();
    await expect(page.locator("#url")).toHaveValue("");
    const calls = await page.evaluate(() => (window as any).nativeCalls);
    expect(calls.map((call: any) => call.action)).toEqual(["enqueue", "status"]);
    expect(calls[0].id).toEqual(calls[1].id);
    expect(calls[1].url).toBeUndefined();
    await expect(page.locator("html")).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr");
  });
  test(`browser shows a final duplicate rejection in ${language}`, async ({ page }) => {
    await popup(page, ["destination"], language);
    await expect(page.locator("#status.error")).toBeVisible();
    await expect(page.locator("#status")).toContainText(
      language === "ar" ? "اسم الملف مشغول" : "filename is occupied",
    );
    await expect(page.locator("#url")).toHaveValue("https://example.com/file?token=private");
    await expect(page.locator("form button")).toBeEnabled();
  });
}

test("receipt timeout never resends an enqueue or claims completion", async ({ page }) => {
  await page.clock.install();
  await popup(page, ["received"]);
  await page.clock.runFor(15500);
  await expect(page.locator("#status.error")).toContainText("may still be queued");
  expect(
    await page.evaluate(
      () => (window as any).nativeCalls.filter((call: any) => call.action === "enqueue").length,
    ),
  ).toBe(1);
});

for (const language of ["en", "ar"]) {
  test(`health is separate from enqueue and reports app readiness in ${language}`, async ({
    page,
  }) => {
    await popup(page, ["health_host"], language, false, false);
    await page.locator("#check-connection").click();
    await expect(page.locator("#health")).toContainText(
      language === "ar" ? "لا توجد إشارة" : "no recent readiness",
    );
    const calls = await page.evaluate(() => (window as any).nativeCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe("health");
    expect(calls[0].url).toBeUndefined();
    await page.unrouteAll();
    await popup(page, ["health_ready"], language, false, false);
    await page.locator("#check-connection").click();
    await expect(page.locator("#health.success")).toBeVisible();
  });
}

test("missing host errors omit native details and legacy hosts need an update", async ({
  page,
}) => {
  await popup(page, ["received"], "en", true);
  await expect(page.locator("#status.error")).toContainText("connect the browser");
  await expect(page.locator("#status")).not.toContainText("secret");
  await page.unrouteAll();
  await popup(page, ["legacy"]);
  await expect(page.locator("#status.error")).toContainText("Update ZipZap");
});
