export function logPersonalCall({
  contactId,
  phone,
  name,
}: {
  contactId?: string;
  phone: string;
  name?: string;
}): void {
  fetch("/api/calls/log-personal", {
    method: "POST",
    keepalive: true,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId, phone, name }),
  }).catch(() => {});
}
