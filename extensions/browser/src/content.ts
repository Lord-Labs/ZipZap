(() => {
  if (window.top !== window || chrome.extension.inIncognitoContext) return;
  let enabled = false,
    busy = false,
    activated = false,
    attempt = "";
  void chrome.runtime
    .sendMessage({ type: "zipzapPolicyRead" })
    .then((value) => {
      enabled = value?.enabled === true;
    })
    .catch(() => {});
  let original: { url: string; download: string | null } | null = null;
  const host = document.createElement("div");
  host.dataset.zipzap = "capture";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    ":host{all:initial;position:fixed;inset:auto 16px 16px auto;z-index:2147483647;font:14px/1.6 Segoe UI,Tahoma,sans-serif;color:#192d36}section{max-width:min(360px,calc(100vw - 32px));padding:16px;background:#f7faf9;border:1px solid #aebbc4;border-radius:12px;box-shadow:0 4px 24px #0003}p{margin:6px 0;overflow-wrap:anywhere}button{font:inherit;cursor:pointer;padding:8px 12px;margin:8px 4px 0;border:1px solid #aebbc4;border-radius:6px;background:white;color:#192d36}button:focus-visible{outline:3px solid #df6b25;outline-offset:2px}button:disabled{opacity:.6}";
  const panel = document.createElement("section");
  panel.dir = chrome.i18n.getUILanguage().startsWith("ar") ? "rtl" : "ltr";
  const title = document.createElement("strong");
  title.textContent = "ZipZap";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const check = document.createElement("button");
  check.textContent = chrome.i18n.getMessage("captureCheck");
  check.hidden = true;
  const dismiss = document.createElement("button");
  dismiss.textContent = chrome.i18n.getMessage("captureDismiss");
  panel.append(title, status, check, dismiss);
  shadow.append(style, panel);
  function show(key: string): void {
    status.textContent = chrome.i18n.getMessage(key);
    if (!host.isConnected) document.documentElement.append(host);
  }
  function fallback(): void {
    if (!original) return;
    const anchor = document.createElement("a");
    anchor.href = original.url;
    if (original.download !== null) anchor.setAttribute("download", original.download);
    anchor.hidden = true;
    document.documentElement.append(anchor);
    anchor.click();
    anchor.remove();
    original = null;
    busy = false;
    check.hidden = true;
    show("captureFallback");
  }
  type Reply = { state?: string; disabled?: boolean };
  async function rpc(action: string, url?: string): Promise<Reply> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return (await Promise.race([
        chrome.runtime.sendMessage({
          type: "zipzapCapture",
          action,
          id: attempt,
          ...(url ? { url } : {}),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Timeout")), 20000);
        }),
      ])) as Reply;
    } finally {
      clearTimeout(timer);
    }
  }
  function finish(reply: Reply): void {
    if (reply.disabled) enabled = false;
    if (reply.state === "queued") {
      busy = false;
      original = null;
      check.hidden = true;
      show("captureQueued");
    } else if (reply.state === "fallback") fallback();
    else {
      check.hidden = false;
      show("captureUnknown");
    }
  }
  dismiss.addEventListener("click", () => host.remove());
  check.addEventListener("click", async () => {
    check.disabled = true;
    try {
      finish(await rpc("status"));
    } catch {
      show("captureUnknown");
    } finally {
      check.disabled = false;
    }
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (
      sender.id === chrome.runtime.id &&
      message &&
      typeof message === "object" &&
      (message as { type?: unknown }).type === "zipzapPolicy"
    ) {
      const sites = (message as { sites?: unknown }).sites;
      enabled = Array.isArray(sites) && sites.includes(location.origin);
    }
  });
  window.addEventListener("click", async (event: MouseEvent) => {
    if (
      !enabled ||
      !event.isTrusted ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.detail === 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement) as
      HTMLAnchorElement | undefined;
    if (!anchor) return;
    const target =
      anchor.getAttribute("target") ||
      document.querySelector("base[target]")?.getAttribute("target") ||
      "_self";
    if (target !== "_self" || anchor.hasAttribute("ping")) return;
    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      return;
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== location.origin ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.href.length > 16384
    )
      return;
    if (
      !anchor.hasAttribute("download") &&
      !/\.(zip|7z|tar|gz|pdf|iso|exe|msi|mp4|webm|mp3|csv)$/i.test(url.pathname)
    )
      return;
    event.preventDefault();
    if (busy) {
      if (!host.isConnected) document.documentElement.append(host);
      return;
    }
    busy = true;
    activated = false;
    attempt = crypto.randomUUID();
    original = { url: url.href, download: anchor.getAttribute("download") };
    check.hidden = true;
    show("capturePreparing");
    try {
      const prepared = await rpc("prepare", url.href);
      if (prepared.disabled) enabled = false;
      if (prepared.state !== "prepared") {
        finish(prepared);
        return;
      }
      if (!enabled) {
        fallback();
        return;
      }
      activated = true;
      show("captureActivating");
      finish(await rpc("activate"));
    } catch {
      if (activated) {
        check.hidden = false;
        show("captureUnknown");
      } else fallback();
    }
  });
})();
