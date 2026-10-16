import { sendLink } from "./shared.js";
document.documentElement.lang = chrome.i18n.getUILanguage();
document.documentElement.dir = chrome.i18n.getUILanguage().startsWith("ar") ? "rtl" : "ltr";
for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]"))
  node.textContent = chrome.i18n.getMessage(node.dataset.i18n!);
const form = document.querySelector<HTMLFormElement>("form")!;
const input = document.querySelector<HTMLInputElement>("#url")!;
const button = document.querySelector<HTMLButtonElement>("button")!;
const status = document.querySelector<HTMLElement>("#status")!;
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = "";
  try {
    await sendLink(input.value);
    status.textContent = chrome.i18n.getMessage("sent");
    status.className = "success";
    input.value = "";
    await chrome.action.setBadgeText({ text: "" });
  } catch (error) {
    status.textContent = `${chrome.i18n.getMessage("missing")} ${error instanceof Error ? error.message : ""}`;
    status.className = "error";
  } finally {
    button.disabled = false;
  }
});
