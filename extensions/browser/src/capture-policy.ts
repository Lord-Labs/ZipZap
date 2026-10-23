export function siteOrigin(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Unsupported site");
  return url.origin;
}
export function sitePattern(origin: string): string {
  const url = new URL(siteOrigin(origin));
  return `${url.protocol}//${url.hostname}/*`;
}
export async function sites(): Promise<string[]> {
  const saved = (await chrome.storage.local.get("captureSites")).captureSites;
  if (!Array.isArray(saved)) return [];
  return [
    ...new Set(
      saved.filter((value): value is string => {
        try {
          return typeof value === "string" && value === siteOrigin(value);
        } catch {
          return false;
        }
      }),
    ),
  ].slice(0, 32);
}
export async function permitted(origin: string): Promise<boolean> {
  return chrome.permissions.contains({
    permissions: ["scripting"],
    origins: [sitePattern(origin)],
  });
}
export async function hiddenVideos(): Promise<string[]> {
  const raw = (await chrome.storage.local.get("videoHiddenSites")).videoHiddenSites;
  return Array.isArray(raw) ? (await sites()).filter((origin) => raw.includes(origin)) : [];
}
export function youtubePage(value: string): string | null {
  try {
    const url = new URL(value),
      ids = url.searchParams.getAll("v");
    return url.protocol === "https:" &&
      url.hostname === "www.youtube.com" &&
      !url.port &&
      url.pathname === "/watch" &&
      !url.username &&
      !url.password &&
      ids.length === 1 &&
      /^[\w-]{11}$/.test(ids[0])
      ? `https://www.youtube.com/watch?v=${ids[0]}`
      : null;
  } catch {
    return null;
  }
}
export function directVideo(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.href.length <= 16384 &&
      /\.(mp4|webm)$/i.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export async function reconcile(): Promise<void> {
  const enabled: string[] = [];
  for (const origin of await sites()) if (await permitted(origin)) enabled.push(origin);
  await chrome.storage.local.set({ captureSites: enabled });
  const hidden = await hiddenVideos();
  await chrome.storage.local.set({ videoHiddenSites: hidden });
  if (await chrome.permissions.contains({ permissions: ["scripting"] })) {
    const old = (await chrome.scripting.getRegisteredContentScripts()).filter((script) =>
      script.id.startsWith("zipzap-site-"),
    );
    if (old.length)
      await chrome.scripting.unregisterContentScripts({ ids: old.map((script) => script.id) });
    const patterns = [...new Set(enabled.map(sitePattern))];
    if (patterns.length)
      await chrome.scripting.registerContentScripts(
        patterns.map((pattern, index) => ({
          id: `zipzap-site-${index}`,
          matches: [pattern],
          js: ["content.js"],
          allFrames: false,
          runAt: "document_idle",
          persistAcrossSessions: true,
        })),
      );
  }
  for (const tab of await chrome.tabs.query({}))
    if (tab.id !== undefined) {
      void chrome.tabs
        .sendMessage(tab.id, { type: "zipzapPolicy", sites: enabled, videoHidden: hidden })
        .catch(() => {});
    }
}
