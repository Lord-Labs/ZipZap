<script lang="ts">
  import { tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import BrowserStatus from "./BrowserStatus.svelte";
  import { dictionary, type Language } from "./i18n";
  export let language: Language;
  export let folder: string;
  export let registered: boolean;
  export let jobs: {
    id: string;
    url: string;
    status: "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";
    publication?: { sha256: string; bytes: number } | null;
  }[];
  export let onsave: (language: Language, folder: string) => Promise<void>;
  export let onconnect: () => Promise<void>;
  const key = "zipzap.setup.v1";
  const fixture =
    "https://raw.githubusercontent.com/Lord-Labs/ZipZap/ab69bc0d97bdedc9f97e543b7fa8d24146095b3c/LICENSE";
  const sha256 = "86c61424f3af99d567c4386400a28c9f47b0e33a6228a59b671c81797b266120";
  let dialog: HTMLDialogElement;
  let title: HTMLHeadingElement;
  let step = 1;
  let draftLanguage: Language = language;
  let draftFolder = "";
  let error = "";
  let busy = false;
  let testId = "";
  let extensionPath = "";
  let clipboardNotice = "";
  $: text = dictionary(draftLanguage);
  $: testJob = jobs.find((job) => job.id === testId && job.url === fixture);
  $: verified =
    testJob?.status === "completed" &&
    testJob.publication?.sha256 === sha256 &&
    testJob.publication.bytes === 1076;
  function progress(done = false) {
    localStorage.setItem(key, JSON.stringify({ step, done, testId }));
  }
  export async function open(startStep?: number) {
    draftLanguage = language;
    draftFolder = folder;
    error = "";
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      step = saved && !saved.done && [1, 2, 3].includes(saved.step) ? saved.step : 1;
      if (startStep === 2) step = 2;
      testId =
        typeof saved?.testId === "string" && /^[a-f0-9-]{36}$/.test(saved.testId)
          ? saved.testId
          : "";
      progress();
    } catch {
      error = text.setupStorage;
    }
    dialog.showModal();
    if (step === 2) void loadExtensionPath();
    await tick();
    title.focus();
  }
  export function offer(firstRun: boolean) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if ((saved && saved.done === false) || (!saved && firstRun)) void open();
    } catch {
      /* Reopen from Settings if local storage is unavailable. */
    }
  }
  async function advance(target: number) {
    if (busy) return;
    busy = true;
    error = "";
    const previous = step;
    try {
      if (step === 1 && target > step) await onsave(draftLanguage, draftFolder);
      step = target;
      progress();
      if (step === 2) await loadExtensionPath();
      await tick();
      title.focus();
    } catch {
      step = previous;
      error = text.setupSaveFailed;
    } finally {
      busy = false;
    }
  }
  async function chooseFolder() {
    try {
      const value = await invoke<string | null>("select_folder");
      if (value) draftFolder = value;
    } catch {
      error = text.setupFolderFailed;
    }
  }
  async function extensionFolder() {
    try {
      await invoke("open_extension_folder");
    } catch {
      error = text.setupExtensionMissing;
    }
  }
  async function loadExtensionPath() {
    extensionPath = "";
    clipboardNotice = "";
    try {
      extensionPath = await invoke<string>("extension_directory");
    } catch {
      error = text.setupExtensionMissing;
    }
  }
  async function copyExtensionPath() {
    clipboardNotice = "";
    try {
      await navigator.clipboard.writeText(extensionPath);
      clipboardNotice = text.setupPathCopied;
    } catch {
      clipboardNotice = text.setupCopyFailed;
    }
  }
  async function openBrowser(browser: "chrome" | "edge") {
    if (busy || !extensionPath) return;
    busy = true;
    error = "";
    await copyExtensionPath();
    try {
      await invoke("open_browser_extensions", { browser });
    } catch {
      error = text.setupBrowserOpenFailed;
    } finally {
      busy = false;
    }
  }
  async function connect() {
    busy = true;
    try {
      await onconnect();
      error = "";
    } catch {
      error = text.nativeRecovery;
    } finally {
      busy = false;
    }
  }
  async function test() {
    if (busy) return;
    busy = true;
    error = "";
    try {
      if (testJob && ["failed", "paused"].includes(testJob.status)) {
        await invoke("download_action", {
          id: testId,
          action: "resume",
        });
      } else if (!testJob || ["completed", "cancelled"].includes(testJob.status)) {
        if (testJob) testId = crypto.randomUUID();
        testId ||= crypto.randomUUID();
        progress();
        await invoke("add_download", {
          url: fixture,
          destination: folder,
          filename: `ZipZap-connection-test-${testId}.txt`,
          requestId: testId,
          later: false,
        });
      }
    } catch {
      error = text.setupTestFailed;
    } finally {
      busy = false;
    }
  }
  async function cancelTest() {
    try {
      await invoke("download_action", { id: testId, action: "cancel" });
    } catch {
      error = text.setupTestFailed;
    }
  }
  function finish() {
    try {
      progress(true);
      dialog.close();
    } catch {
      error = text.setupStorage;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="setup-title"
  lang={draftLanguage}
  dir={draftLanguage === "ar" ? "rtl" : "ltr"}
>
  <div class="setup-content">
    <h2 id="setup-title" tabindex="-1" bind:this={title}>{text.setupTitle}</h2>
    <p class="helper">{text.setupIntro}</p>
    <ol class="setup-steps" aria-label={text.setupProgress}>
      {#each [text.setupBasics, text.setupBrowser, text.setupVerify] as label, index}
        <li aria-current={step === index + 1 ? "step" : undefined}>{index + 1}. {label}</li>
      {/each}
    </ol>
    {#if step === 1}
      <label for="setup-language">{text.language}</label>
      <select id="setup-language" bind:value={draftLanguage} disabled={busy}
        ><option value="en">English</option><option value="ar">العربية</option></select
      >
      <label for="setup-folder">{text.defaultFolder}</label>
      <div class="folder-field">
        <input id="setup-folder" readonly value={draftFolder} dir="ltr" /><button
          type="button"
          class="secondary"
          disabled={busy}
          onclick={chooseFolder}>{text.browse}</button
        >
      </div>
      <p class="helper">{text.setupBasicsHelp}</p>
    {:else if step === 2}
      <p>{text.setupExtensionHelp}</p>
      <div class="browser-actions">
        <button
          type="button"
          class="secondary"
          disabled={busy || !extensionPath}
          onclick={() => openBrowser("chrome")}>{text.setupOpenChrome}</button
        >
        <button
          type="button"
          class="secondary"
          disabled={busy || !extensionPath}
          onclick={() => openBrowser("edge")}>{text.setupOpenEdge}</button
        >
      </div>
      <p class="helper"><code>chrome://extensions</code> · <code>edge://extensions</code></p>
      <ol>
        <li>{text.setupExtensionOne}</li>
        <li>{text.setupExtensionTwo}</li>
        <li>{text.setupExtensionThree}</li>
      </ol>
      <label for="setup-extension-path">{text.setupPath}</label>
      <div class="folder-field">
        <input id="setup-extension-path" readonly value={extensionPath} dir="ltr" />
        <button
          type="button"
          class="secondary"
          disabled={busy || !extensionPath}
          onclick={copyExtensionPath}>{text.setupCopyPath}</button
        >
      </div>
      {#if clipboardNotice}<p role="status">{clipboardNotice}</p>{/if}
      <button type="button" class="secondary" onclick={extensionFolder}
        >{text.setupOpenExtension}</button
      >
      <button type="button" class="secondary" disabled={busy} onclick={connect}
        >{text.connect}</button
      >
      <BrowserStatus language={draftLanguage} {registered} help={false} />
      <p class="helper">{text.setupExplicit}</p>
    {:else}
      <p>{text.setupManualReady}</p>
      <BrowserStatus language={draftLanguage} {registered} help={false} />
      <p>{text.setupTestSummary}</p>
      <details>
        <summary>{text.setupTestDetails}</summary>
        <p class="helper">{text.setupTestConsent}</p>
      </details>
      <p class="helper"><bdi>{folder}</bdi></p>
      <button
        type="button"
        class="secondary"
        disabled={busy ||
          verified ||
          (testJob && ["queued", "downloading"].includes(testJob.status))}
        onclick={test}>{text.setupTest}</button
      >
      {#if testJob && ["queued", "downloading"].includes(testJob.status)}<button
          type="button"
          class="secondary"
          onclick={cancelTest}>{text.cancel}</button
        >{/if}
      <p role="status" aria-live="polite">
        {verified
          ? text.setupTestVerified
          : testJob?.status === "completed"
            ? text.setupTestMismatch
            : testJob
              ? `${text.setupTestState} ${dictionary(draftLanguage)[testJob.status]}`
              : text.setupTestOptional}
      </p>
    {/if}
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    <div class="dialog-actions">
      <button type="button" class="secondary" disabled={busy} onclick={() => dialog.close()}
        >{text.setupLater}</button
      >
      {#if step > 1}<button
          type="button"
          class="secondary"
          disabled={busy}
          onclick={() => advance(step - 1)}>{text.setupBack}</button
        >{/if}
      {#if step === 2}<button
          type="button"
          class="secondary"
          disabled={busy}
          onclick={() => advance(3)}>{text.setupSkipBrowser}</button
        >{/if}
      {#if step < 3}<button
          type="button"
          class="primary"
          disabled={busy || !draftFolder}
          onclick={() => advance(step + 1)}>{text.setupNext}</button
        >
      {:else}<button type="button" class="primary" onclick={finish}>{text.setupFinish}</button>{/if}
    </div>
  </div>
</dialog>

<style>
  .setup-content {
    max-width: 100%;
    padding: 28px;
  }
  h2 {
    font-size: 23px;
    line-height: 1.3;
    width: fit-content;
    margin-block: 0 12px;
  }
  h2:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 5px;
    border-radius: 2px;
  }
  .setup-content > p {
    line-height: 1.65;
  }
  bdi {
    overflow-wrap: anywhere;
  }
  .setup-steps {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    list-style: none;
    padding: 0;
    margin-block: 20px;
  }
  .setup-steps [aria-current="step"] {
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 6px;
  }
  .dialog-actions {
    flex-wrap: wrap;
  }
  .folder-field {
    display: flex;
    gap: 8px;
  }
  .browser-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .folder-field input {
    min-width: 0;
    flex: 1;
  }
  label {
    display: block;
    margin-block: 16px 6px;
  }
</style>
