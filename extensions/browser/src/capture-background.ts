import { captureOperation, validateLink } from "./shared.js";
import { permitted, reconcile, siteOrigin, sitePattern, sites } from "./capture-policy.js";

type Attempt = {
  id: string;
  tab: number;
  document: string;
  origin: string;
  phase: "prepare" | "prepared" | "activate";
  at: number;
};
type Reply = { state: "prepared" | "queued" | "fallback" | "unknown"; disabled?: boolean };
let writes: Promise<unknown> = Promise.resolve();
function attempts<T>(change: (saved: Attempt[]) => T): Promise<T> {
  const next = writes.then(async () => {
    const raw = (await chrome.storage.session.get("captureAttempts")).captureAttempts;
    const saved: Attempt[] = Array.isArray(raw)
      ? raw
          .filter(
            (value) =>
              value &&
              typeof value.id === "string" &&
              typeof value.at === "number" &&
              Date.now() - value.at < 86400000,
          )
          .slice(-100)
      : [];
    const result = change(saved);
    await chrome.storage.session.set({ captureAttempts: saved });
    return result;
  });
  writes = next.catch(() => {});
  return next;
}
function appAnswer(answer: { state: string; code?: string }): Reply {
  if (answer.state === "queued") return { state: "queued" };
  if (
    answer.state === "rejected" &&
    ["app_rejected", "destination", "capture_expired"].includes(answer.code || "")
  )
    return { state: "fallback" };
  return { state: "unknown" };
}
async function capture(
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
): Promise<Reply> {
  const { id, action, url } = message;
  if (
    Object.keys(message).some((key) => !["type", "id", "action", "url"].includes(key)) ||
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ||
    !["prepare", "activate", "status"].includes(String(action)) ||
    sender.frameId !== 0 ||
    sender.tab?.id === undefined ||
    sender.tab.incognito ||
    !sender.documentId
  )
    throw new Error("Invalid capture sender");
  const tab = sender.tab.id,
    document = sender.documentId,
    origin = siteOrigin(sender.url || "");
  const owns = (saved: Attempt) =>
    saved.id === id && saved.tab === tab && saved.document === document && saved.origin === origin;
  if (action === "status") {
    if (url !== undefined || !(await attempts((saved) => saved.some(owns))))
      return { state: "unknown" };
    return appAnswer(await captureOperation("status", id));
  }
  const enabled = (await sites()).includes(origin) && (await permitted(origin));
  if (action === "prepare") {
    if (typeof url !== "string") throw new Error("Invalid capture link");
    const target = new URL(validateLink(url));
    if (target.origin !== origin || target.search || target.hash || !enabled)
      return { state: "fallback", disabled: !enabled };
    const added = await attempts((saved) => {
      if (saved.some((value) => value.id === id)) return "existing";
      if (saved.length >= 100) saved.shift();
      saved.push({ id, tab, document, origin, phase: "prepare", at: Date.now() });
      return "added";
    });
    if (added !== "added") return { state: "unknown" };
    try {
      const answer = await captureOperation("prepare", id, target.href);
      if (answer.state === "prepared") {
        await attempts((saved) => {
          const attempt = saved.find(owns);
          if (attempt?.phase === "prepare") attempt.phase = "prepared";
        });
        return { state: "prepared" };
      }
      return answer.state === "queued" ? { state: "queued" } : { state: "fallback" };
    } catch {
      return { state: "fallback" };
    }
  }
  if (url !== undefined) throw new Error("Invalid activation");
  const phase = await attempts((saved) => {
    const attempt = saved.find(owns);
    if (!attempt) return "missing";
    if (attempt.phase !== "prepared") return attempt.phase;
    if (!enabled) return "disabled";
    attempt.phase = "activate";
    return "send";
  });
  if (phase === "disabled") return { state: "fallback", disabled: true };
  if (phase !== "send") return { state: "unknown" };
  return appAnswer(await captureOperation("activate", id));
}

let policyChanges: Promise<unknown> = Promise.resolve();
async function settings(message: Record<string, unknown>): Promise<{ sites: string[] }> {
  if (message.action === "read") return { sites: await sites() };
  const next = policyChanges.then(async () => {
    let enabled = await sites();
    const previous = enabled;
    if (message.action === "clear") enabled = [];
    else {
      const origin = siteOrigin(String(message.origin));
      if (origin !== message.origin) throw new Error("Invalid site");
      enabled = enabled.filter((value) => value !== origin);
      if (message.action === "enable") {
        if (enabled.length >= 32 || !(await permitted(origin)))
          throw new Error("Site permission unavailable");
        enabled.push(origin);
      } else if (message.action !== "disable") throw new Error("Invalid setting");
    }
    await chrome.storage.local.set({ captureSites: enabled });
    await reconcile();
    for (const origin of previous)
      if (!enabled.map(sitePattern).includes(sitePattern(origin))) {
        await chrome.permissions.remove({ origins: [sitePattern(origin)] });
      }
    return { sites: enabled };
  });
  policyChanges = next.catch(() => {});
  return next;
}

export function installCapture(): void {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") return;
    const value = message as Record<string, unknown>;
    if (value.type === "zipzapPolicyRead") {
      void (async () => {
        if (
          sender.frameId !== 0 ||
          !sender.tab ||
          sender.tab.incognito ||
          Object.keys(value).length !== 1
        )
          return { enabled: false };
        const origin = siteOrigin(sender.url || "");
        return { enabled: (await sites()).includes(origin) && (await permitted(origin)) };
      })()
        .then(reply)
        .catch(() => reply({ enabled: false }));
      return true;
    }
    if (value.type === "zipzapSettings" && sender.url === chrome.runtime.getURL("popup.html")) {
      void settings(value)
        .then(reply)
        .catch(() => reply({ error: true }));
      return true;
    }
    if (value.type !== "zipzapCapture") return;
    void capture(value, sender)
      .then((result) => {
        if (sender.tab?.id !== undefined)
          void chrome.action.setBadgeText({
            tabId: sender.tab.id,
            text: result.state === "unknown" ? "!" : "",
          });
        reply(result);
      })
      .catch(() => reply({ state: "unknown" }));
    return true;
  });
  const sync = () => {
    const next = policyChanges.then(reconcile);
    policyChanges = next.catch(() => {});
  };
  chrome.permissions.onRemoved.addListener(sync);
  chrome.runtime.onStartup.addListener(sync);
  chrome.runtime.onInstalled.addListener(sync);
}
