"use strict";

const params = new URLSearchParams(location.search);
const url   = params.get("url")   || "";
const title = params.get("title") || "";

if (title) document.title = title;
document.getElementById("url-display").textContent = url || "(no URL)";

// about:, chrome:, and moz-extension: pages cannot be opened by extensions
const isRestricted = /^(about:|chrome:|moz-extension:)/i.test(url);

if (isRestricted) {
  document.getElementById("title-text").textContent = "Internal page — can't be restored";
  document.querySelector("p").textContent =
    "This is a browser-internal page that extensions are not allowed to open. " +
    "Copy the URL and paste it into the address bar manually.";

  const btnOpen = document.getElementById("btn-open");
  btnOpen.textContent = "Close this tab";
  btnOpen.addEventListener("click", async () => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id != null) await browser.tabs.remove(tabs[0].id);
    } catch (e) {
      document.getElementById("status").textContent = "Could not close tab: " + e.message;
    }
  });
} else {
  document.getElementById("btn-open").addEventListener("click", async () => {
    if (!url) return;
    try {
      await browser.tabs.create({ url });
    } catch (e) {
      document.getElementById("status").textContent = "Could not open: " + e.message;
    }
  });
}

document.getElementById("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(url);
    document.getElementById("status").textContent = "URL copied to clipboard";
    setTimeout(() => { document.getElementById("status").textContent = ""; }, 2000);
  } catch {
    document.getElementById("status").textContent = "Copy failed — select and copy the URL above manually";
  }
});
