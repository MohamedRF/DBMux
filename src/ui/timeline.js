export function hasRequestTimeline(requestId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    requestId,
  );
}
export function createTimeline({ root, api, button, report }) {
  let generation = 0;
  let requestId = "";
  let offset = 0;
  let auditOffset = 0;
  const clear = () => {
    generation++;
    requestId = "";
    root.hidden = true;
    root.replaceChildren();
  };
  async function load() {
    const current = ++generation;
    root.hidden = false;
    root.setAttribute("aria-busy", "true");
    root.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Request timeline";
    heading.tabIndex = -1;
    root.append(heading);
    const label = document.createElement("p");
    label.textContent = requestId;
    label.className = "request-id";
    root.append(label);
    root.append(button("Close timeline", clear));
    try {
      const data = await api(
        `/activity/requests/${encodeURIComponent(requestId)}?offset=${offset}&auditOffset=${auditOffset}`,
      );
      if (current !== generation) return;
      const summary = document.createElement("p");
      summary.textContent = `${data.total} request / tool events · ${data.auditTotal} SQL audit events. SQL audits preserve transaction and failure status.`;
      root.append(summary);
      const events = document.createElement("ol");
      events.className = "request-events";
      const shown = new Set();
      function auditCard(audit) {
        const card = document.createElement("div");
        card.className = "audit-event";
        const title = document.createElement("p");
        title.textContent = `SQL audit #${audit.id} · ${audit.tool} · ${audit.connection_id} · ${audit.status} · ${new Date(audit.timestamp).toLocaleString()}`;
        card.append(
          title,
          button("View SQL audit", async () => {
            const details = await api("/audit/" + audit.id);
            if (current !== generation) return;
            let content = card.querySelector("pre");
            if (!content) {
              content = document.createElement("pre");
              card.append(content);
            }
            content.textContent = JSON.stringify(details, null, 2);
          }),
        );
        return card;
      }
      for (const event of data.rows) {
        const item = document.createElement("li");
        item.dataset.status = event.status;
        const title = document.createElement("strong");
        title.textContent = event.operation;
        const context = document.createElement("p");
        context.textContent = `${event.kind} · ${event.actor_name} (${event.actor_id}) · ${event.source} · ${event.connection_id ?? "Gateway"}`;
        const outcome = document.createElement("small");
        outcome.textContent = `${new Date(event.timestamp).toLocaleString()} · ${event.status} · ${event.duration_ms} ms${event.http_status ? " · HTTP " + event.http_status : ""}${event.error_code ? " · " + event.error_code : ""}`;
        item.append(title, context, outcome);
        for (const audit of data.audits.filter(
          (audit) => audit.activity_id === event.id,
        )) {
          item.append(auditCard(audit));
          shown.add(audit.id);
        }
        events.append(item);
      }
      root.append(events);
      for (const audit of data.audits.filter((audit) => !shown.has(audit.id)))
        root.append(auditCard(audit));
      const pages = document.createElement("div");
      pages.className = "form-actions";
      const previous = button("Previous events", () => {
        offset = Math.max(0, offset - data.limit);
        return load();
      });
      previous.disabled = offset === 0;
      const next = button("Next events", () => {
        offset += data.limit;
        return load();
      });
      next.disabled = offset + data.rows.length >= data.total;
      const previousAudits = button("Previous SQL audits", () => {
        auditOffset = Math.max(0, auditOffset - data.limit);
        return load();
      });
      previousAudits.disabled = auditOffset === 0;
      const nextAudits = button("Next SQL audits", () => {
        auditOffset += data.limit;
        return load();
      });
      nextAudits.disabled = auditOffset + data.audits.length >= data.auditTotal;
      pages.append(previous, next, previousAudits, nextAudits);
      root.append(pages);
      heading.focus({ preventScroll: true });
      root.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (current === generation) {
        const message = document.createElement("p");
        message.textContent =
          "Timeline could not be loaded. Reopen the request to retry.";
        root.append(message);
        report(error);
      }
    } finally {
      if (current === generation) root.removeAttribute("aria-busy");
    }
  }
  return {
    clear,
    open: async (id) => {
      requestId = id;
      offset = 0;
      auditOffset = 0;
      await load();
    },
  };
}
