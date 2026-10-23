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
export function checkConnection(): Promise<boolean> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(chrome.i18n.getMessage("healthTimeout"))),
      3000,
    );
    chrome.runtime.sendNativeMessage(
      "com.zipzap.native",
      {
        version: 2,
        action: "health",
        id,
        browser: navigator.userAgent.includes("Edg/") ? "edge" : "chrome",
      },
      (value: unknown) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) return reject(new Error(chrome.i18n.getMessage("missing")));
        const answer = value as Record<string, unknown> | null;
        if (
          answer?.version !== 2 ||
          answer.id !== id ||
          answer.state !== "health" ||
          typeof answer.app_ready !== "boolean" ||
          typeof answer.host_version !== "string" ||
          !Array.isArray(answer.capabilities) ||
          !answer.capabilities.includes("explicit")
        )
          return reject(new Error(chrome.i18n.getMessage("protocol")));
        resolve(answer.app_ready);
      },
    );
  });
}
const codes = [
  "destination",
  "app_rejected",
  "app_start_failed",
  "expired",
  "inbox_full",
  "host_rejected",
  "capture_expired",
];
function native(message: object, id: string, timeoutMs = 3000, version = 2): Promise<Answer> {
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
        answer?.version !== version ||
        answer.id !== id ||
        !["received", "queued", "rejected", ...(version === 3 ? ["prepared"] : [])].includes(
          answer.state,
        ) ||
        (answer.state === "rejected" && !codes.includes(answer.code || ""))
      ) {
        reject(new Error(chrome.i18n.getMessage("protocol")));
      } else resolve(answer);
    });
  });
}

export async function captureOperation(
  action: "prepare" | "activate" | "status",
  id: string,
  url?: string,
): Promise<Answer> {
  const deadline = Date.now() + 15000;
  let answer = await native({ version: 3, action, id, ...(url ? { url } : {}) }, id, 3000, 3);
  while (
    action !== "status" &&
    (answer.state === "received" || (action === "activate" && answer.state === "prepared"))
  ) {
    if (Date.now() >= deadline) throw new Error("Capture acknowledgment unavailable");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Capture acknowledgment unavailable");
    answer = await native({ version: 3, action: "status", id }, id, Math.min(3000, remaining), 3);
  }
  return answer;
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
