"use strict";

function setCopied(btn, copied) {
  const label = copied ? "Copied" : "Copy command";
  btn.textContent = label;
}

async function copyFromPre(preId, btn) {
  const pre = document.getElementById(preId);
  if (!pre) return;
  const text = pre.textContent.trim();
  try {
    await navigator.clipboard.writeText(text);
    setCopied(btn, true);
    setTimeout(() => setCopied(btn, false), 1200);
  } catch {
    setCopied(btn, true);
    setTimeout(() => setCopied(btn, false), 1200);
  }
}

document.querySelectorAll("[data-copy-id]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const preId = btn.getAttribute("data-copy-id");
    copyFromPre(preId, btn);
  });
});
