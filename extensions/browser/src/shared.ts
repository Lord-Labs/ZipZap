export function validateLink(value: string): string {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.length > 16384
  )
    throw new Error(chrome.i18n.getMessage("invalid"));
  return url.href;
}
type Answer = { version: number; id: string; state: string; code?: string };
const codes = [
  "destination",
  "app_rejected",
  "app_start_failed",
  "expired",
  "inbox_full",
  "host_rejected",
];
function native(message: object, id: string, timeoutMs = 3000): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(chrome.i18n.getMessage("timeout"))),
      timeoutMs,
    );
    chrome.runtime.sendNativeMessage("com.zipzap.native", message, (response: unknown) => {
      clearTimeout(timeout);
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(chrome.i18n.getMessage("missing")));
        return;
      }
      const answer = response as Answer | null;
      if (
        answer?.version !== 2 ||
        answer.id !== id ||
        !["received", "queued", "rejected"].includes(answer.state) ||
        (answer.state === "rejected" && !codes.includes(answer.code || ""))
      ) {
        reject(new Error(chrome.i18n.getMessage("protocol")));
      } else resolve(answer);
    });
  });
}

export async function sendLink(value: string, received: () => void = () => {}): Promise<string> {
  const url = validateLink(value);
  const id = crypto.randomUUID();
  const deadline = Date.now() + 15000;
  let answer = await native({ version: 2, action: "enqueue", id, url }, id);
  if (answer.state === "received") received();
  while (answer.state === "received") {
    if (Date.now() >= deadline) throw new Error(chrome.i18n.getMessage("timeout"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(chrome.i18n.getMessage("timeout"));
    answer = await native({ version: 2, action: "status", id }, id, Math.min(3000, remaining));
  }
  if (answer.state === "rejected") throw new Error(chrome.i18n.getMessage(answer.code!));
  return id;
}
