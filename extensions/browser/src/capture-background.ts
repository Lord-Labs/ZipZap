import { captureOperation, validateLink } from "./shared.js";
import {
  directVideo,
  hiddenVideos,
  permitted,
  reconcile,
  siteOrigin,
  sitePattern,
  sites,
  youtubePage,
} from "./capture-policy.js";

type Attempt = {
  id: string;
  tab: number;
  document: string;
  origin: string;
  phase: "prepare" | "prepared" | "activate" | "cancelled";
  video?: boolean;
  at: number;
};
type Reply = {
  state: "prepared" | "queued" | "fallback" | "unknown" | "cancelled";
  disabled?: boolean;
};
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
function context(sender: chrome.runtime.MessageSender) {
  if (
    sender.frameId !== 0 ||
    sender.tab?.id === undefined ||
    sender.tab.incognito ||
    !sender.documentId
  )
    throw new Error("Invalid page sender");
  return { tab: sender.tab.id, document: sender.documentId, origin: siteOrigin(sender.url || "") };
}
function appAnswer(answer: { state: string; code?: string }): Reply {
  if (answer.state === "queued") return { state: "queued" };
  if (
    answer.state === "rejected" &&
    [
      "app_rejected",
      "destination",
      "capture_expired",
      "capture_cancelled",
      "video_unavailable",
    ].includes(answer.code || "")
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
    !["prepare", "prepare_video", "activate", "status", "cancel_prepare"].includes(String(action))
  )
    throw new Error("Invalid capture request");
  const { tab, document, origin } = context(sender);
  const owns = (saved: Attempt) =>
    saved.id === id && saved.tab === tab && saved.document === document && saved.origin === origin;
  if (action === "status") {
    if (url !== undefined || !(await attempts((saved) => saved.some(owns))))
      return { state: "unknown" };
    return appAnswer(await captureOperation("status", id));
  }
  if (action === "cancel_prepare") {
    if (url !== undefined) return { state: "unknown" };
    const cancel = await attempts((saved) => {
      const attempt = saved.find(owns);
      if (!attempt || attempt.phase === "activate") return false;
      attempt.phase = "cancelled";
      return true;
    });
    if (!cancel) return { state: "unknown" };
    await captureOperation("cancel_prepare", id).catch(() => {});
    return { state: "cancelled" };
  }
  const enabled = (await sites()).includes(origin) && (await permitted(origin));
  if (action === "prepare" || action === "prepare_video") {
    if (typeof url !== "string") throw new Error("Invalid source");
    const target = new URL(validateLink(url)),
      video = action === "prepare_video";
    const eligible = video
      ? (directVideo(url) !== null || youtubePage(sender.url || "") === url) &&
        !(await hiddenVideos()).includes(origin)
      : target.origin === origin && !target.search && !target.hash;
    if (!enabled || !eligible) return { state: "fallback", disabled: !enabled };
    const added = await attempts((saved) => {
      if (saved.some((value) => value.id === id)) return false;
      if (saved.length >= 100) saved.shift();
      saved.push({ id, tab, document, origin, phase: "prepare", video, at: Date.now() });
      return true;
    });
    if (!added) return { state: "unknown" };
    try {
      const answer = await captureOperation(action, id, target.href);
      if (answer.state === "prepared") {
        const ready = await attempts((saved) => {
          const attempt = saved.find(owns);
          if (attempt?.phase !== "prepare") return false;
          attempt.phase = "prepared";
          return true;
        });
        return { state: ready ? "prepared" : "unknown" };
      }
      return answer.state === "queued" ? { state: "queued" } : { state: "fallback" };
    } catch {
      return { state: "fallback" };
    }
  }
  if (url !== undefined) throw new Error("Invalid activation");
  const videoHidden = (await hiddenVideos()).includes(origin);
  const phase = await attempts((saved) => {
    const attempt = saved.find(owns);
    if (!attempt) return "missing";
    if (attempt.phase !== "prepared") return attempt.phase;
    if (!enabled || (attempt.video && videoHidden)) return "disabled";
    attempt.phase = "activate";
    return "send";
  });
  if (phase === "disabled") return { state: "fallback", disabled: !enabled };
  if (phase !== "send") return { state: "unknown" };
  return appAnswer(await captureOperation("activate", id));
}
let policyChanges: Promise<unknown> = Promise.resolve();
async function settings(
  message: Record<string, unknown>,
): Promise<{ sites: string[]; hiddenVideos: string[] }> {
  if (Object.keys(message).some((key) => !["type", "action", "origin"].includes(key)))
    throw new Error("Invalid setting");
  if (message.action === "read")
    return { sites: await sites(), hiddenVideos: await hiddenVideos() };
  const next = policyChanges.then(async () => {
    let enabled = await sites(),
      hidden = await hiddenVideos();
    const previous = enabled;
    if (message.action === "clear") {
      enabled = [];
      hidden = [];
    } else {
      const origin = siteOrigin(String(message.origin));
      if (origin !== message.origin) throw new Error("Invalid site");
      if (message.action === "video_hide" || message.action === "video_show") {
        if (!enabled.includes(origin)) throw new Error("Site disabled");
        hidden = hidden.filter((value) => value !== origin);
        if (message.action === "video_hide") hidden.push(origin);
      } else {
        enabled = enabled.filter((value) => value !== origin);
        if (message.action === "enable") {
          if (enabled.length >= 32 || !(await permitted(origin)))
            throw new Error("Site permission unavailable");
          enabled.push(origin);
        } else if (message.action !== "disable") throw new Error("Invalid setting");
      }
    }
    await chrome.storage.local.set({ captureSites: enabled, videoHiddenSites: hidden });
    await reconcile();
    for (const origin of previous)
      if (!enabled.map(sitePattern).includes(sitePattern(origin)))
        await chrome.permissions.remove({ origins: [sitePattern(origin)] });
    return { sites: enabled, hiddenVideos: await hiddenVideos() };
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
        if (Object.keys(value).length !== 1) return { enabled: false, video: false };
        const { origin } = context(sender);
        const enabled = (await sites()).includes(origin) && (await permitted(origin));
        return { enabled, video: enabled && !(await hiddenVideos()).includes(origin) };
      })()
        .then(reply)
        .catch(() => reply({ enabled: false, video: false }));
      return true;
    }
    if (value.type === "zipzapVideoHide") {
      void (async () => {
        if (Object.keys(value).length !== 1) throw new Error("Invalid setting");
        const { origin } = context(sender);
        return settings({ action: "video_hide", origin });
      })()
        .then(reply)
        .catch(() => reply({ error: true }));
      return true;
    }
    if (sender.url === chrome.runtime.getURL("popup.html")) {
      if (value.type === "zipzapSettings") {
        void settings(value)
          .then(reply)
          .catch(() => reply({ error: true }));
        return true;
      }
      if (value.type === "zipzapVideoFromPopup") {
        void (async () => {
          if (
            Object.keys(value).some((key) => !["type", "tabId"].includes(key)) ||
            !Number.isInteger(value.tabId)
          )
            throw new Error("Invalid tab");
          const tab = await chrome.tabs.get(value.tabId as number),
            origin = siteOrigin(tab.url || "");
          if (
            tab.incognito ||
            !(await sites()).includes(origin) ||
            !(await permitted(origin)) ||
            (await hiddenVideos()).includes(origin)
          )
            return { started: false };
          return chrome.tabs.sendMessage(value.tabId as number, { type: "zipzapVideoAction" });
        })()
          .then(reply)
          .catch(() => reply({ started: false }));
        return true;
      }
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
