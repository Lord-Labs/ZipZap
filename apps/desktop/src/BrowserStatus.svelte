<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { dictionary, type Language } from "./i18n";
  export let language: Language;
  export let registered: boolean;
  export let help = true;
  let contact = { chrome: false, edge: false };
  $: text = dictionary(language);
  onMount(() => {
    const refresh = () =>
      invoke<typeof contact>("browser_health")
        .then((value) => {
          if (value) contact = value;
        })
        .catch(() => {
          contact = { chrome: false, edge: false };
        });
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  });
</script>

<div aria-live="polite">
  <p>{registered ? text.connected : text.nativeError}</p>
  <p>Chrome: {contact.chrome ? text.browserRecent : text.browserUnknown}</p>
  <p>Edge: {contact.edge ? text.browserRecent : text.browserUnknown}</p>
</div>
{#if help}<p class="helper">{text.browserCheckHelp}</p>{/if}
