/** Click-to-chat link for an E.164 number (`+4915906462275`). `text` is prefilled but not sent. */
export function whatsappUrl(phoneE164: string, text?: string) {
  const url = new URL(`https://wa.me/${phoneE164.replace(/\D/g, "")}`);
  if (text) url.searchParams.set("text", text);
  return url.toString();
}
