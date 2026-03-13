const WATERMARK_ID = "copilotkit-license-watermark";
const HEADER_NAME = "X-CopilotCloud-Public-Api-Key";
const LICENSE_KEY_REGEX = /^ck_pub_[0-9a-f]{32}$/i;

function hasValidLicenseHeader(headers?: Record<string, string>): boolean {
  if (!headers) return false;
  const key = headers[HEADER_NAME];
  return Boolean(key && LICENSE_KEY_REGEX.test(key));
}

export function ensureLicenseWatermark(headers?: Record<string, string>): void {
  if (typeof document === "undefined" || hasValidLicenseHeader(headers)) {
    return;
  }

  if (document.getElementById(WATERMARK_ID)) {
    return;
  }

  const watermark = document.createElement("div");
  watermark.id = WATERMARK_ID;
  watermark.setAttribute("aria-hidden", "true");
  watermark.textContent = "CopilotKit Unlicensed";
  watermark.style.position = "fixed";
  watermark.style.right = "12px";
  watermark.style.bottom = "12px";
  watermark.style.zIndex = "2147483647";
  watermark.style.pointerEvents = "none";
  watermark.style.userSelect = "none";
  watermark.style.padding = "6px 10px";
  watermark.style.borderRadius = "8px";
  watermark.style.background = "rgba(17, 24, 39, 0.88)";
  watermark.style.color = "#ffffff";
  watermark.style.fontFamily =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  watermark.style.fontSize = "11px";
  watermark.style.fontWeight = "600";
  watermark.style.letterSpacing = "0.02em";
  watermark.style.opacity = "0.9";
  watermark.style.boxShadow = "0 6px 18px rgba(0, 0, 0, 0.25)";

  document.body.appendChild(watermark);
}
