(() => {
  if (window.top !== window || chrome.extension.inIncognitoContext) return;
  let enabled = false,
    videoEnabled = false,
    busy = false,
    activated = false,
    modeVideo = false,
    attempt = "",
    generation = 0;
  let original: { url: string; download: string | null } | null = null;
  const text = (key: string) => chrome.i18n.getMessage(key);
  const controls =
    "button{font:inherit;cursor:pointer;padding:8px 12px;margin:8px 4px 0;border:1px solid #aebbc4;border-radius:6px;background:white;color:#192d36}button:focus-visible{outline:3px solid #df6b25;outline-offset:2px}button:disabled{opacity:.6}";
  const host = document.createElement("div");
  host.dataset.zipzap = "capture";
  const shadow = host.attachShadow({ mode: "open" }),
    style = document.createElement("style");
  style.textContent =
    ":host{all:initial;position:fixed;inset:auto 16px 16px auto;z-index:2147483647;font:14px/1.6 Segoe UI,Tahoma,sans-serif;color:#192d36}section{max-width:min(360px,calc(100vw - 32px));padding:16px;background:#f7faf9;border:1px solid #aebbc4;border-radius:12px;box-shadow:0 4px 24px #0003}p{margin:6px 0;overflow-wrap:anywhere}" +
    controls;
  const panel = document.createElement("section");
  panel.dir = chrome.i18n.getUILanguage().startsWith("ar") ? "rtl" : "ltr";
  const title = document.createElement("strong");
  title.textContent = "ZipZap";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const check = document.createElement("button");
  check.textContent = text("captureCheck");
  check.hidden = true;
  const cancel = document.createElement("button");
  cancel.textContent = text("videoCancel");
  cancel.hidden = true;
  const dismiss = document.createElement("button");
  dismiss.textContent = text("captureDismiss");
  panel.append(title, status, check, cancel, dismiss);
  shadow.append(style, panel);
  function show(key: string): void {
    status.textContent = text(key);
    const fullscreen = document.fullscreenElement;
    const parent =
      fullscreen && fullscreen.tagName !== "VIDEO" ? fullscreen : document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
  }
  type Reply = { state?: string; disabled?: boolean };
  async function rpc(action: string, url?: string, id = attempt): Promise<Reply> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return (await Promise.race([
        chrome.runtime.sendMessage({ type: "zipzapCapture", action, id, ...(url ? { url } : {}) }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Timeout")),
            action === "prepare_video" ? 58000 : 20000,
          );
        }),
      ])) as Reply;
    } finally {
      clearTimeout(timer);
    }
  }
  function fallback(): void {
    busy = false;
    cancel.hidden = true;
    check.hidden = true;
    if (modeVideo || !original) {
      original = null;
      show("videoUnavailable");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = original.url;
    if (original.download !== null) anchor.setAttribute("download", original.download);
    anchor.hidden = true;
    document.documentElement.append(anchor);
    anchor.click();
    anchor.remove();
    original = null;
    show("captureFallback");
  }
  function finish(reply: Reply): void {
    if (reply.disabled) policy(false, false);
    cancel.hidden = true;
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
  function cancelVideo(): void {
    if (!busy || !modeVideo || activated) return;
    const id = attempt;
    generation++;
    busy = false;
    original = null;
    cancel.hidden = true;
    check.hidden = true;
    show("videoCancelled");
    void rpc("cancel_prepare", undefined, id).catch(() => {});
  }
  async function begin(url: string, download: string | null, video: boolean): Promise<Reply> {
    if (busy) {
      if (!host.isConnected) document.documentElement.append(host);
      return { state: "unknown" };
    }
    busy = true;
    activated = false;
    modeVideo = video;
    attempt = crypto.randomUUID();
    const id = attempt,
      token = ++generation;
    original = video ? null : { url, download };
    check.hidden = true;
    cancel.hidden = !video;
    show(video ? "videoPreparing" : "capturePreparing");
    try {
      const prepared = await rpc(video ? "prepare_video" : "prepare", url, id);
      if (token !== generation) return { state: "cancelled" };
      if (prepared.disabled) policy(false, false);
      if (prepared.state !== "prepared") {
        finish(prepared);
        return prepared;
      }
      if (!enabled || (video && !videoEnabled)) {
        fallback();
        return { state: "fallback" };
      }
      activated = true;
      cancel.hidden = true;
      show("captureActivating");
      const answer = await rpc("activate", undefined, id);
      finish(answer);
      return answer;
    } catch {
      if (token !== generation) return { state: "cancelled" };
      if (activated) {
        cancel.hidden = true;
        check.hidden = false;
        show("captureUnknown");
        return { state: "unknown" };
      } else {
        fallback();
        return { state: "fallback" };
      }
    }
  }
  dismiss.addEventListener("click", (event) => {
    if (event.isTrusted) host.remove();
  });
  cancel.addEventListener("click", (event) => {
    if (event.isTrusted) cancelVideo();
  });
  check.addEventListener("click", async (event) => {
    if (!event.isTrusted) return;
    check.disabled = true;
    try {
      finish(await rpc("status"));
    } catch {
      show("captureUnknown");
    } finally {
      check.disabled = false;
    }
  });
  function watchSource(): string | null {
    try {
      const url = new URL(location.href),
        ids = url.searchParams.getAll("v");
      return url.protocol === "https:" &&
        url.hostname === "www.youtube.com" &&
        !url.port &&
        url.pathname === "/watch" &&
        ids.length === 1 &&
        /^[\w-]{11}$/.test(ids[0])
        ? `https://www.youtube.com/watch?v=${ids[0]}`
        : null;
    } catch {
      return null;
    }
  }
  function sourceFor(video: HTMLVideoElement): string | null {
    const watch = watchSource();
    if (watch) return watch;
    if (video.readyState < 1 || video.videoWidth === 0 || video.videoHeight === 0) return null;
    try {
      const url = new URL(video.currentSrc);
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
  const badges = new Map<HTMLVideoElement, HTMLDivElement>();
  let observer: MutationObserver | null = null,
    resize: ResizeObserver | null = null,
    poll: ReturnType<typeof setInterval> | undefined,
    frame = 0;
  function schedule(): void {
    if (enabled && videoEnabled && !frame) frame = requestAnimationFrame(render);
  }
  function render(): void {
    frame = 0;
    const found = new Set<HTMLVideoElement>();
    if (enabled && videoEnabled && !document.hidden) {
      const watch = watchSource();
      const players = Array.from(document.querySelectorAll("video")).slice(0, 64);
      if (watch)
        players.sort(
          (a, b) =>
            b.getBoundingClientRect().width * b.getBoundingClientRect().height -
            a.getBoundingClientRect().width * a.getBoundingClientRect().height,
        );
      for (const video of players) {
        if (found.size >= (watch ? 1 : 8)) break;
        // YouTube can move the video above its visible player while showing a thumbnail.
        const player = watch ? video.closest(".html5-video-player") || video : video;
        const source = sourceFor(video),
          rect = player.getBoundingClientRect(),
          fullscreen = document.fullscreenElement;
        if (
          !source ||
          Math.min(rect.right, innerWidth) - Math.max(rect.left, 0) < 160 ||
          Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0) < 90 ||
          fullscreen === video ||
          (fullscreen && !fullscreen.contains(video))
        )
          continue;
        found.add(video);
        let badge = badges.get(video);
        if (!badge) {
          const element = document.createElement("div");
          element.dataset.zipzap = "video";
          const root = element.attachShadow({ mode: "open" });
          const css = document.createElement("style");
          css.textContent =
            ":host{all:initial;position:fixed;z-index:2147483646;font:13px/1.4 Segoe UI,Tahoma,sans-serif}.actions{display:flex;align-items:start;gap:4px;padding:4px;background:#f7faf9;border:1px solid #aebbc4;border-radius:8px;box-shadow:0 2px 12px #0003}" +
            controls +
            "button{margin:0;padding:8px}button:first-child{flex:1;background:#087f70;color:white;border-color:#087f70}";
          const actions = document.createElement("div");
          actions.className = "actions";
          actions.dir = panel.dir;
          const download = document.createElement("button");
          download.textContent = text("videoDownload");
          download.addEventListener("click", (event) => {
            if (event.isTrusted && enabled && videoEnabled) {
              const current = sourceFor(video);
              if (current) void begin(current, null, true);
            }
          });
          const hide = document.createElement("button");
          hide.textContent = "×";
          hide.title = text("videoHide");
          hide.setAttribute("aria-label", text("videoHide"));
          hide.addEventListener("click", (event) => {
            if (event.isTrusted)
              void chrome.runtime
                .sendMessage({ type: "zipzapVideoHide" })
                .then((value) => {
                  if (value?.error) show("captureSettingsError");
                  else policy(enabled, false);
                })
                .catch(() => show("captureSettingsError"));
          });
          actions.append(download, hide);
          root.append(css, actions);
          badge = element;
          badges.set(video, badge);
          resize?.observe(video);
        }
        const parent = fullscreen || document.documentElement;
        badge
          .shadowRoot!.querySelector("button")!
          .setAttribute(
            "aria-label",
            `${text("videoDownload")} — ${text("videoPlayer")} ${players.indexOf(video) + 1}`,
          );
        if (badge.parentElement !== parent) parent.append(badge);
        const width = Math.min(250, rect.width - 16);
        badge.style.width = `${width}px`;
        badge.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.right - width - 8))}px`;
        badge.style.top = `${Math.max(8, Math.min(innerHeight - 60, rect.top + 8))}px`;
      }
    }
    for (const [video, badge] of badges)
      if (!found.has(video)) {
        resize?.unobserve(video);
        badge.remove();
        badges.delete(video);
      }
  }
  function discovery(active: boolean): void {
    if (!active) {
      observer?.disconnect();
      observer = null;
      resize?.disconnect();
      resize = null;
      clearInterval(poll);
      poll = undefined;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      for (const badge of badges.values()) badge.remove();
      badges.clear();
      return;
    }
    if (!observer) {
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["src"],
      });
      resize = new ResizeObserver(schedule);
      poll = setInterval(() => {
        if (!document.hidden) schedule();
      }, 1000);
    }
    schedule();
  }
  function policy(site: boolean, video: boolean): void {
    enabled = site;
    videoEnabled = site && video;
    if (!videoEnabled) cancelVideo();
    discovery(videoEnabled);
  }
  function readPolicy(): void {
    void chrome.runtime
      .sendMessage({ type: "zipzapPolicyRead" })
      .then((value) => policy(value?.enabled === true, value?.video === true))
      .catch(() => policy(false, false));
  }
  readPolicy();
  window.addEventListener("pageshow", readPolicy);
  for (const event of [
    "resize",
    "scroll",
    "fullscreenchange",
    "visibilitychange",
    "loadedmetadata",
    "emptied",
    "popstate",
    "yt-navigate-finish",
  ])
    window.addEventListener(event, schedule, { capture: true, passive: true });
  window.addEventListener("pagehide", () => {
    if (busy && !activated) {
      if (modeVideo) cancelVideo();
      else generation++;
    }
    discovery(false);
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") return;
    const value = message as { type?: unknown; sites?: unknown; videoHidden?: unknown };
    if (value.type === "zipzapPolicy") {
      const allowed = Array.isArray(value.sites) && value.sites.includes(location.origin);
      policy(
        allowed,
        allowed && Array.isArray(value.videoHidden) && !value.videoHidden.includes(location.origin),
      );
    }
    if (value.type === "zipzapVideoAction") {
      if (!enabled || !videoEnabled) {
        reply({ started: false });
        return;
      }
      if (busy && activated) {
        void rpc("status")
          .then((result) => {
            finish(result);
            reply({ started: true, ...result });
          })
          .catch(() => reply({ started: true, state: "unknown" }));
        return true;
      }
      const source =
        watchSource() ||
        Array.from(document.querySelectorAll("video")).slice(0, 64).map(sourceFor).find(Boolean);
      if (!source || busy) {
        reply({ started: false, busy });
        return;
      }
      void begin(source, null, true).then((result) => reply({ started: true, ...result }));
      return true;
    }
  });
  window.addEventListener("click", (event) => {
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
    void begin(url.href, anchor.getAttribute("download"), false);
  });
})();
