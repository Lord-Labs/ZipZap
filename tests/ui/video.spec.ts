import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, mkdir } from "node:fs/promises";

let owned: Buffer;
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d")!;
    const recorder = new MediaRecorder(canvas.captureStream(10), {
        mimeType: "video/webm;codecs=vp8",
      }),
      chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    let frame = 0;
    const paint = setInterval(() => {
      context.fillStyle = frame++ % 2 ? "#087f70" : "#df6b25";
      context.fillRect(0, 0, 320, 180);
    }, 40);
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 400));
    recorder.stop();
    await stopped;
    clearInterval(paint);
    return Array.from(new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()));
  });
  owned = Buffer.from(bytes);
  await page.close();
});
async function fixture(
  page: Page,
  language = "en",
  replies = ["prepared", "queued"],
  delay = 0,
  players = 1,
  watch = false,
) {
  const messages = JSON.parse(
    await readFile(`extensions/browser/_locales/${language}/messages.json`, "utf8"),
  );
  await page.route(watch ? "https://www.youtube.com/watch?**" : "**/video-fixture*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="${language}"><title>Owned video fixture</title><style>#players{display:grid;grid-template-columns:repeat(3,320px);gap:8px}video{width:320px;height:180px}.html5-video-player{width:320px;height:180px;overflow:hidden}.html5-video-player video{position:relative;top:-180px}</style><main><h1>Owned videos</h1><button id="fullscreen" onclick="document.querySelector('#players').requestFullscreen()">Fullscreen</button><div id="players" class="${watch ? "html5-video-player" : ""}">${Array.from({ length: players }, (_, index) => `<video id="player-${index}" controls muted preload="auto" src="/clip-${index}.webm?signature=fixture"></video>`).join("")}</div></main></html>`,
    }),
  );
  await page.route("**/clip-*", (route) =>
    route.fulfill({ contentType: "video/webm", body: owned }),
  );
  await page.addInitScript(
    ({ messages, language, replies, delay }) => {
      (window as any).captureCalls = [];
      (window as any).chrome = {
        extension: { inIncognitoContext: false },
        i18n: {
          getUILanguage: () => language,
          getMessage: (key: string) => messages[key]?.message || key,
        },
        runtime: {
          id: "fixture",
          onMessage: {
            addListener: (listener: any) => {
              (window as any).videoListener = listener;
            },
          },
          sendMessage: async (message: any) => {
            if (message.type === "zipzapPolicyRead") return { enabled: true, video: true };
            if (message.type === "zipzapVideoHide") return {};
            (window as any).captureCalls.push(message);
            if (message.action === "cancel_prepare") return { state: "cancelled" };
            const state = replies.length > 1 ? replies.shift() : replies[0];
            if (message.action === "prepare_video" && delay)
              await new Promise((resolve) => setTimeout(resolve, delay));
            return { state };
          },
        },
      };
    },
    { messages, language, replies, delay },
  );
  await page.goto(watch ? "https://www.youtube.com/watch?v=YE7VzlLtp-4" : "/video-fixture");
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("video")).every(
      (video) => video.readyState >= 1 && video.videoWidth === 320,
    ),
  );
  await page.addScriptTag({ path: "dist/extension/content.js" });
  await expect(page.locator('[data-zipzap="video"]')).toHaveCount(Math.min(8, players));
}
for (const language of ["en", "ar"])
  test(`video button is explicit and accessible in ${language}`, async ({ page }) => {
    await fixture(page, language);
    let downloads = 0;
    page.on("download", () => downloads++);
    const badge = page.locator('[data-zipzap="video"]');
    const action = badge.getByRole("button", {
      name:
        language === "ar" ? /^تنزيل باستخدام ZipZap — الفيديو/ : /^Download with ZipZap — Video/,
    });
    await action.focus();
    await action.press("Enter");
    await expect(page.locator('[data-zipzap="capture"]').getByRole("status")).toContainText(
      language === "ar" ? "أُضيف إلى" : "Added to ZipZap",
    );
    const calls = await page.evaluate(() => (window as any).captureCalls);
    expect(calls.map((value: any) => value.action)).toEqual(["prepare_video", "activate"]);
    expect(calls[0].id).toBe(calls[1].id);
    expect(downloads).toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await mkdir(".research-local/ui", { recursive: true });
    await page.screenshot({ path: `.research-local/ui/video-${language}.png` });
  });
