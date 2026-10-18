<script lang="ts">
  import { onMount, tick } from "svelte";

  import { invoke } from "@tauri-apps/api/core";

  import Icon from "./Icon.svelte";

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

  type Settings = {
    max_concurrent: number;
    connections: number;
    speed_limit: number;
    language: Language;
    download_folder: string | null;
  };

  type Snapshot = {
    jobs: Job[];
    settings: Settings;
    folder: string;
    version: string;
    native_error: string | null;
    notice: string | null;
  };

  let jobs: Job[] = [];

  let settings: Settings = {
    max_concurrent: 2,
    connections: 2,
    speed_limit: 0,
    language: "en",
    download_folder: null,
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
  let selectedId: string | null = null;
  let sortKey: "recent" | "filename" | "total" | "status" = "recent";
  let descending = false;
  let pausingAll = false;

  const categories = ["compressed", "documents", "music", "programs", "video", "other"] as const;
  const fileCategory = (path: string) => {
    const extension =
      basename(path)
        .match(/\.([^.]+)$/)?.[1]
        .toLowerCase() || "";
    if (/^(zip|rar|7z|gz|bz2|xz|tar|tgz|zst)$/.test(extension)) return "compressed";
    if (/^(pdf|docx?|xlsx?|pptx?|txt|csv|epub|odt|rtf)$/.test(extension)) return "documents";
    if (/^(mp3|m4a|wav|flac|ogg|aac|opus)$/.test(extension)) return "music";
    if (/^(exe|msi|msix|appx|apk)$/.test(extension)) return "programs";
    if (/^(mp4|mkv|webm|avi|mov|m4v)$/.test(extension)) return "video";
    return "other";
  };

  let search = "";

  let error = "";

  let notice = "";

  let connected = false;

  let refreshing = false;

  let ready = false;

  let announcement = "";

  let busy = false;

  let busyIds = new Set<string>();

  let addDialog: HTMLDialogElement;

  let settingsDialog: HTMLDialogElement;

  let urlInput: HTMLInputElement;

  let url = "";

  let filename = "";

  let destination = "";

  let formError = "";

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

  $: if (selectedId && !filtered.some((job) => job.id === selectedId)) selectedId = null;
  $: selected = filtered.find((job) => job.id === selectedId);
  $: selectedBusy = !selected || busyIds.has(selected.id) || pausingAll;
  $: canPause = selected && ["queued", "downloading"].includes(selected.status);
  $: canResume = selected && ["paused", "failed"].includes(selected.status);
  $: canCancel = selected && ["queued", "downloading", "paused"].includes(selected.status);
  $: canRemove = selected && ["completed", "failed", "cancelled"].includes(selected.status);

  function sortBy(key: "filename" | "total" | "status") {
    descending = sortKey === key ? !descending : false;
    sortKey = key;
  }

  $: if (typeof document !== "undefined") {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
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
      settings = value.settings;
      language = value.settings.language;
      folder = value.folder;
      version = value.version;
      connected = !value.native_error;
      ready = true;

      if (value.notice) error = errorMessage(value.notice);
    } catch {
      error = text.missing;
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    if (!isDesktop()) {
      ready = true;
      notice = text.preview;
    } else void refresh();
    const timer = setInterval(() => void refresh(), 750);
    return () => clearInterval(timer);
  });

  async function newDownload() {
    formError = "";
    url = "";
    filename = "";
    destination = folder;
    addDialog.showModal();
    await tick();
    urlInput.focus();
  }

  async function addDownload(event: SubmitEvent) {
    event.preventDefault();
    formError = "";

    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
        throw new Error(text.invalidUrl);
    } catch {
      formError = text.invalidUrl;
      return;
    }

    if (!isDesktop()) {
      formError = text.preview;
      return;
    }

    busy = true;

    try {
      await invoke("add_download", { url, filename: filename.trim() || null, destination });
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

  async function chooseFolder(forSettings = false) {
    if (!isDesktop()) {
      formError = text.preview;
      return;
    }

    try {
      const result = await invoke<string | null>("select_folder");
      if (result) {
        if (forSettings) draft = { ...draft, download_folder: result };
        else destination = result;
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
    draft = { ...settings, download_folder: folder };
    limitKiB = Math.round(settings.speed_limit / 1024);
    formError = "";
    settingsDialog.showModal();
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
        class="tool orange"
        disabled={!activeCount || pausingAll || busyIds.size > 0}
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
          {#each categories as item}
            <button
              class:chosen={category === item}
              aria-current={category === item ? "page" : undefined}
              onclick={() => {
                filter = "all";
                category = item;
              }}><Icon name={item} /><span>{text[item]}</span></button
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

      <section class="download-panel" aria-label={text.downloads}>
        <div class="panel-toolbar">
          <h2>
            {category !== "all"
              ? text[category as (typeof categories)[number]]
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
              placeholder={text.searchHint}
              bind:value={search}
            /></label
          >
        </div>

        <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll the table horizontally.) -->
        <div class="table-scroll" tabindex="0" role="region" aria-label={text.downloadTable}>
          <table>
            <caption class="sr-only">{text.tableHelp}</caption>
            <thead
              ><tr>
                {#each [{ key: "filename", label: text.filename }, { key: "total", label: text.total }, { key: "status", label: text.status }] as column}
                  <th
                    scope="col"
                    aria-sort={sortKey === column.key
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"}
                    ><button onclick={() => sortBy(column.key as "filename" | "total" | "status")}
                      >{column.label}<span aria-hidden="true"
                        >{sortKey === column.key ? (descending ? "▾" : "▴") : "↕"}</span
                      ></button
                    ></th
                  >
                {/each}
                <th scope="col">{text.timeLeft}</th><th scope="col">{text.transferRate}</th><th
                  scope="col">{text.website}</th
                >
              </tr></thead
            >
            <tbody>
              {#each filtered as job (job.id)}
                <tr class:selected={selectedId === job.id} class:failed={job.status === "failed"}>
                  <td class="filename-cell"
                    ><button
                      class="file-select"
                      aria-pressed={selectedId === job.id}
                      onclick={() => (selectedId = job.id)}
                      title={basename(job.destination)}
                      ><Icon name={fileCategory(job.destination)} /><bdi
                        >{basename(job.destination)}</bdi
                      ></button
                    >{#if job.error}<p class="job-error">
                        {failureMessages[job.failure_reason || ""] || errorMessage(job.error)}
                      </p>{/if}</td
                  >
                  <td
                    ><bdi dir="ltr">{job.total !== null ? bytes(job.total) : text.unknown}</bdi></td
                  >
                  <td class="status-cell"
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
                  >
                  <td>{remaining(job) || "—"}</td>
                  <td
                    ><bdi dir="ltr"
                      >{job.status === "downloading" ? `${bytes(job.speed)}/s` : "—"}</bdi
                    ></td
                  >
                  <td class="origin-cell"
                    ><bdi dir="ltr" title={hostname(job.url)}>{hostname(job.url)}</bdi></td
                  >
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
      >{text.footer}</span
    >
  </footer>
</div>

<dialog bind:this={addDialog} aria-labelledby="add-title">
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
      maxlength="16384"
      aria-describedby="download-help"
    />
    <p id="download-help" class="helper">{text.networkHint}</p>
    <label for="filename">{text.filename}</label><input
      id="filename"
      bind:value={filename}
      placeholder={text.optional}
      maxlength="180"
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
        onclick={() => chooseFolder()}
        aria-label={text.browse}><Icon name="folder" /></button
      >
    </div>
    <p id="storage-help" class="helper">{text.storageUnknown} {text.storage}</p>
    {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
    <div class="dialog-actions">
      <button type="button" class="secondary" onclick={() => addDialog.close()}>{text.close}</button
      ><button type="submit" class="primary" disabled={busy}
        ><Icon name="download" />{text.start}</button
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
    <div class="browser-setting">
      <h3>{text.browser}</h3>
      <p class="helper">{connected ? text.connected : text.nativeError}</p>
      <button type="button" class="secondary" onclick={connectBrowser}>{text.connect}</button>
      <p class="helper">{text.browserHelp}</p>
    </div>
    {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
    <div class="dialog-actions">
      <button type="button" class="secondary" onclick={() => settingsDialog.close()}
        >{text.close}</button
      ><button type="submit" class="primary" disabled={busy}>{text.save}</button>
    </div>
  </form>
</dialog>
