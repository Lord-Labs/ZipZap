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
export async function reconcile(): Promise<void> {
  const enabled: string[] = [];
  for (const origin of await sites()) if (await permitted(origin)) enabled.push(origin);
  await chrome.storage.local.set({ captureSites: enabled });
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
        .sendMessage(tab.id, { type: "zipzapPolicy", sites: enabled })
        .catch(() => {});
    }
}
