<script lang="ts">
  import { tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { dictionary, type Language } from "./i18n";

  export let language: Language;
  export let folder: string;
  export let desktop: boolean;
  export let message: (error: unknown) => string;
  export let onadded: () => Promise<void>;
  $: text = dictionary(language);

  type Row = {
    id: string;
    url: string;
    filename: string;
    included: boolean;
    state: "pending" | "checking" | "ready" | "invalid" | "error" | "accepted";
    detail: string;
    attempted: boolean;
    total: number | null;
  };
  let dialog: HTMLDialogElement;
  let input: HTMLTextAreaElement;
  let pasted = "";
  let destination = "";
  let rows: Row[] = [];
  let error = "";
  let later = false;
  let busy = false;
  let enqueueing = false;
  let probe = "";
  let generation = 0;
  $: accepted = rows.some((row) => row.state === "accepted");
  const duplicateName = (row: Row) =>
    !!row.filename &&
    rows.some(
      (other) =>
        other !== row &&
        other.included &&
        other.filename.toLowerCase() === row.filename.toLowerCase(),
    );
  $: ready = rows.filter(
    (row) =>
      row.included &&
      !duplicateName(row) &&
      (row.state === "ready" || (row.state === "error" && row.attempted)),
  );

  export async function open() {
    pasted = "";
    destination = folder;
    rows = [];
    error = "";
    later = false;
    dialog.showModal();
    await tick();
    input.focus();
  }

  function closed() {
    generation++;
    if (probe) void invoke("cancel_probe", { id: probe }).catch(() => {});
    probe = "";
    busy = false;
  }

  async function chooseFolder() {
    try {
      const value = await invoke<string | null>("select_folder");
      if (value) destination = value;
    } catch (e) {
      error = message(e);
    }
  }

  async function preview() {
    if (busy || !desktop) return;
    error = "";
    if (!rows.length) {
      const links = pasted
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (!links.length || links.length > 100 || pasted.length > 1638500) {
        error = text.batchLimit;
        return;
      }
      const seen = new Set<string>();
      rows = links.map((url) => {
        let detail = "";
        try {
          const value = new URL(url);
          if (
            !["http:", "https:"].includes(value.protocol) ||
            !value.hostname ||
            value.username ||
            value.password ||
            url.length > 16384
          )
            throw new Error();
          value.hash = "";
          if (seen.has(value.href)) detail = text.batchDuplicateUrl;
          seen.add(value.href);
        } catch {
          detail = text.invalidUrl;
        }
        return {
          id: crypto.randomUUID(),
          url,
          filename: "",
          included: !detail,
          state: detail ? "invalid" : "pending",
          detail,
          attempted: false,
          total: null,
        };
      });
    }
    busy = true;
    const current = ++generation;
    for (const row of rows) {
      if (!row.included || row.attempted || row.state === "invalid") continue;
      row.state = "checking";
      row.detail = "";
      rows = [...rows];
      const id = crypto.randomUUID();
      probe = id;
      try {
        const result = await invoke<{
          filename: string;
          total: number | null;
          alternative: string | null;
        }>("suggest_download", {
          id,
          url: row.url,
          filename: row.filename.trim() || null,
          destination,
        });
        if (current !== generation) return;
        row.filename = result.filename;
        row.total = result.total;
        row.state = result.alternative ? "error" : "ready";
        row.detail = result.alternative ? `${text.duplicateName} ${result.alternative}` : "";
      } catch (e) {
        if (current !== generation) return;
        row.state = "error";
        row.detail = message(e);
      }
      probe = "";
      rows = [...rows];
    }
    rows = [...rows];
    busy = false;
  }

  async function enqueue() {
    if (busy || !desktop) return;
    busy = true;
    enqueueing = true;
    const targets = [...ready];
    for (const row of targets) {
      row.attempted = true;
      try {
        await invoke("add_download", {
          url: row.url,
          filename: row.filename,
          destination,
          later,
          requestId: row.id,
        });
        row.state = "accepted";
        row.detail = "";
      } catch (e) {
        row.state = "error";
        row.detail = message(e);
      }
      rows = [...rows];
    }
    try {
      await onadded();
    } finally {
      busy = false;
      enqueueing = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="batch-title"
  onclose={closed}
  oncancel={(event) => {
    if (enqueueing) event.preventDefault();
  }}
>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void preview();
    }}
  >
    <div class="dialog-title">
      <h2 id="batch-title">{text.batchAdd}</h2>
      <button
        type="button"
        class="icon-button"
        disabled={enqueueing}
        onclick={() => dialog.close()}
        aria-label={text.close}>×</button
      >
    </div>
    <label for="batch-links">{text.batchLinks}</label>
    <textarea
      id="batch-links"
      bind:this={input}
      bind:value={pasted}
      dir="ltr"
      rows="5"
      maxlength="1638500"
      disabled={busy || rows.length > 0}
      aria-describedby="batch-help"></textarea>
    <p id="batch-help" class="helper">{text.batchHint}</p>
    <label for="batch-folder">{text.destination}</label>
    <div class="folder-picker">
      <input id="batch-folder" value={destination} readonly dir="ltr" />
      <button
        type="button"
        class="secondary"
        disabled={!desktop || busy || rows.length > 0}
        onclick={chooseFolder}>{text.browse}</button
      >
    </div>
    <label class="helper"
      ><input
        type="checkbox"
        bind:checked={later}
        disabled={busy || rows.some((row) => row.attempted)}
      />{text.addLater}</label
    >
    <p class="helper">{text.storageUnknown} {text.storage}</p>
    {#if rows.length}
      <ol class="batch-rows">
        {#each rows as row, index (row.id)}
          <li>
            <label
              ><input
                type="checkbox"
                bind:checked={row.included}
                disabled={busy || row.state === "invalid" || row.attempted}
              />{text.batchInclude}
              {index + 1}</label
            >
            <bdi dir="ltr" class="batch-url">{row.url}</bdi>
            <label for={`batch-name-${row.id}`}>{text.filename} {index + 1}</label>
            <input
              id={`batch-name-${row.id}`}
              bind:value={row.filename}
              maxlength="180"
              disabled={busy || row.state === "invalid" || row.attempted}
              oninput={() => {
                row.state = "pending";
                row.detail = "";
                rows = [...rows];
              }}
            />
            <p class="helper" role="status">
              {row.state === "accepted"
                ? text.batchAccepted
                : row.state === "checking"
                  ? text.checkingName
                  : duplicateName(row)
                    ? text.batchDuplicateName
                    : row.state === "ready"
                      ? text.batchReady
                      : row.state === "pending"
                        ? text.batchUnchecked
                        : ""}
              {#if row.total !== null}<bdi dir="ltr">{row.total.toLocaleString(language)} B</bdi
                >{/if}
            </p>
            {#if row.detail}<p class="job-error" role="status">{row.detail}</p>{/if}
          </li>
        {/each}
      </ol>
      <p class="helper">{text.batchRetryHint}</p>
    {/if}
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    <div class="dialog-actions">
      <button type="button" class="secondary" disabled={enqueueing} onclick={() => dialog.close()}
        >{text.close}</button
      >
      {#if rows.length && !accepted}<button
          type="button"
          class="secondary"
          disabled={busy || rows.some((row) => row.attempted)}
          onclick={() => (rows = [])}>{text.batchEdit}</button
        >{/if}
      <button type="submit" class="secondary" disabled={!desktop || busy}
        >{text.batchPreview}</button
      >
      <button
        type="button"
        class="primary"
        disabled={!desktop || busy || !ready.length}
        onclick={enqueue}>{later ? text.addLaterButton : text.batchEnqueue} ({ready.length})</button
      >
    </div>
  </form>
</dialog>
