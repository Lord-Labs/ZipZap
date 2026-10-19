<script lang="ts">
  import { onMount, tick } from "svelte";

  import { invoke } from "@tauri-apps/api/core";

  import Icon from "./Icon.svelte";
  import BatchDialog from "./BatchDialog.svelte";
  import defaultCategories from "../../../config/categories.json";
  import defaultView from "../../../config/view.json";

  import { dictionary, type Language } from "./i18n";

  type Status = "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";

  type Job = {
    id: string;
    url: string;
    destination: string;
    status: Status;
    downloaded: number;
    total: number | null;
    speed: number;
    error: string | null;
    attempt?: number;
    next_retry?: number | null;
    failure_reason?: string | null;
  };

  type Category = {
    id: string;
    name: string;
    extensions: string[];
    download_folder: string | null;
  };
  type Settings = {
    max_concurrent: number;
    connections: number;
    speed_limit: number;
    language: Language;
    download_folder: string | null;
    close_to_tray: boolean;
    notifications: boolean;
    categories: Category[];
    view: typeof defaultView;
  };

  type Snapshot = {
    jobs: Job[];
    queue: { running: boolean; waiting: string[] };
    settings: Settings;
    folder: string;
    version: string;
    native_error: string | null;
    tray_available: boolean;
    notice: string | null;
    browser_review?: { url: string; destination: string; suggestion: Suggestion } | null;
  };
  type Suggestion = {
    filename: string;
    total: number | null;
    alternative: string | null;
    destination?: string;
    category?: string;
  };

  let jobs: Job[] = [];
  let queue = { running: true, waiting: [] as string[] };
  let queueBusy = false;
  let addLater = false;

  let settings: Settings = {
    max_concurrent: 2,
    connections: 2,
    speed_limit: 0,
    language: "en",
    download_folder: null,
    close_to_tray: false,
    notifications: false,
    categories: structuredClone(defaultCategories),
    view: structuredClone(defaultView),
  };

  let language: Language = "en";

  $: text = dictionary(language);
  $: failureMessages = {
    network: text.reasonNetwork,
    server: text.reasonServer,
    rate_limited: text.reasonRateLimited,
    http: text.reasonHttp,
    authentication: text.reasonAuthentication,
    tls: text.reasonTls,
    storage_full: text.storageFull,
    storage_access: text.storageAccess,
    destination_missing: text.storageMissing,
    storage: text.storageOther,
    input: text.reasonInput,
    integrity: text.reasonIntegrity,
    conflict: text.reasonConflict,
  } as Record<string, string>;

  let folder = "";

  let version = "0.1.0-beta.1";

  let filter = "all";

  let category = "all";
  let selectedIds = new Set<string>();
  let selectionAnchor = "";
  let bulkBusy = false;
  let bulkResults: { id: string; name: string; result: string }[] = [];
  let confirmDialog: HTMLDialogElement;
  let confirmTargets: Job[] = [];
  let confirmValue = "";
  let batchDialog: BatchDialog;
  let sortKey: "recent" | "filename" | "total" | "status" = "recent";
  let descending = false;
  let viewBusy = false;
  let systemDark = false;
  let searchInput: HTMLInputElement;
  let contextDialog: HTMLDialogElement;
  let contextId = "";
  $: contextJob = jobs.find((job) => job.id === contextId);
  $: sortKey = settings.view.sort as typeof sortKey;
  $: descending = settings.view.descending;
  $: visibleColumns = settings.view.columns.filter((column) => column.visible);
  $: tableWidth = visibleColumns.reduce((sum, column) => sum + column.width, 0);
  let pausingAll = false;

  $: categories = settings.categories;
  const categoryName = (item: Category) =>
    item.name ||
    (dictionary(language) as Record<string, string>)[item.id] ||
    dictionary(language).newCategory;
  const categoryIcon = (id: string) =>
    defaultCategories.some((item) => item.id === id) ? id : "folder";
  const fileCategory = (path: string) => {
    const name = basename(path).toLowerCase();
    return (
      categories
        .flatMap((item) => item.extensions.map((extension) => ({ id: item.id, extension })))
        .filter((item) => name.endsWith(`.${item.extension.toLowerCase()}`))
        .sort((a, b) => b.extension.length - a.extension.length)[0]?.id || "other"
    );
  };
  $: if (category !== "all" && !categories.some((item) => item.id === category)) category = "all";

  let search = "";

  let error = "";

  let notice = "";

  let connected = false;
  let trayAvailable = false;

  let refreshing = false;

  let ready = false;

  let announcement = "";

  let busy = false;

  let busyIds = new Set<string>();

  let addDialog: HTMLDialogElement;

  let settingsDialog: HTMLDialogElement;
  let linkDialog: HTMLDialogElement;
  let linkInput: HTMLInputElement;
  let linkTarget: Job | null = null;
  let replacementUrl = "";
  let restartRequired = false;
  let confirmRestart = false;

  let urlInput: HTMLInputElement;

  let url = "";

  let filename = "";

  let destination = "";
  let explicitDestination = false;

  let formError = "";
  let suggestion: Suggestion | null = null;
  let probeId = "";
  let browserReview: Snapshot["browser_review"] = null;

  let draft: Settings = { ...settings };

  let limitKiB = 0;

  const isDesktop = () => "__TAURI_INTERNALS__" in window;

  const basename = (value: string) => value.split(/[\\/]/).pop() || value;

  const hostname = (value: string) => {
    try {
      return new URL(value).hostname;
    } catch {
      return "";
    }
  };

  const pathLabel = (value: string) => (value.startsWith("\\\\?\\") ? value.slice(4) : value);

  const errorMessage = (value: unknown) => {
    const raw = value instanceof Error ? value.message : String(value);
    if (raw.startsWith("Invalid appearance or column")) return text.columnHint;
    if (raw.startsWith("An extension belongs")) return text.categoryDuplicate;
    if (raw.startsWith("Use literal extensions")) return text.categoryExtensionsError;
    if (raw.startsWith("Category folder") || raw.startsWith("Category or destination folder"))
      return text.categoryUnavailable;
    if (
      raw.startsWith("Invalid category") ||
      raw.startsWith("Use between 1 and 16") ||
      raw.startsWith("Keep the Other")
    )
      return text.categoryInvalid;
    if (raw.startsWith("Browser destination is occupied;")) return text.browserReviewHint;
    if (raw.startsWith("System tray")) return text.trayUnavailable;
    if (raw.startsWith("Windows notification could not")) return text.notificationFailed;
    if (raw.startsWith("Pause the download and wait")) return text.replaceWait;
    if (raw.startsWith("Repair or finish the pending file publication"))
      return text.replacePublication;
    if (raw.startsWith("Download changed while checking")) return text.replaceChanged;
    const reason = /^Storage error: (full|access|missing|other)\./.exec(raw)?.[1];
    const messages: Record<string, string> = {
      full: text.storageFull,
      access: text.storageAccess,
      missing: text.storageMissing,
      other: text.storageOther,
    };
    return reason ? messages[reason] : raw;
  };

  const bytes = (value: number) => {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];

    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index++;
    }

    return `${new Intl.NumberFormat(language, { maximumFractionDigits: index ? 1 : 0 }).format(value)} ${units[index]}`;
  };

  const percent = (job: Job) =>
    job.status === "completed"
      ? 100
      : job.total
        ? Math.min(100, (job.downloaded / job.total) * 100)
        : 0;

  const remaining = (job: Job) => {
    if (!job.total || !job.speed || job.status !== "downloading") return "";

    const seconds = Math.ceil(Math.max(0, job.total - job.downloaded) / job.speed);

    return `${new Intl.NumberFormat(language).format(seconds < 60 ? seconds : Math.ceil(seconds / 60))} ${language === "ar" ? (seconds < 60 ? "ث" : "د") : seconds < 60 ? "s" : "min"} ${text.remaining}`;
  };

  $: activeCount = jobs.filter((j) => ["downloading", "queued"].includes(j.status)).length;

  $: completedCount = jobs.filter((j) => j.status === "completed").length;

  $: totalSpeed = jobs.reduce((sum, j) => sum + (j.status === "downloading" ? j.speed : 0), 0);

  $: filtered = jobs
    .filter(
      (j) =>
        (filter === "all" ||
          (filter === "active"
            ? ["queued", "downloading"].includes(j.status)
            : j.status === filter)) &&
        (category === "all" || fileCategory(j.destination) === category) &&
        `${basename(j.destination)} ${hostname(j.url)}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    )
    .slice()
    .reverse()
    .sort((a, b) => {
      if (sortKey === "recent") return 0;
      if (sortKey === "total") {
        if (a.total === null) return b.total === null ? 0 : 1;
        if (b.total === null) return -1;
        return (a.total - b.total) * (descending ? -1 : 1);
      }
      const left = sortKey === "filename" ? basename(a.destination) : text[a.status];
      const right = sortKey === "filename" ? basename(b.destination) : text[b.status];
      return left.localeCompare(right, language, { numeric: true }) * (descending ? -1 : 1);
    });

  $: if ([...selectedIds].some((id) => !filtered.some((job) => job.id === id)))
    selectedIds = new Set([...selectedIds].filter((id) => filtered.some((job) => job.id === id)));
  $: selectedJobs = filtered.filter((job) => selectedIds.has(job.id));
  $: selected = selectedJobs.length === 1 ? selectedJobs[0] : undefined;
  $: selectedBusy = !selected || busyIds.has(selected.id) || pausingAll || bulkBusy;
  $: canPause = selected && ["queued", "downloading"].includes(selected.status);
  $: canResume = selected && ["paused", "failed"].includes(selected.status);
  $: canCancel = selected && ["queued", "downloading", "paused"].includes(selected.status);
  $: canRemove = selected && ["completed", "failed", "cancelled"].includes(selected.status);
  $: queueIndex = selected ? queue.waiting.indexOf(selected.id) : -1;

  function selectJob(job: Job, event: MouseEvent) {
    if (bulkBusy) return;
    const anchor = filtered.findIndex((item) => item.id === selectionAnchor);
    const index = filtered.indexOf(job);
    if (event.shiftKey && anchor >= 0) {
      selectedIds = new Set(
        filtered.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((item) => item.id),
      );
    } else if (event.ctrlKey || event.metaKey) {
      toggleSelection(job.id);
    } else {
      selectedIds = new Set([job.id]);
    }
    selectionAnchor = job.id;
  }

  function toggleSelection(id: string) {
    const next = new Set(selectedIds);
    if (!next.delete(id)) next.add(id);
    selectedIds = next;
    selectionAnchor = id;
  }

  const eligible = (job: Job, value: string) =>
    value === "pause"
      ? ["queued", "downloading"].includes(job.status)
      : value === "resume"
        ? ["paused", "failed"].includes(job.status)
        : value === "remove"
          ? ["completed", "failed", "cancelled"].includes(job.status)
          : ["queued", "downloading", "paused"].includes(job.status);

  function selectedAction(value: string) {
    const targets = selectedJobs.filter((job) => eligible(job, value));
    if (["cancel", "remove"].includes(value)) {
      confirmTargets = [...targets];
      confirmValue = value;
      confirmDialog.showModal();
    } else void bulkAction(value, targets);
  }

  async function bulkAction(value: string, targets: Job[]) {
    bulkBusy = true;
    bulkResults = [];
    try {
      for (const target of targets) {
        const current = jobs.find((job) => job.id === target.id);
        let result = text.actionUnavailable;
        if (current && eligible(current, value)) {
          const saved = await action(current, value);
          result = saved ? text.actionDone : error;
        }
        bulkResults = [
          ...bulkResults,
          { id: target.id, name: basename(target.destination), result },
        ];
      }
    } finally {
      bulkBusy = false;
    }
  }

  async function batchAdded() {
    filter = "all";
    category = "all";
    search = "";
    await refresh();
  }

  async function sortBy(key: "filename" | "total" | "status") {
    if (viewBusy) return;
    const next = {
      ...settings,
      view: { ...settings.view, sort: key, descending: sortKey === key ? !descending : false },
    };
    viewBusy = true;
    try {
      if (isDesktop()) {
        await invoke("save_settings", { settings: next });
        await refresh();
      } else settings = next;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      viewBusy = false;
    }
  }

  $: if (typeof document !== "undefined") {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.documentElement.dataset.theme =
      settings.view.appearance === "system"
        ? systemDark
          ? "dark"
          : "light"
        : settings.view.appearance;
  }

  async function refresh() {
    if (refreshing || !isDesktop()) return;

    refreshing = true;

    try {
      const value = await invoke<Snapshot>("snapshot");

      if (ready) {
        const changed = value.jobs.find(
          (j) => jobs.find((old) => old.id === j.id)?.status !== j.status,
        );
        if (changed)
          announcement = `${basename(changed.destination)} — ${dictionary(value.settings.language)[changed.status]}`;
      }

      jobs = value.jobs;
      queue = value.queue;
      settings = {
        ...value.settings,
        categories: value.settings.categories ?? structuredClone(defaultCategories),
        view: value.settings.view ?? structuredClone(defaultView),
      };
      language = value.settings.language;
      folder = value.folder;
      version = value.version;
      connected = !value.native_error;
      trayAvailable = value.tray_available;
      ready = true;

      if (value.notice) error = errorMessage(value.notice);
      if (value.browser_review) browserReview = value.browser_review;
    } catch {
      error = text.missing;
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const themeChanged = () => (systemDark = media.matches);
    themeChanged();
    media.addEventListener("change", themeChanged);
    if (!isDesktop()) {
      ready = true;
      notice = text.preview;
    } else void refresh();
    const timer = setInterval(() => void refresh(), 750);
    return () => {
      clearInterval(timer);
      media.removeEventListener("change", themeChanged);
    };
  });

  function showContext(job: Job, event: Event) {
    event.preventDefault();
    selectedIds = new Set([job.id]);
    contextId = job.id;
    error = "";
    if (!contextDialog.open) contextDialog.showModal();
  }

  async function contextAction(value: string) {
    if (contextJob && ["cancel", "remove"].includes(value)) {
      contextDialog.close();
      selectedAction(value);
      return;
    }
    if (contextJob && (await action(contextJob, value))) contextDialog.close();
  }

  async function contextClosed() {
    await tick();
    if (
      document.activeElement === document.body ||
      document.activeElement?.closest("dialog:not([open])")
    )
      document.querySelector<HTMLElement>(".table-scroll")?.focus();
  }

  function shortcuts(event: KeyboardEvent) {
    if (
      document.querySelector("dialog[open]") ||
      (event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable=true]"))
    )
      return;
    const control = event.ctrlKey || event.metaKey;
    if (control && event.key.toLowerCase() === "n") {
      event.preventDefault();
      void newDownload();
    }
    if (control && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchInput.focus();
    }
    if (control && event.key.toLowerCase() === "a" && !bulkBusy) {
      event.preventDefault();
      selectedIds = new Set(filtered.map((job) => job.id));
    }
    if (
      event.key === "Delete" &&
      !bulkBusy &&
      !pausingAll &&
      !busyIds.size &&
      selectedJobs.some((job) => eligible(job, "remove"))
    ) {
      event.preventDefault();
      selectedAction("remove");
    }
  }

  async function newDownload() {
    formError = "";
    url = "";
    filename = "";
    destination = folder;
    explicitDestination = false;
    suggestion = null;
    addLater = false;
    addDialog.showModal();
    await tick();
    urlInput.focus();
  }

  function cancelProbe() {
    if (probeId && isDesktop()) void invoke("cancel_probe", { id: probeId }).catch(() => {});
    probeId = "";
    busy = false;
  }

  function validUrl(value: string) {
    try {
      const parsed = new URL(value);
      return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }

  async function checkName() {
    formError = "";
    suggestion = null;
    if (!validUrl(url)) {
      formError = text.invalidUrl;
      return null;
    }
    if (!isDesktop()) {
      formError = text.preview;
      return null;
    }
    const id = crypto.randomUUID();
    probeId = id;
    busy = true;
    try {
      const result = await invoke<Suggestion>("suggest_download", {
        id,
        url,
        destination: explicitDestination ? destination : folder,
        automaticFolder: !explicitDestination,
        filename: filename.trim() || null,
      });
      if (probeId !== id) return null;
      suggestion = result;
      if (!explicitDestination && result.destination) destination = result.destination;
      if (!filename.trim()) filename = result.filename;
      return result;
    } catch (e) {
      if (probeId === id) formError = `${text.probeFailed} ${errorMessage(e)}`;
      return null;
    } finally {
      if (probeId === id) {
        probeId = "";
        busy = false;
      }
    }
  }

  async function reviewBrowser() {
    const review = browserReview;
    if (!review) return;
    await newDownload();
    url = review.url;
    destination = review.destination;
    explicitDestination = true;
    filename = review.suggestion.alternative || review.suggestion.filename;
    suggestion = { ...review.suggestion, filename, alternative: null };
    browserReview = null;
    error = "";
  }

  async function addDownload(event: SubmitEvent) {
    event.preventDefault();
    formError = "";

    if (!validUrl(url)) {
      formError = text.invalidUrl;
      return;
    }

    if (!isDesktop()) {
      formError = text.preview;
      return;
    }

    const hadName = !!filename.trim();
    const previousDestination = destination;
    const checked = await checkName();
    if (
      !checked ||
      !hadName ||
      checked.alternative ||
      pathLabel(previousDestination).toLowerCase() !== pathLabel(destination).toLowerCase()
    )
      return;
    busy = true;

    try {
      await invoke("add_download", {
        url,
        filename: filename.trim() || null,
        destination,
        later: addLater,
      });
      addDialog.close();
      filter = "all";
      category = "all";
      search = "";
      await refresh();
    } catch (e) {
      formError = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function showLinkReplacement() {
    if (!selected || !canResume) return;
    linkTarget = selected;
    replacementUrl = "";
    restartRequired = false;
    confirmRestart = false;
    formError = "";
    linkDialog.showModal();
    await tick();
    linkInput.focus();
  }

  async function queueControl(running: boolean) {
    queueBusy = true;
    error = "";
    try {
      await invoke("set_queue_running", { running });
      await refresh();
    } catch (e) {
      error = `${text.queueFailed} ${errorMessage(e)}`;
    } finally {
      queueBusy = false;
    }
  }

  async function moveWaiting(direction: "up" | "down") {
    if (!selected) return;
    queueBusy = true;
    error = "";
    try {
      await invoke("move_waiting", { id: selected.id, direction });
      await refresh();
    } catch (e) {
      error = `${text.queueFailed} ${errorMessage(e)}`;
    } finally {
      queueBusy = false;
    }
  }

  async function replaceLink(event: SubmitEvent) {
    event.preventDefault();
    if (!linkTarget || (restartRequired && !confirmRestart)) return;
    formError = "";
    if (!validUrl(replacementUrl)) {
      formError = text.invalidUrl;
      return;
    }
    const id = crypto.randomUUID();
    probeId = id;
    busy = true;
    try {
      const result = await invoke<{ status: "updated" | "restart_required" }>("replace_link", {
        probeId: id,
        id: linkTarget.id,
        url: replacementUrl,
        restart: confirmRestart,
      });
      if (probeId !== id) return;
      if (result.status === "restart_required") {
        restartRequired = true;
        confirmRestart = false;
      } else {
        linkDialog.close();
        notice = text.linkUpdated;
        await refresh();
      }
    } catch (e) {
      if (probeId === id) formError = `${text.replaceFailed} ${errorMessage(e)}`;
    } finally {
      if (probeId === id) {
        probeId = "";
        busy = false;
      }
    }
  }

  async function chooseFolder(forSettings = false) {
    if (!isDesktop()) {
      formError = text.preview;
      return;
    }

    try {
      const result = await invoke<string | null>("select_folder");
      if (result) {
        if (forSettings) draft = { ...draft, download_folder: result };
        else {
          destination = result;
          explicitDestination = true;
          suggestion = null;
        }
      }
    } catch (e) {
      formError = errorMessage(e);
    }
  }

  async function action(job: Job, value: string) {
    if (busyIds.has(job.id)) return false;
    busyIds = new Set([...busyIds, job.id]);
    error = "";

    try {
      await invoke("download_action", { id: job.id, action: value });
      await refresh();
      if (value === "remove") {
        await tick();
        document.querySelector<HTMLElement>(".table-scroll")?.focus();
      }
      return true;
    } catch (e) {
      error = errorMessage(e);
      return false;
    } finally {
      const next = new Set(busyIds);
      next.delete(job.id);
      busyIds = next;
    }
  }

  async function pauseAll() {
    if (pausingAll) return;
    pausingAll = true;
    try {
      for (const job of jobs.filter((job) => ["queued", "downloading"].includes(job.status))) {
        const current = jobs.find((item) => item.id === job.id);
        if (current && ["queued", "downloading"].includes(current.status)) {
          if (!(await action(current, "pause"))) break;
        }
      }
    } finally {
      pausingAll = false;
    }
  }

  async function openFile(job: Job, reveal = false) {
    try {
      await invoke("open_download", { id: job.id, reveal });
    } catch (e) {
      error = errorMessage(e);
    }
  }

  function showSettings() {
    draft = { ...structuredClone(settings), download_folder: folder };
    limitKiB = Math.round(settings.speed_limit / 1024);
    formError = "";
    settingsDialog.showModal();
  }

  async function chooseCategoryFolder(id: string) {
    try {
      const result = await invoke<string | null>("select_folder");
      if (result)
        draft = {
          ...draft,
          categories: draft.categories.map((item) =>
            item.id === id ? { ...item, download_folder: result } : item,
          ),
        };
    } catch (e) {
      formError = errorMessage(e);
    }
  }

  async function saveSettings(event: SubmitEvent) {
    event.preventDefault();
    if (!isDesktop()) {
      formError = text.preview;
      return;
    }
    busy = true;

    try {
      await invoke("save_settings", {
        settings: { ...draft, speed_limit: Math.round(limitKiB * 1024) },
      });
      settingsDialog.close();
      await refresh();
      notice = text.success;
    } catch (e) {
      formError = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function switchLanguage() {
    language = language === "en" ? "ar" : "en";

    if (isDesktop()) {
      try {
        await invoke("save_settings", { settings: { ...settings, language } });
        await refresh();
      } catch (e) {
        error = errorMessage(e);
      }
    }
  }

  async function connectBrowser() {
    try {
      await invoke("connect_browser");
      connected = true;
      notice = text.connected;
    } catch (e) {
      formError = errorMessage(e);
    }
  }
</script>

<svelte:window onkeydown={shortcuts} />

<a class="skip-link" href="#downloads">{text.downloads}</a>

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

<div class="shell">
  <header class="app-header">
    <a class="brand" href="#downloads" aria-label="ZipZap">
      <span class="brand-mark"
        ><svg width="30" height="30" viewBox="0 0 256 256" aria-hidden="true"
          ><path d="M65 65h130l-93 101h89v28H58v-25l91-77H65z" fill="currentColor" /><path
            d="m175 112 29 0 0 43 14-14 17 18-44 43-42-43 17-18 9 10z"
            fill="#b7f7d2"
          /></svg
        ></span
      >
      <span>ZipZap</span>
    </a>
    <h1>{text.downloads}</h1>
    <span class="app-version" dir="ltr">{version}</span>
    <button class="language" onclick={switchLanguage}
      ><Icon name="globe" />{language === "en" ? "العربية" : "English"}</button
    >
  </header>

  <section class="command-section" aria-label={text.actions}>
    <div class="command-bar" role="group" aria-label={text.actions}>
      <button class="tool add-tool" onclick={newDownload} aria-haspopup="dialog"
        ><Icon name="plus" /><span>{text.add}</span></button
      >
      <button class="tool" onclick={() => batchDialog.open()} aria-haspopup="dialog"
        ><Icon name="plus" /><span>{text.batchAdd}</span></button
      >
      <span class="tool-divider" aria-hidden="true"></span>
      <button
        class="tool green"
        disabled={selectedBusy || !canResume}
        onclick={() => selected && action(selected, "resume")}
        ><Icon name="play" /><span>{selected?.status === "failed" ? text.retry : text.resume}</span
        ></button
      >
      <button
        class="tool orange"
        disabled={selectedBusy || !canPause}
        onclick={() => selected && action(selected, "pause")}
        ><Icon name="pause" /><span>{text.pause}</span></button
      >
      <button
        class="tool blue"
        disabled={selectedBusy || !canResume}
        onclick={showLinkReplacement}
        aria-haspopup="dialog"><Icon name="globe" /><span>{text.replaceLink}</span></button
      >
      <button
        class="tool orange"
        disabled={!activeCount || pausingAll || bulkBusy || busyIds.size > 0}
        onclick={pauseAll}><Icon name="pauseAll" /><span>{text.pauseAll}</span></button
      >
      <button
        class="tool red"
        disabled={selectedBusy || !canCancel}
        onclick={() => selected && action(selected, "cancel")}
        ><Icon name="close" /><span>{text.cancel}</span></button
      >
      <span class="tool-divider" aria-hidden="true"></span>
      <button
        class="tool red"
        disabled={selectedBusy || !canRemove}
        onclick={() => selected && action(selected, "remove")}
        title={text.removeHint}><Icon name="trash" /><span>{text.remove}</span></button
      >
      <button
        class="tool blue"
        disabled={selectedBusy || selected?.status !== "completed"}
        onclick={() => selected && openFile(selected)}
        ><Icon name="external" /><span>{text.open}</span></button
      >
      <button
        class="tool blue"
        disabled={selectedBusy || selected?.status !== "completed"}
        onclick={() => selected && openFile(selected, true)}
        ><Icon name="folder" /><span>{text.reveal}</span></button
      >
      <span class="tool-divider" aria-hidden="true"></span>
      <button class="tool violet" onclick={showSettings} aria-haspopup="dialog"
        ><Icon name="settings" /><span>{text.settings}</span></button
      >
    </div>
  </section>
  <div class="workspace">
    <aside class="sidebar" aria-label={text.categories}>
      <h2>{text.categories}</h2>
      <nav aria-label={text.filter}>
        <button
          class:chosen={filter === "all" && category === "all"}
          aria-current={filter === "all" && category === "all" ? "page" : undefined}
          onclick={() => {
            filter = "all";
            category = "all";
          }}
          ><Icon name="folder" /><span>{text.all}</span><span class="nav-count">{jobs.length}</span
          ></button
        >
        <div class="category-children">
          {#each categories as item (item.id)}
            <button
              class:chosen={category === item.id}
              aria-current={category === item.id ? "page" : undefined}
              onclick={() => {
                filter = "all";
                category = item.id;
              }}><Icon name={categoryIcon(item.id)} /><span>{categoryName(item)}</span></button
            >
          {/each}
        </div>
        <div class="nav-divider"></div>
        {#each [{ id: "active", label: text.active, icon: "download", count: activeCount }, { id: "paused", label: text.paused, icon: "pause", count: jobs.filter((j) => j.status === "paused").length }, { id: "completed", label: text.completed, icon: "check", count: completedCount }, { id: "failed", label: text.failed, icon: "alert", count: jobs.filter((j) => j.status === "failed").length }, { id: "cancelled", label: text.cancelled, icon: "close", count: jobs.filter((j) => j.status === "cancelled").length }] as item}
          <button
            class:chosen={filter === item.id}
            aria-current={filter === item.id ? "page" : undefined}
            onclick={() => {
              filter = item.id;
              category = "all";
            }}
            ><Icon name={item.icon} /><span>{item.label}</span><span class="nav-count"
              >{item.count}</span
            ></button
          >
        {/each}
      </nav>
      <div class="sidebar-note"><Icon name="shield" /><span>{text.local}</span></div>
    </aside>

    <main id="downloads" tabindex="-1">
      <section class="queue-controls" aria-label={text.queueTitle}>
        <span role="status">{queue.running ? text.queueRunning : text.queueHeld}</span>
        <button
          class="secondary"
          disabled={queueBusy || !isDesktop()}
          onclick={() => queueControl(!queue.running)}
          >{queue.running ? text.holdQueue : text.startQueue}</button
        >
        <span class="helper">{text.queueHoldHint}</span>
      </section>
      {#if error}<div class="message error" role="alert">
          <Icon name="alert" /><span>{error}</span><button
            class="icon-button"
            onclick={() => (error = "")}
            aria-label={text.clearError}><Icon name="close" /></button
          >
        </div>{/if}
      {#if notice}<div class="message notice" role="status">
          <Icon name="check" /><span>{notice}</span><button
            class="icon-button"
            onclick={() => (notice = "")}
            aria-label={text.clearError}><Icon name="close" /></button
          >
        </div>{/if}
      {#if browserReview}<div class="message notice" role="status">
          <span>{text.browserReviewHint}</span><button class="secondary" onclick={reviewBrowser}
            >{text.reviewName}</button
          >
          <button class="icon-button" onclick={() => (browserReview = null)} aria-label={text.close}
            ><Icon name="close" /></button
          >
        </div>{/if}

      <section class="download-panel" aria-label={text.downloads}>
        <div class="panel-toolbar">
          <h2>
            {category !== "all"
              ? categoryName(categories.find((item) => item.id === category)!)
              : filter === "all"
                ? text.all
                : filter === "active"
                  ? text.active
                  : text[filter as Status]}<span class="count-pill">{filtered.length}</span>
          </h2>
          <label class="search"
            ><Icon name="search" /><input
              aria-label={text.search}
              type="search"
              bind:this={searchInput}
              placeholder={text.searchHint}
              bind:value={search}
            /></label
          >
        </div>

        <div class="selection-controls">
          <label
            ><input
              type="checkbox"
              aria-label={text.selectVisible}
              checked={filtered.length > 0 && selectedJobs.length === filtered.length}
              indeterminate={selectedJobs.length > 0 && selectedJobs.length < filtered.length}
              disabled={!filtered.length || bulkBusy || pausingAll || busyIds.size > 0}
              onchange={(event) =>
                (selectedIds = new Set(
                  event.currentTarget.checked ? filtered.map((job) => job.id) : [],
                ))}
            />{text.selectedCount}: {selectedJobs.length}</label
          >
          {#if selectedJobs.length > 1}
            {#each [{ value: "pause", label: text.pauseSelected }, { value: "resume", label: text.resumeSelected }, { value: "cancel", label: text.cancelSelected }, { value: "remove", label: text.removeSelected }] as item}
              <button
                class="secondary"
                disabled={bulkBusy ||
                  pausingAll ||
                  busyIds.size > 0 ||
                  !selectedJobs.some((job) => eligible(job, item.value))}
                onclick={() => selectedAction(item.value)}>{item.label}</button
              >
            {/each}
          {/if}
        </div>
        <p class="selection-help helper">{text.selectionHelp}</p>
        <p class="selection-help helper">{text.shortcutHint}</p>
        {#if bulkResults.length}<ul class="bulk-results" aria-live="polite">
            {#each bulkResults as result (result.id)}<li>
                <bdi>{result.name}</bdi>: {result.result}
              </li>{/each}
          </ul>{/if}

        <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll the table horizontally.) -->
        <div class="table-scroll" tabindex="0" role="region" aria-label={text.downloadTable}>
          <table style:width={`${tableWidth}px`} style:min-width={`${tableWidth}px`}>
            <caption class="sr-only">{text.tableHelp}</caption>
            <thead
              ><tr>
                {#each visibleColumns as column (column.id)}
                  <th
                    scope="col"
                    style:width={`${column.width}px`}
                    aria-sort={!["filename", "total", "status"].includes(column.id)
                      ? undefined
                      : sortKey === column.id
                        ? descending
                          ? "descending"
                          : "ascending"
                        : "none"}
                    >{#if ["filename", "total", "status"].includes(column.id)}<button
                        disabled={viewBusy}
                        onclick={() => sortBy(column.id as "filename" | "total" | "status")}
                        >{text[column.id as "filename" | "total" | "status"]}<span
                          aria-hidden="true"
                          >{sortKey === column.id ? (descending ? "▾" : "▴") : "↕"}</span
                        ></button
                      >{:else}{text[column.id as "timeLeft" | "transferRate" | "website"]}{/if}</th
                  >
                {/each}
              </tr></thead
            >
            <tbody>
              {#each filtered as job (job.id)}
                <tr class:selected={selectedIds.has(job.id)} class:failed={job.status === "failed"}>
                  <td class="filename-cell"
                    ><div class="file-choice">
                      <input
                        type="checkbox"
                        aria-label={`${text.selectFile} ${basename(job.destination)}`}
                        checked={selectedIds.has(job.id)}
                        disabled={bulkBusy || pausingAll || busyIds.has(job.id)}
                        onchange={() => toggleSelection(job.id)}
                      />
                      <button
                        class="file-select"
                        aria-pressed={selectedIds.has(job.id)}
                        disabled={bulkBusy}
                        onclick={(event) => selectJob(job, event)}
                        oncontextmenu={(event) => showContext(job, event)}
                        onkeydown={(event) => {
                          if (
                            event.key === "ContextMenu" ||
                            (event.key === "F10" && event.shiftKey)
                          )
                            showContext(job, event);
                        }}
                        title={basename(job.destination)}
                        ><Icon name={categoryIcon(fileCategory(job.destination))} /><bdi
                          >{basename(job.destination)}</bdi
                        ></button
                      >
                    </div>
                    {#if job.error}<p class="job-error">
                        {failureMessages[job.failure_reason || ""] || errorMessage(job.error)}
                      </p>{/if}</td
                  >
                  {#if visibleColumns.some((column) => column.id === "total")}<td
                      ><bdi dir="ltr">{job.total !== null ? bytes(job.total) : text.unknown}</bdi
                      ></td
                    >{/if}
                  {#if visibleColumns.some((column) => column.id === "status")}<td
                      class="status-cell"
                      ><span
                        class="job-status"
                        class:running={job.status === "downloading"}
                        class:finished={job.status === "completed"}
                        >{text[job.status]}{job.total && job.status === "downloading"
                          ? ` (${Math.floor(percent(job))}%)`
                          : ""}</span
                      ><progress
                        max="100"
                        value={job.total || job.status === "completed" ? percent(job) : undefined}
                        aria-label={`${basename(job.destination)} ${text[job.status]}`}
                      ></progress></td
                    >{/if}
                  {#if visibleColumns.some((column) => column.id === "timeLeft")}<td
                      >{remaining(job) || "—"}</td
                    >{/if}
                  {#if visibleColumns.some((column) => column.id === "transferRate")}<td
                      ><bdi dir="ltr"
                        >{job.status === "downloading" ? `${bytes(job.speed)}/s` : "—"}</bdi
                      ></td
                    >{/if}
                  {#if visibleColumns.some((column) => column.id === "website")}<td
                      class="origin-cell"
                      ><bdi dir="ltr" title={hostname(job.url)}>{hostname(job.url)}</bdi></td
                    >{/if}
                </tr>
              {/each}
            </tbody>
          </table>
          {#if !ready}<div class="empty">
              <Icon name="clock" />
              <h3>{text.loading}</h3>
            </div>
          {:else if filtered.length === 0}<div class="empty">
              <Icon name="download" />
              <h3>
                {search || filter !== "all" || category !== "all" ? text.noResults : text.empty}
              </h3>
              <p>{text.emptyText}</p>
              <button class="secondary" onclick={newDownload}
                ><Icon name="plus" />{text.emptyAction}</button
              >
            </div>{/if}
        </div>
      </section>

      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll the download details.) -->
      <section class="selection-details" aria-label={text.details} tabindex="0">
        {#if selected}
          {#if queueIndex >= 0}<div class="queue-position">
              <strong>{text.queuePosition}</strong><span
                >{new Intl.NumberFormat(language).format(queueIndex + 1)} / {new Intl.NumberFormat(
                  language,
                ).format(queue.waiting.length)}</span
              >
              <button
                class="secondary"
                disabled={queueBusy || selectedBusy || queueIndex === 0}
                onclick={() => moveWaiting("up")}>{text.moveUp}</button
              >
              <button
                class="secondary"
                disabled={queueBusy || selectedBusy || queueIndex === queue.waiting.length - 1}
                onclick={() => moveWaiting("down")}>{text.moveDown}</button
              >
            </div>{/if}
          <div>
            <strong>{text.destination}</strong><bdi dir="ltr">{pathLabel(selected.destination)}</bdi
            >
          </div>
          <div>
            <strong>{text.saved}</strong><bdi dir="ltr"
              >{bytes(selected.downloaded)}{selected.total !== null
                ? ` / ${bytes(selected.total)}`
                : ""}</bdi
            ><span>{text[selected.status]}</span>
          </div>
          <div>
            <strong>{text.storageEstimate}</strong><bdi dir="ltr"
              >{selected.total === null ? text.unknown : bytes(selected.total * 2)}</bdi
            >
          </div>
          <p class="helper">{text.storage} {text.storageCaution}</p>
          {#if selected.attempt}<div>
              <strong>{text.attempt}</strong><bdi dir="ltr"
                >{new Intl.NumberFormat(language).format(selected.attempt)} / {new Intl.NumberFormat(
                  language,
                ).format(3)}</bdi
              >
            </div>{/if}
          {#if selected.next_retry}<div role="status">
              <strong>{text.nextRetry}</strong><bdi dir="ltr"
                >{new Date(selected.next_retry).toLocaleTimeString(language)}</bdi
              >
            </div>{/if}
          {#if selected.error}<p class="job-error" role="status">
              {failureMessages[selected.failure_reason || ""] || errorMessage(selected.error)}
            </p>{/if}
        {:else}<p>{text.selectHint}</p>{/if}
      </section>
    </main>
  </div>

  <footer class="statusbar">
    <span><span class="status-dot"></span>{ready ? text.ready : text.loading}</span><span
      >{text.active}: {activeCount}</span
    ><span>{text.speed}: <bdi dir="ltr">{bytes(totalSpeed)}/s</bdi></span><span class="footer-note"
      >{settings.close_to_tray && trayAvailable ? text.footerTray : text.footer}</span
    >
  </footer>
</div>

<BatchDialog
  bind:this={batchDialog}
  {language}
  {folder}
  desktop={isDesktop()}
  message={errorMessage}
  onadded={batchAdded}
/>

<dialog bind:this={confirmDialog} aria-labelledby="bulk-title">
  <form
    onsubmit={(event) => {
      event.preventDefault();
      confirmDialog.close();
      void bulkAction(confirmValue, confirmTargets);
    }}
  >
    <h2 id="bulk-title">{text.bulkConfirm} ({confirmTargets.length})</h2>
    <p>{confirmValue === "cancel" ? text.bulkCancelHint : text.bulkRemoveHint}</p>
    <ul>
      {#each confirmTargets as job (job.id)}<li><bdi>{basename(job.destination)}</bdi></li>{/each}
    </ul>
    <div class="dialog-actions">
      <button type="button" class="secondary" onclick={() => confirmDialog.close()}
        >{text.close}</button
      >
      <button type="submit" class="primary">{text.confirmAction}</button>
    </div>
  </form>
</dialog>

<dialog bind:this={contextDialog} aria-labelledby="context-title" onclose={contextClosed}>
  <form onsubmit={(event) => event.preventDefault()}>
    <h2 id="context-title">{text.contextActions}</h2>
    {#if contextJob}<p><bdi>{basename(contextJob.destination)}</bdi></p>
      <div class="context-actions">
        {#each [{ value: "resume", label: contextJob.status === "failed" ? text.retry : text.resume }, { value: "pause", label: text.pause }, { value: "cancel", label: text.cancel }, { value: "remove", label: text.remove }] as item}
          <button
            type="button"
            class="secondary"
            disabled={!eligible(contextJob, item.value) || busyIds.has(contextJob.id)}
            onclick={() => contextAction(item.value)}>{item.label}</button
          >
        {/each}
        <button
          type="button"
          class="secondary"
          disabled={contextJob.status !== "completed"}
          onclick={() => contextJob && openFile(contextJob)}>{text.open}</button
        >
        <button
          type="button"
          class="secondary"
          disabled={contextJob.status !== "completed"}
          onclick={() => contextJob && openFile(contextJob, true)}>{text.reveal}</button
        >
        <button
          type="button"
          class="secondary"
          disabled={!eligible(contextJob, "resume") || busyIds.has(contextJob.id)}
          onclick={() => {
            contextDialog.close();
            void showLinkReplacement();
          }}>{text.replaceLink}</button
        >
      </div>
    {:else}<p>{text.actionUnavailable}</p>{/if}
    <p class="helper">{text.removeHint}</p>
    {#if error}<p role="alert" class="form-error">{error}</p>{/if}
    <div class="dialog-actions">
      <button type="button" class="secondary" onclick={() => contextDialog.close()}
        >{text.close}</button
      >
    </div>
  </form>
</dialog>

<dialog bind:this={addDialog} aria-labelledby="add-title" onclose={cancelProbe}>
  <form onsubmit={addDownload}>
    <div class="dialog-title">
      <div>
        <span class="eyebrow">ZipZap</span>
        <h2 id="add-title">{text.add}</h2>
      </div>
      <button
        type="button"
        class="icon-button"
        onclick={() => addDialog.close()}
        aria-label={text.close}><Icon name="close" /></button
      >
    </div>
    <label for="url">{text.url}</label><input
      id="url"
      autocomplete="off"
      bind:this={urlInput}
      bind:value={url}
      type="url"
      dir="ltr"
      placeholder={text.urlHint}
      required
      disabled={busy}
      maxlength="16384"
      aria-describedby="download-help"
    />
    <p id="download-help" class="helper">{text.networkHint}</p>
    <label for="filename">{text.filename}</label><input
      id="filename"
      bind:value={filename}
      placeholder={text.optional}
      maxlength="180"
      disabled={busy}
      oninput={() => (suggestion = null)}
    /><label for="destination">{text.destination}</label>
    <div class="folder-picker">
      <input
        id="destination"
        value={pathLabel(destination)}
        readonly
        dir="ltr"
        aria-describedby="storage-help"
      /><button
        type="button"
        class="secondary"
        disabled={busy}
        onclick={() => chooseFolder()}
        aria-label={text.browse}><Icon name="folder" /></button
      >
    </div>
    <p id="storage-help" class="helper">{text.storageUnknown} {text.storage}</p>
    <label class="helper"
      ><input
        type="checkbox"
        checked={!explicitDestination}
        disabled={busy}
        onchange={(event) => {
          explicitDestination = !event.currentTarget.checked;
          suggestion = null;
          if (!explicitDestination) destination = folder;
        }}
      />{text.automaticFolder}</label
    >
    <label class="helper"
      ><input type="checkbox" bind:checked={addLater} disabled={busy} />{text.addLater}</label
    >
    <div class="name-preview">
      <button type="button" class="secondary" disabled={busy || !url} onclick={() => checkName()}
        >{busy ? text.checkingName : text.checkName}</button
      >
      {#if suggestion}<p class="helper" role="status">
          {text.reviewNameHint}
          {#if suggestion.category}<span
              >{text.suggestedCategory}: {categoryName(
                categories.find((item) => item.id === suggestion!.category) ||
                  categories[categories.length - 1],
              )}</span
            >{/if}
          {#if suggestion.total !== null}<bdi dir="ltr">{bytes(suggestion.total)}</bdi>{/if}
        </p>{/if}
      {#if suggestion?.alternative}<p class="helper" role="status">
          {text.duplicateName} <bdi>{suggestion.alternative}</bdi>
        </p>
        <button
          type="button"
          class="secondary"
          onclick={() => {
            filename = suggestion!.alternative!;
            suggestion = null;
          }}>{text.useAlternative}</button
        >{/if}
    </div>
    {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
    <div class="dialog-actions">
      <button type="button" class="secondary" onclick={() => addDialog.close()}>{text.close}</button
      ><button type="submit" class="primary" disabled={busy}
        ><Icon name={addLater ? "clock" : "download"} />{addLater
          ? text.addLaterButton
          : text.start}</button
      >
    </div>
  </form>
</dialog>

<dialog bind:this={linkDialog} aria-labelledby="replace-title" onclose={cancelProbe}>
  <form onsubmit={replaceLink}>
    <div class="dialog-title">
      <h2 id="replace-title">{text.replaceLink}</h2>
      <button
        type="button"
        class="icon-button"
        onclick={() => linkDialog.close()}
        aria-label={text.close}><Icon name="close" /></button
      >
    </div>
    <p><bdi>{linkTarget ? basename(linkTarget.destination) : ""}</bdi></p>
    <p id="replace-help" class="helper">{text.replaceHelp}</p>
    <label for="replacement-url">{text.newLink}</label><input
      id="replacement-url"
      type="url"
      bind:this={linkInput}
      bind:value={replacementUrl}
      dir="ltr"
      autocomplete="off"
      required
      maxlength="16384"
      disabled={busy}
      aria-describedby="replace-help"
      oninput={() => {
        restartRequired = false;
        confirmRestart = false;
      }}
    />
    {#if restartRequired}<p role="alert">{text.restartRequired}</p>
      <label class="helper"
        ><input
          type="checkbox"
          bind:checked={confirmRestart}
          disabled={busy}
        />{text.confirmRestart}</label
      >{/if}
    {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
    <div class="dialog-actions">
      <button type="button" class="secondary" onclick={() => linkDialog.close()}
        >{text.close}</button
      ><button type="submit" class="primary" disabled={busy || (restartRequired && !confirmRestart)}
        >{busy
          ? text.checkingName
          : restartRequired
            ? text.restartAndReplace
            : text.checkAndReplace}</button
      >
    </div>
  </form>
</dialog>

<dialog bind:this={settingsDialog} aria-labelledby="settings-title">
  <form onsubmit={saveSettings}>
    <div class="dialog-title">
      <h2 id="settings-title">{text.settings}</h2>
      <button
        type="button"
        class="icon-button"
        onclick={() => settingsDialog.close()}
        aria-label={text.close}><Icon name="close" /></button
      >
    </div>
    <div class="settings-grid">
      <div>
        <label for="concurrent">{text.concurrent}</label><select
          id="concurrent"
          bind:value={draft.max_concurrent}
          >{#each [1, 2, 3, 4] as number}<option value={number}>{number}</option>{/each}</select
        >
      </div>
      <div>
        <label for="connections">{text.connections}</label><select
          id="connections"
          bind:value={draft.connections}
          >{#each [1, 2, 3, 4] as number}<option value={number}>{number}</option>{/each}</select
        >
      </div>
    </div>
    <label for="limit">{text.limit}</label><input
      id="limit"
      type="number"
      min="0"
      max="9765625"
      step="1"
      bind:value={limitKiB}
      required
    />
    <p class="helper">{text.unlimited}</p>
    <label for="appearance">{text.appearance}</label>
    <select id="appearance" bind:value={draft.view.appearance}
      ><option value="dark">{text.dark}</option><option value="light">{text.light}</option><option
        value="system">{text.system}</option
      ></select
    >
    <fieldset class="column-preferences">
      <legend>{text.columns}</legend>
      <p class="helper">{text.columnHint}</p>
      {#each draft.view.columns as column (column.id)}
        <label
          ><input
            type="checkbox"
            bind:checked={column.visible}
            disabled={column.id === "filename"}
          />{text.showColumn}
          {text[
            column.id as "filename" | "total" | "status" | "timeLeft" | "transferRate" | "website"
          ]}</label
        >
        <label for={`width-${column.id}`}
          >{text.columnWidth}
          {text[
            column.id as "filename" | "total" | "status" | "timeLeft" | "transferRate" | "website"
          ]}: {column.width}px</label
        >
        <input
          id={`width-${column.id}`}
          type="range"
          min={column.id === "filename" ? 180 : 80}
          max="800"
          step="10"
          bind:value={column.width}
        />
      {/each}
      <button
        type="button"
        class="secondary"
        onclick={() =>
          (draft = {
            ...draft,
            view: {
              ...draft.view,
              columns: structuredClone(defaultView.columns),
              sort: "recent",
              descending: false,
            },
          })}>{text.resetColumns}</button
      >
    </fieldset>
    <label
      ><input
        type="checkbox"
        bind:checked={draft.close_to_tray}
        disabled={!trayAvailable && !draft.close_to_tray}
      />{text.closeToTray}</label
    >
    <p class="helper">{trayAvailable ? text.trayHint : text.trayUnavailable}</p>
    <label><input type="checkbox" bind:checked={draft.notifications} />{text.notifications}</label>
    <p class="helper">{text.notificationHint}</p>
    <label for="language">{text.language}</label><select id="language" bind:value={draft.language}
      ><option value="en">English</option><option value="ar">العربية</option></select
    ><label for="default-folder">{text.defaultFolder}</label>
    <div class="folder-picker">
      <input
        id="default-folder"
        value={pathLabel(draft.download_folder || folder)}
        readonly
        dir="ltr"
      /><button
        type="button"
        class="secondary"
        onclick={() => chooseFolder(true)}
        aria-label={text.browse}><Icon name="folder" /></button
      >
    </div>
    <p class="helper">{text.folderHint}</p>
    <p class="helper">{text.storage}</p>
    <section class="category-rules" aria-label={text.categoryRules}>
      <h3>{text.categoryRules}</h3>
      <p class="helper">{text.categoryHint}</p>
      {#each draft.categories as item (item.id)}
        <fieldset>
          <legend>{categoryName(item)}</legend>
          <label for={`category-name-${item.id}`}>{text.categoryName}</label>
          <input
            id={`category-name-${item.id}`}
            value={item.name || categoryName(item)}
            maxlength="80"
            disabled={busy}
            oninput={(event) => {
              item.name = event.currentTarget.value;
              draft = { ...draft };
            }}
          />
          {#if item.id !== "other"}
            <label for={`category-ext-${item.id}`}>{text.categoryExtensions}</label>
            <input
              id={`category-ext-${item.id}`}
              value={item.extensions.join(", ")}
              dir="ltr"
              maxlength="2100"
              required
              disabled={busy}
              onchange={(event) => {
                item.extensions = event.currentTarget.value
                  .split(/[,،]/)
                  .map((value) => value.trim())
                  .filter(Boolean);
                draft = { ...draft };
              }}
            />
          {/if}
          <label for={`category-folder-${item.id}`}>{text.destination}</label>
          <input
            id={`category-folder-${item.id}`}
            value={item.download_folder ? pathLabel(item.download_folder) : text.categoryFolderHint}
            readonly
            dir={item.download_folder ? "ltr" : undefined}
          />
          <div class="category-actions">
            <button
              type="button"
              class="secondary"
              disabled={busy || !isDesktop()}
              onclick={() => chooseCategoryFolder(item.id)}
              aria-label={`${text.categoryFolder} ${categoryName(item)}`}
              >{text.categoryFolder}</button
            >
            <button
              type="button"
              class="secondary"
              disabled={busy || !item.download_folder}
              onclick={() => {
                item.download_folder = null;
                draft = { ...draft };
              }}
              aria-label={`${text.clearCategoryFolder} ${categoryName(item)}`}
              >{text.clearCategoryFolder} {categoryName(item)}</button
            >
            {#if item.id !== "other"}<button
                type="button"
                class="secondary"
                disabled={busy}
                onclick={() =>
                  (draft = {
                    ...draft,
                    categories: draft.categories.filter((rule) => rule.id !== item.id),
                  })}
                aria-label={`${text.removeCategory} ${categoryName(item)}`}
                >{text.removeCategory}</button
              >{/if}
          </div>
        </fieldset>
      {/each}
      <div class="category-actions">
        <button
          type="button"
          class="secondary"
          disabled={busy || draft.categories.length >= 16}
          onclick={() =>
            (draft = {
              ...draft,
              categories: [
                ...draft.categories,
                { id: crypto.randomUUID(), name: "", extensions: [], download_folder: null },
              ],
            })}>{text.addCategory}</button
        >
        <button
          type="button"
          class="secondary"
          disabled={busy}
          onclick={() => (draft = { ...draft, categories: structuredClone(defaultCategories) })}
          >{text.restoreCategories}</button
        >
      </div>
    </section>
    <div class="browser-setting">
      <h3>{text.browser}</h3>
      <p class="helper">{connected ? text.connected : text.nativeError}</p>
      <button type="button" class="secondary" onclick={connectBrowser}>{text.connect}</button>
      <p class="helper">{text.browserHelp}</p>
    </div>
    {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
    <div class="dialog-actions">
      <button
        type="button"
        class="secondary"
        onclick={() => invoke("quit_app").catch((e) => (formError = errorMessage(e)))}
        >{text.quitApp}</button
      >
      <button type="button" class="secondary" onclick={() => settingsDialog.close()}
        >{text.close}</button
      ><button type="submit" class="primary" disabled={busy}>{text.save}</button>
    </div>
  </form>
</dialog>
