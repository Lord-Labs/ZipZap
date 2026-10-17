<script lang="ts">
  export let name = "download";
  const paths: Record<string, string> = {
    download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
    plus: "M12 5v14M5 12h14",
    search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    pause: "M8 5v14M16 5v14",
    pauseAll: "M6 8v13M12 8v13M18 8v13M4 3h16",
    compressed: "M14 2H5v20h14V7zM14 2v6h5M10 3v2m0 2v2m0 2v2m-1 3h3v3H9z",
    documents: "M14 2H5v20h14V7zM14 2v6h5M8 13h8M8 17h5",
    music: "M9 18V5l11-2v13M9 8l11-2M9 18a3 3 0 1 1-3-3h3m11 1a3 3 0 1 1-3-3h3",
    programs: "M3 3h18v18H3zM3 8h18M7 5h1m3 0h1M8 12l-3 3 3 3m8-6 3 3-3 3",
    video: "M3 5h18v14H3zM10 9l6 3-6 3z",
    other: "M14 2H5v20h14V7zM14 2v6h5",
    play: "m8 4 12 8-12 8z",
    close: "m6 6 12 12M6 18 18 6",
    check: "m5 12 4 4L19 6",
    folder: "M3 7V4h6l2 3h10v13H3z",
    file: "M14 2H5v20h14V7zM14 2v6h5M8 13h8M8 17h5",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
    globe: "M2 12h20M12 2c6 6 6 14 0 20-6-6-6-14 0-20M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    shield: "m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6zM8 12l3 3 5-6",
    speed: "M4 19a10 10 0 1 1 16 0M12 13l5-5M8 19h8",
    trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
    external: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
    clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
    alert: "m12 3 10 18H2zM12 9v5m0 3v1",
  };
</script>

<svg
  width="20"
  height="20"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name] ?? paths.download} /></svg
>
