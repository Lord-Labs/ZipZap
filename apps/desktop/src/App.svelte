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

  let folder = "";

  let version = "0.1.0-beta.1";

  let filter = "all";

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
        `${basename(j.destination)} ${hostname(j.url)}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    )
    .slice()
    .reverse();

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

      if (value.notice) error = value.notice;
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
      search = "";
      await refresh();
    } catch (e) {
      formError = String(e);
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
      formError = String(e);
    }
  }

  async function action(job: Job, value: string) {
    busyIds = new Set([...busyIds, job.id]);
    error = "";

    try {
      await invoke("download_action", { id: job.id, action: value });
      await refresh();
    } catch (e) {
      error = String(e);
    } finally {
      const next = new Set(busyIds);
      next.delete(job.id);
      busyIds = next;
    }
  }

  async function openFile(job: Job, reveal = false) {
    try {
      await invoke("open_download", { id: job.id, reveal });
    } catch (e) {
      error = String(e);
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
      formError = String(e);
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
        error = String(e);
      }
    }
  }

  async function connectBrowser() {
    try {
      await invoke("connect_browser");
      connected = true;
      notice = text.connected;
    } catch (e) {
      formError = String(e);
    }
  }
</script>

<a class="skip-link" href="#downloads">{text.downloads}</a>

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

<div class="shell">
  <aside class="sidebar">
    <a class="brand" href="#downloads" aria-label="ZipZap"
      ><span class="brand-mark"
        ><svg width="30" height="30" viewBox="0 0 256 256" aria-hidden="true"
          ><path d="M65 65h130l-93 101h89v28H58v-25l91-77H65z" fill="currentColor" /><path
            d="m175 112 29 0 0 43 14-14 17 18-44 43-42-43 17-18 9 10z"
            fill="#b7f7d2"
          /></svg
        ></span
      ><span>ZipZap<span class="brand-dot">.</span></span></a
    >

    <div class="workspace-label">{text.downloads}</div>

    <nav aria-label={text.filter}>
      {#each [{ id: "all", label: text.all, icon: "grid", count: jobs.length }, { id: "active", label: text.active, icon: "download", count: activeCount }, { id: "completed", label: text.completed, icon: "check", count: completedCount }, { id: "paused", label: text.paused, icon: "pause", count: jobs.filter((j) => j.status === "paused").length }, { id: "failed", label: text.failed, icon: "alert", count: jobs.filter((j) => j.status === "failed").length }] as item}
        <button
          class:chosen={filter === item.id}
          aria-current={filter === item.id ? "page" : undefined}
          onclick={() => (filter = item.id)}
          title={item.label}
          aria-label={item.label}
          ><Icon name={item.icon} /><span>{item.label}</span><span class="nav-count"
            >{item.count}</span
          ></button
        >
      {/each}
    </nav>

    <div class="sidebar-bottom">
      <div class="local-note"><Icon name="shield" /><span>{text.local}</span></div>
      <button
        class="sidebar-settings"
        aria-label={text.settings}
        onclick={showSettings}
        aria-haspopup="dialog"><Icon name="settings" /><span>{text.settings}</span></button
      >
      <div class="sidebar-version">{text.version}<span dir="ltr">{version}</span></div>
    </div>
  </aside>

  <main id="downloads" tabindex="-1">
    <header class="topbar">
      <div class="breadcrumb">ZipZap <span>/</span> {text.downloads}</div>
      <button class="language" onclick={switchLanguage}
        ><Icon name="globe" />{language === "en" ? "العربية" : "English"}</button
      >
    </header>

    <div class="content">
      <section class="heading">
        <div>
          <div class="eyebrow">
            <span class="status-dot"></span>{ready ? text.ready : text.loading}
          </div>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <button class="primary add-button" onclick={newDownload} aria-haspopup="dialog"
          ><Icon name="plus" />{text.add}</button
        >
      </section>

      <section class="stats" aria-label={text.downloadSettings}>
        <div class="stat">
          <span class="stat-icon"><Icon name="download" /></span>
          <div>
            <span>{text.active}</span><strong
              >{new Intl.NumberFormat(language).format(activeCount)}<small>{text.files}</small
              ></strong
            >
          </div>
        </div>

        <div class="stat">
          <span class="stat-icon blue"><Icon name="check" /></span>
          <div>
            <span>{text.completed}</span><strong
              >{new Intl.NumberFormat(language).format(completedCount)}<small>{text.files}</small
              ></strong
            >
          </div>
        </div>

        <div class="stat">
          <span class="stat-icon orange"><Icon name="speed" /></span>
          <div>
            <span>{text.speed}</span><strong class="speed-number" dir="ltr"
              >{bytes(totalSpeed)}<small>/s</small></strong
            >
          </div>
        </div>
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

      <section class="download-panel" aria-label={text.downloads}>
        <div class="panel-toolbar">
          <h2>
            {filter === "all"
              ? text.all
              : filter === "active"
                ? text.active
                : text[filter as "paused" | "failed" | "completed"]}<span class="count-pill"
              >{filtered.length}</span
            >
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

        {#if !ready}<div class="empty">
            <span class="empty-icon"><Icon name="clock" /></span>
            <h3>{text.loading}</h3>
          </div>
        {:else if filtered.length === 0}
          <div class="empty">
            <div class="empty-orbit">
              <span class="empty-icon"><Icon name="download" /></span><span class="orbit-dot"
              ></span>
            </div>
            <h3>{search || filter !== "all" ? text.noResults : text.empty}</h3>
            <p>{text.emptyText}</p>
            <button class="secondary" onclick={newDownload}
              ><Icon name="plus" />{text.emptyAction}</button
            >
            <div class="empty-tags">
              <span><Icon name="shield" />{text.private}</span><span
                ><Icon name="check" />{text.account}</span
              >
            </div>
          </div>
        {:else}
          <ul class="job-list">
            {#each filtered as job (job.id)}
              <li class="job" class:failed={job.status === "failed"}>
                <div class="file-icon"><Icon name="file" /></div>

                <div class="job-info">
                  <div class="file-heading">
                    <strong title={basename(job.destination)}
                      ><bdi>{basename(job.destination)}</bdi></strong
                    ><span
                      class="badge"
                      class:finished={job.status === "completed"}
                      class:running={job.status === "downloading"}
                      class:danger={job.status === "failed"}>{text[job.status]}</span
                    >
                  </div>
                  <div class="file-origin">
                    <bdi dir="ltr">{hostname(job.url)}</bdi><span>·</span><bdi dir="ltr"
                      >{job.total !== null ? bytes(job.total) : text.unknown}</bdi
                    >
                  </div>

                  <progress
                    max="100"
                    value={job.total || job.status === "completed" ? percent(job) : undefined}
                    aria-label={`${basename(job.destination)} ${text[job.status]}`}
                  ></progress>

                  <div class="progress-detail">
                    <span
                      ><bdi dir="ltr"
                        >{bytes(job.downloaded)}{job.total !== null
                          ? ` / ${bytes(job.total)}`
                          : ""}</bdi
                      ></span
                    ><span
                      >{job.status === "downloading"
                        ? `${bytes(job.speed)}/s`
                        : job.status === "queued"
                          ? text.waiting
                          : ""}{remaining(job) ? ` · ${remaining(job)}` : ""}</span
                    >
                  </div>

                  {#if job.error}<p class="job-error" role="status">{job.error}</p>{/if}
                </div>

                <div class="job-actions" aria-label={text.actions}>
                  {#if ["downloading", "queued"].includes(job.status)}<button
                      class="icon-button"
                      disabled={busyIds.has(job.id)}
                      onclick={() => action(job, "pause")}
                      aria-label={text.pause}
                      title={text.pause}><Icon name="pause" /></button
                    >
                  {:else if ["paused", "failed"].includes(job.status)}<button
                      class="icon-button resume"
                      disabled={busyIds.has(job.id)}
                      onclick={() => action(job, "resume")}
                      aria-label={job.status === "failed" ? text.retry : text.resume}
                      title={text.resume}><Icon name="play" /></button
                    >
                  {/if}

                  {#if job.status === "completed"}<button
                      class="icon-button"
                      onclick={() => openFile(job)}
                      aria-label={text.open}
                      title={text.open}><Icon name="external" /></button
                    ><button
                      class="icon-button"
                      onclick={() => openFile(job, true)}
                      aria-label={text.reveal}
                      title={text.reveal}><Icon name="folder" /></button
                    >{/if}

                  {#if ["queued", "downloading", "paused"].includes(job.status)}<button
                      class="icon-button"
                      disabled={busyIds.has(job.id)}
                      onclick={() => action(job, "cancel")}
                      aria-label={text.cancel}
                      title={text.cancel}><Icon name="close" /></button
                    >{:else}<button
                      class="icon-button"
                      disabled={busyIds.has(job.id)}
                      onclick={() => action(job, "remove")}
                      aria-label={text.remove}
                      title={text.remove}><Icon name="trash" /></button
                    >{/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <footer>
        <span><Icon name="shield" />{text.private}</span><span>{text.footer}</span><span
          >ZipZap <bdi>{version}</bdi></span
        >
      </footer>
    </div>
  </main>
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
      <input id="destination" value={pathLabel(destination)} readonly dir="ltr" /><button
        type="button"
        class="secondary"
        onclick={() => chooseFolder()}
        aria-label={text.browse}><Icon name="folder" /></button
      >
    </div>
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
