import { sendLink, checkConnection } from "./shared.js";
import { siteOrigin, sitePattern } from "./capture-policy.js";
document.documentElement.lang = chrome.i18n.getUILanguage();
document.documentElement.dir = chrome.i18n.getUILanguage().startsWith("ar") ? "rtl" : "ltr";
for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]"))
  node.textContent = chrome.i18n.getMessage(node.dataset.i18n!);
const form = document.querySelector<HTMLFormElement>("form")!;
const input = document.querySelector<HTMLInputElement>("#url")!;
const button = document.querySelector<HTMLButtonElement>("form button")!;
const status = document.querySelector<HTMLElement>("#status")!;
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = "";
  try {
    await sendLink(input.value, () => {
      status.textContent = chrome.i18n.getMessage("received");
      status.className = "pending";
    });
    status.textContent = chrome.i18n.getMessage("sent");
    status.className = "success";
    input.value = "";
    await chrome.action.setBadgeText({ text: "" });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : chrome.i18n.getMessage("missing");
    status.className = "error";
  } finally {
    button.disabled = false;
  }
});
const check = document.querySelector<HTMLButtonElement>("#check-connection")!;
const health = document.querySelector<HTMLElement>("#health")!;
check.addEventListener("click", async () => {
  check.disabled = true;
  health.textContent = chrome.i18n.getMessage("checkingConnection");
  try {
    const ready = await checkConnection();
    health.textContent = chrome.i18n.getMessage(ready ? "healthReady" : "healthHost");
    health.className = ready ? "success" : "pending";
  } catch (error) {
    health.textContent = error instanceof Error ? error.message : chrome.i18n.getMessage("missing");
    health.className = "error";
  } finally {
    check.disabled = false;
  }
});

const toggle = document.querySelector<HTMLButtonElement>("#capture-toggle")!;
const clear = document.querySelector<HTMLButtonElement>("#capture-clear")!;
const captureStatus = document.querySelector<HTMLElement>("#capture-status")!;
const list = document.querySelector<HTMLUListElement>("#capture-sites")!;
list.setAttribute("aria-label", chrome.i18n.getMessage("captureSites"));
let origin = "",
  enabled: string[] = [],
  hiddenVideos: string[] = [],
  activeTab: number | undefined;
const videoToggle = document.querySelector<HTMLButtonElement>("#video-toggle")!;
const videoDownload = document.querySelector<HTMLButtonElement>("#video-download")!;
const videoStatus = document.querySelector<HTMLElement>("#video-status")!;
function renderSites(): void {
  toggle.textContent = chrome.i18n.getMessage(
    enabled.includes(origin) ? "captureDisable" : "captureEnable",
  );
  list.replaceChildren();
  for (const site of enabled) {
    const li = document.createElement("li"),
      label = document.createElement("bdi"),
      off = document.createElement("button");
    label.textContent = site;
    off.type = "button";
    off.textContent = chrome.i18n.getMessage("captureDisable");
    off.setAttribute("aria-label", `${off.textContent}: ${site}`);
    off.addEventListener("click", () => void updateSites("disable", site));
    li.append(label, off);
    list.append(li);
  }
  clear.disabled = enabled.length === 0;
  videoToggle.disabled = !enabled.includes(origin);
  videoDownload.disabled =
    !enabled.includes(origin) || hiddenVideos.includes(origin) || activeTab === undefined;
  videoToggle.textContent = chrome.i18n.getMessage(
    hiddenVideos.includes(origin) ? "videoShow" : "videoHide",
  );
}
async function updateSites(action: string, site?: string): Promise<void> {
  toggle.disabled = true;
  try {
    const value = await chrome.runtime.sendMessage({
      type: "zipzapSettings",
      action,
      ...(site ? { origin: site } : {}),
    });
    if (!value || !Array.isArray(value.sites)) throw new Error("Settings unavailable");
    enabled = value.sites;
    hiddenVideos = Array.isArray(value.hiddenVideos) ? value.hiddenVideos : [];
    renderSites();
    captureStatus.textContent = chrome.i18n.getMessage("captureReload");
    captureStatus.className = "success";
  } catch {
    captureStatus.textContent = chrome.i18n.getMessage("captureSettingsError");
    captureStatus.className = "error";
  } finally {
    toggle.disabled = !origin;
  }
}
toggle.addEventListener("click", () => {
  if (enabled.includes(origin)) {
    void updateSites("disable", origin);
    return;
  }
  // Request immediately in the user gesture; no permission is requested on load.
  void chrome.permissions
    .request({ permissions: ["scripting"], origins: [sitePattern(origin)] })
    .then((granted) => {
      if (granted) void updateSites("enable", origin);
      else {
        captureStatus.textContent = chrome.i18n.getMessage("captureDenied");
        captureStatus.className = "error";
      }
    })
    .catch(() => {
      captureStatus.textContent = chrome.i18n.getMessage("captureSettingsError");
      captureStatus.className = "error";
    });
});
clear.addEventListener("click", () => void updateSites("clear"));
videoToggle.addEventListener(
  "click",
  () => void updateSites(hiddenVideos.includes(origin) ? "video_show" : "video_hide", origin),
);
videoDownload.addEventListener("click", async () => {
  videoDownload.disabled = true;
  videoStatus.textContent = chrome.i18n.getMessage("videoPreparing");
  try {
    const reply = await chrome.runtime.sendMessage({
      type: "zipzapVideoFromPopup",
      tabId: activeTab,
    });
    videoStatus.textContent = chrome.i18n.getMessage(
      reply?.started
        ? reply.state === "queued"
          ? "captureQueued"
          : reply.state === "unknown"
            ? "captureUnknown"
            : reply.state === "cancelled"
              ? "videoCancelled"
              : "videoUnavailable"
        : reply?.busy
          ? "videoPreparing"
          : "videoNoSource",
    );
  } catch {
    videoStatus.textContent = chrome.i18n.getMessage("videoNoSource");
  } finally {
    renderSites();
  }
});
void (async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && !tab.incognito) {
      origin = siteOrigin(tab.url);
      activeTab = tab.id;
    }
  } catch {}
  document.querySelector<HTMLElement>("#site-origin")!.textContent =
    origin || chrome.i18n.getMessage("captureNoSite");
  toggle.disabled = !origin;
  try {
    const value = await chrome.runtime.sendMessage({ type: "zipzapSettings", action: "read" });
    enabled = Array.isArray(value?.sites) ? value.sites : [];
    hiddenVideos = Array.isArray(value?.hiddenVideos) ? value.hiddenVideos : [];
    renderSites();
  } catch {
    clear.disabled = true;
  }
})();
