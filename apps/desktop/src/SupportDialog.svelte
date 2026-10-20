<script lang="ts">
  import { tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { dictionary, type Language } from "./i18n";
  export let language: Language;
  $: text = dictionary(language);
  let dialog: HTMLDialogElement;
  let previewInput: HTMLTextAreaElement;
  let errorBox: HTMLParagraphElement;
  let preview = "";
  let busy = false;
  let error = "";
  let status = "";

  export async function open() {
    preview = "";
    error = "";
    status = "";
    busy = true;
    dialog.showModal();
    try {
      preview = await invoke<string>("preview_support");
      await tick();
      previewInput.focus();
    } catch {
      error = text.supportPreviewFailed;
      await tick();
      errorBox.focus();
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (busy || !preview) return;
    error = "";
    status = "";
    busy = true;
    try {
      const result = await invoke<"saved" | "cancelled">("export_support");
      status = result === "saved" ? text.supportSaved : text.supportCancelled;
    } catch {
      error = text.supportSaveFailed;
      await tick();
      errorBox.focus();
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="support-title"
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
>
  <div class="support-content">
    <div class="dialog-title">
      <h2 id="support-title">{text.supportTitle}</h2>
      <button class="secondary" disabled={busy} onclick={() => dialog.close()}>{text.close}</button>
    </div>
    <p class="helper" id="support-privacy">{text.supportPrivacy}</p>
    <p class="helper">{text.supportNoClobber}</p>
    {#if preview}
      <label for="support-preview">{text.supportPreview}</label>
      <textarea
        id="support-preview"
        bind:this={previewInput}
        value={preview}
        readonly
        dir="ltr"
        rows="9"
        aria-describedby="support-privacy"></textarea>
    {:else if busy}<p role="status">{text.supportLoading}</p>{/if}
    {#if error}<p class="form-error" role="alert" tabindex="-1" bind:this={errorBox}>
        {error}
      </p>{/if}
    {#if status}<p role="status">{status}</p>{/if}
    <div class="dialog-actions">
      <button class="primary" disabled={busy || !preview} onclick={save}
        >{busy ? text.supportLoading : text.supportExport}</button
      >
    </div>
  </div>
</dialog>

<style>
  .support-content {
    padding: 28px;
  }
  label {
    display: block;
    margin-block: 1rem 0.5rem;
  }
  textarea {
    font-family: Consolas, monospace;
    resize: vertical;
  }
</style>
