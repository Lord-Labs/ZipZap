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
export function sendLink(value: string): Promise<string> {
  const url = validateLink(value);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(
      "com.zipzap.native",
      { version: 1, url },
      (response: unknown) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || chrome.i18n.getMessage("missing")));
          return;
        }
        const answer = response as { ok?: boolean; error?: string; id?: string } | null;
        if (answer?.ok && typeof answer.id === "string") resolve(answer.id);
        else reject(new Error(answer?.error || chrome.i18n.getMessage("missing")));
      },
    );
  });
}
