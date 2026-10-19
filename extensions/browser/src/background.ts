import { sendLink } from "./shared.js";
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({
      id: "zipzap-download",
      title: chrome.i18n.getMessage("menu"),
      contexts: ["link"],
    }),
  );
});
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "zipzap-download" || !info.linkUrl) return;
  try {
    await sendLink(info.linkUrl, () => {
      void chrome.action.setBadgeText({ text: "…" });
      void chrome.action.setBadgeBackgroundColor({ color: "#596b76" });
      void chrome.action.setTitle({ title: chrome.i18n.getMessage("received") });
    });
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: chrome.i18n.getMessage("sent") });
  } catch (error) {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#af2c20" });
    await chrome.action.setTitle({
      title: error instanceof Error ? error.message : chrome.i18n.getMessage("missing"),
    });
  }
});
