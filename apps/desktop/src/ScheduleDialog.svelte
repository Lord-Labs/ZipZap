<script context="module" lang="ts">
  export type Schedule = {
    timing: { kind: "once"; date: string } | { kind: "weekly"; weekdays: number[] };
    start_minute: number;
    stop_minute: number;
  };
  export type ScheduleState = {
    config: Schedule | null;
    next_start: number | null;
    time_zone: string;
    error: string | null;
  };
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { dictionary, type Language } from "./i18n";
  export let language: Language;
  export let state: ScheduleState | undefined;
  export let desktop: boolean;
  export let onsaved: () => Promise<void>;
  $: text = dictionary(language);
  let dialog: HTMLDialogElement;
  let modeInput: HTMLSelectElement;
  let errorBox: HTMLParagraphElement;
  let mode: "off" | "once" | "weekly" = "off";
  let weekdays: number[] = [];
  let date = "";
  let start = "09:00";
  let stop = "17:00";
  let error = "";
  let busy = false;
  const time = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const minutes = (value: string) =>
    /^\d{2}:\d{2}$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : -1;
  export async function open() {
    const config = state?.config;
    mode = config?.timing.kind ?? "off";
    weekdays = config?.timing.kind === "weekly" ? [...config.timing.weekdays] : [1, 2, 3, 4, 5];
    const now = new Date();
    date =
      config?.timing.kind === "once"
        ? config.timing.date
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    start = time(config?.start_minute ?? 540);
    stop = time(config?.stop_minute ?? 1020);
    error = "";
    dialog.showModal();
    await tick();
    modeInput.focus();
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !desktop) return;
    error = "";
    const startMinute = minutes(start);
    const stopMinute = minutes(stop);
    if (
      mode !== "off" &&
      (startMinute < 0 ||
        startMinute >= 1440 ||
        stopMinute < 0 ||
        stopMinute >= 1440 ||
        startMinute === stopMinute ||
        (mode === "weekly" && !weekdays.length))
    ) {
      error = text.scheduleInvalid;
      await tick();
      errorBox.focus();
      return;
    }
    const config: Schedule | null =
      mode === "off"
        ? null
        : {
            timing:
              mode === "once"
                ? { kind: "once", date }
                : { kind: "weekly", weekdays: [...weekdays].sort() },
            start_minute: startMinute,
            stop_minute: stopMinute,
          };
    busy = true;
    try {
      await invoke("set_schedule", { config });
      await onsaved();
      dialog.close();
    } catch {
      error = text.scheduleSaveFailed;
      await tick();
      errorBox.focus();
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="schedule-title"
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
>
  <form onsubmit={save}>
    <div class="dialog-title">
      <h2 id="schedule-title">{text.scheduleTitle}</h2>
      <button type="button" class="secondary" disabled={busy} onclick={() => dialog.close()}
        >{text.close}</button
      >
    </div>
    <p class="helper">{text.scheduleRunningOnly}</p>
    <label for="schedule-mode">{text.scheduleMode}</label>
    <select id="schedule-mode" bind:this={modeInput} bind:value={mode} disabled={busy}>
      <option value="off">{text.scheduleOff}</option>
      <option value="once">{text.scheduleOnce}</option>
      <option value="weekly">{text.scheduleWeekly}</option>
    </select>
    {#if mode !== "off"}
      {#if mode === "once"}
        <label for="schedule-date">{text.scheduleDate}</label>
        <input id="schedule-date" type="date" required bind:value={date} disabled={busy} />
      {:else}
        <fieldset disabled={busy}>
          <legend>{text.scheduleDays}</legend>
          <div class="schedule-days">
            {#each text.scheduleWeekdays.split("|") as label, index}
              <label class="check"
                ><input type="checkbox" value={index + 1} bind:group={weekdays} />{label}</label
              >
            {/each}
          </div>
        </fieldset>
      {/if}
      <div class="settings-grid">
        <div>
          <label for="schedule-start">{text.scheduleStart}</label><input
            id="schedule-start"
            type="time"
            required
            bind:value={start}
            disabled={busy}
          />
        </div>
        <div>
          <label for="schedule-stop">{text.scheduleStop}</label><input
            id="schedule-stop"
            type="time"
            required
            bind:value={stop}
            disabled={busy}
          />
        </div>
      </div>
      <p class="helper">{text.scheduleOvernight}</p>
      <p class="helper">{text.scheduleEnableHint}</p>
    {:else}
      <p class="helper">{text.scheduleDisableHint}</p>
    {/if}
    <p class="helper">
      {text.scheduleZone}: <bdi>{state?.time_zone || text.scheduleZoneUnknown}</bdi>
    </p>
    <details>
      <summary>{text.schedulePolicy}</summary>
      <p class="helper">{text.scheduleMissed}</p>
      <p class="helper">{text.scheduleDst}</p>
      <p class="helper">{text.scheduleManual}</p>
    </details>
    {#if error}<p class="form-error" role="alert" tabindex="-1" bind:this={errorBox}>
        {error}
      </p>{/if}
    <div class="dialog-actions">
      <button class="primary" disabled={busy || !desktop}
        >{busy ? text.scheduleSaving : text.scheduleSave}</button
      >
    </div>
  </form>
</dialog>

<style>
  .schedule-days {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .schedule-days .check {
    margin: 0;
    display: inline-flex;
    align-items: center;
    min-height: 32px;
  }
  fieldset {
    margin-block: 1rem;
    padding: 0.75rem;
    border: 1px solid var(--input-border);
    border-radius: 8px;
  }
  details {
    margin-block: 1rem;
  }
  summary {
    cursor: pointer;
  }
</style>
