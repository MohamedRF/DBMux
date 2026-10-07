import { copyText } from "./clipboard.js";
const notify = (text) => {
  document.getElementById("message").textContent = text;
};
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.onclick = () =>
    copyText(
      document.getElementById(button.dataset.copy).textContent,
      button,
      notify,
    );
});
document.getElementById("copyGuideLink").onclick = (event) =>
  copyText(
    new URL("/guide.html", location.href).href,
    event.currentTarget,
    notify,
  );
document.getElementById("copyGuide").onclick = (event) => {
  // Use textContent to include collapsed help answers; omit copy controls.
  const content = document.getElementById("guideContent").cloneNode(true);
  content.querySelectorAll("button").forEach((button) => button.remove());
  const text = [...content.querySelectorAll("section")]
    .map((section) => {
      return [
        ...section.querySelectorAll(
          "h2, p, li, pre, tr, summary, .callout, .flow",
        ),
      ]
        .filter((element) => !element.closest("li") || element.tagName === "LI")
        .map((element) =>
          element.tagName === "TR"
            ? [...element.children]
                .map((cell) => cell.textContent.trim())
                .join(" | ")
            : element.textContent.trim(),
        )
        .join("\n\n");
    })
    .join("\n\n---\n\n");
  copyText(
    "DBMux — User guide\n" +
      new URL("/guide.html", location.href).href +
      "\n\n" +
      text,
    event.currentTarget,
    notify,
  );
};
document.getElementById("printGuide").onclick = () => window.print();
let closedDetails = [];
window.addEventListener("beforeprint", () => {
  closedDetails = [...document.querySelectorAll("details:not([open])")];
  closedDetails.forEach((details) => {
    details.open = true;
  });
});
window.addEventListener("afterprint", () => {
  closedDetails.forEach((details) => {
    details.open = false;
  });
  closedDetails = [];
});
