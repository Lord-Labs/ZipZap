import { sendLink, checkConnection } from "./shared.js";
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
