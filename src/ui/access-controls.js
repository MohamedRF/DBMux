export const permissionDefinitions = [
  ["read", "Read queries", "Inspect schemas and read permitted data."],
  ["insert", "Insert rows", "Add records within the allowed schemas."],
  ["update", "Update rows", "Modify records; WHERE safeguards still apply."],
  ["delete", "Delete rows", "Subject to SQL policy and confirmation."],
  ["create", "Create objects", "Create permitted database objects."],
  ["alter", "Alter objects", "Change permitted database definitions."],
  ["drop", "Drop objects", "High-risk changes require confirmation."],
  ["truncate", "Truncate tables", "High-risk changes require confirmation."],
  [
    "executeRoutine",
    "Execute routines",
    "Blocked by the SQL policy; any existing flag is preserved.",
  ],
];
export function presetPermissions(level) {
  return Object.fromEntries(
    permissionDefinitions.map(([key]) => [
      key,
      key === "read" ||
        (key !== "executeRoutine" &&
          (key === "drop" || key === "truncate"
            ? level === "full-development"
            : level !== "read-only")),
    ]),
  );
}
export function permissionLevel(grants) {
  return (
    ["read-only", "development-write", "full-development"].find((level) =>
      permissionDefinitions.every(
        ([key]) => presetPermissions(level)[key] === grants[key],
      ),
    ) ?? "custom"
  );
}
export function effectivePermissions(grants, connection, available = true) {
  return Object.fromEntries(
    permissionDefinitions.map(([key]) => [
      key,
      Boolean(
        available &&
        connection?.enabled &&
        key !== "executeRoutine" &&
        grants[key] &&
        connection.permissions[key],
      ),
    ]),
  );
}
export function permissionEditor(form, container, changed = () => {}) {
  const inputs = new Map();
  for (const [key, title, description] of permissionDefinitions) {
    const label = document.createElement("label");
    label.className = "permission-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "permission." + key;
    input.disabled = key === "executeRoutine";
    const text = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = title;
    const detail = document.createElement("small");
    detail.textContent = description;
    text.append(strong, detail);
    label.append(input, text);
    container.append(label);
    inputs.set(key, input);
    input.onchange = () => {
      form.elements.access.value = "custom";
      changed();
    };
  }
  const set = (grants) => {
    for (const [key, input] of inputs) input.checked = grants[key];
    form.elements.access.value = permissionLevel(grants);
    changed();
  };
  form.elements.access.onchange = () => {
    if (form.elements.access.value !== "custom")
      set(presetPermissions(form.elements.access.value));
    else changed();
  };
  const initial = presetPermissions("read-only");
  for (const [key, input] of inputs) input.checked = initial[key];
  return {
    set,
    values: () =>
      Object.fromEntries(
        [...inputs].map(([key, input]) => [key, input.checked]),
      ),
  };
}
export function accessDescription(access) {
  if (access.unavailable) return access.unavailable;
  const permitted = permissionDefinitions
    .filter(([key]) => access.permissions[key])
    .map(([, title]) => title);
  return permitted.length ? permitted.join(", ") : "No operations granted";
}