test("cancelled video preparation never activates its late response or downloads an HTML copy", async ({
  page,
}) => {
  await page.clock.install();
  await fixture(page, "en", ["prepared", "queued"], 1000);
  let downloads = 0;
  page.on("download", () => downloads++);
  await page
    .locator('[data-zipzap="video"]')
    .getByRole("button", { name: /^Download with ZipZap — Video/ })
    .click();
  await page
    .locator('[data-zipzap="capture"]')
    .getByRole("button", { name: "Cancel preparation" })
    .click();
  await page.clock.runFor(1500);
  await expect(page.locator('[data-zipzap="capture"]').getByRole("status")).toContainText(
    "Preparation cancelled",
  );
  expect(
    (await page.evaluate(() => (window as any).captureCalls)).map((value: any) => value.action),
  ).toEqual(["prepare_video", "cancel_prepare"]);
  expect(downloads).toBe(0);
});
test("refused video never falls back to a browser download", async ({ page }) => {
  await fixture(page, "en", ["fallback"]);
  let downloads = 0;
  page.on("download", () => downloads++);
  await page
    .locator('[data-zipzap="video"]')
    .getByRole("button", { name: /^Download with ZipZap — Video/ })
    .click();
  await expect(page.locator('[data-zipzap="capture"]').getByRole("status")).toContainText(
    "No browser copy was started",
  );
  expect(downloads).toBe(0);
});
test("discovery is bounded and follows source changes and SPA player replacement", async ({
  page,
}) => {
  await fixture(page, "en", ["prepared", "queued"], 0, 9);
  await page.evaluate(() => {
    document.querySelectorAll("video").forEach((video, index) => {
      if (index >= 6) video.remove();
    });
    document.querySelector<HTMLVideoElement>("video")!.src = "/clip-changed.webm?signature=changed";
  });
  await expect(page.locator('[data-zipzap="video"]')).toHaveCount(6);
  await page
    .locator('[data-zipzap="video"]')
    .getByRole("button", { name: "Download with ZipZap — Video 1", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).captureCalls[0]?.url))
    .toContain("clip-changed.webm");
  await page.evaluate(() => {
    history.pushState({}, "", "/video-fixture?route=next");
    document.querySelector("#players")!.innerHTML =
      '<video width="320" height="180" controls muted src="/clip-next.webm"></video>';
  });
  await expect(page.locator('[data-zipzap="video"]')).toHaveCount(1);
  await page
    .locator('[data-zipzap="video"]')
    .getByRole("button", { name: "Hide video buttons on this site" })
    .click();
  await expect(page.locator('[data-zipzap="video"]')).toHaveCount(0);
});
test("YouTube thumbnail player keeps its action when the video element is displaced", async ({
  page,
}) => {
  await fixture(page, "en", ["prepared", "queued"], 0, 1, true);
  await page
    .locator('[data-zipzap="video"]')
    .getByRole("button", { name: /^Download with ZipZap/ })
    .click();
  await expect(page.locator('[data-zipzap="capture"]').getByRole("status")).toContainText(
    "Added to ZipZap",
  );
  expect((await page.evaluate(() => (window as any).captureCalls))[0].url).toBe(
    "https://www.youtube.com/watch?v=YE7VzlLtp-4",
  );
});
test("scrolling the player out of view hides its button and returning restores it", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#players")!.style.marginTop = "1000px";
  });
  await expect(page.locator('[data-zipzap="video"]')).toHaveCount(0);
  await page.locator("video").scrollIntoViewIfNeeded();
  await expect(page.locator('[data-zipzap="video"]')).toHaveCount(1);
});
test("fullscreen container hosts the badge and native video fullscreen uses same-page popup feedback", async ({
  page,
}) => {
  await fixture(page);
  await page.locator("#fullscreen").click();
  await expect(page.locator('#players > [data-zipzap="video"]')).toHaveCount(1);
  await page.evaluate(() => document.exitFullscreen());
  await page.locator("video").evaluate((video) => video.requestFullscreen());
  await expect(page.locator('[data-zipzap="video"]')).toHaveCount(0);
  const result: any = await page.evaluate(
    () =>
      new Promise((resolve) =>
        (window as any).videoListener({ type: "zipzapVideoAction" }, { id: "fixture" }, resolve),
      ),
  );
  expect(result.state).toBe("queued");
  expect(result.started).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
});
test("playable blob and HLS-shaped sources are not presented as direct downloadable videos", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate((bytes) => {
    const video = document.querySelector<HTMLVideoElement>("video")!;
    video.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/webm" }));
  }, Array.from(owned));
  await expect(page.locator('[data-zipzap="video"]')).toHaveCount(0);
  await page.locator("video").evaluate((video) => {
    video.src = "/clip-stream.m3u8";
  });
  await page.waitForFunction(
    () => document.querySelector<HTMLVideoElement>("video")!.error !== null,
  );
  await expect(page.locator('[data-zipzap="video"]')).toHaveCount(0);
});
