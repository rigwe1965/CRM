/**
 * The record of when and how a customer agreed to WhatsApp messages, kept next to the tick so a business can show it if
 * asked. Ticking it records the moment and who ticked; unticking clears both. Anything else leaves the record alone.
 */
export function optInColumns(next: boolean | undefined, previous: boolean | undefined, source = "Ticked by staff", now = new Date()) {
  if (next === true && previous !== true) return { whatsappOptInAt: now, whatsappOptInSource: source };
  if (next === false && previous !== false) return { whatsappOptInAt: null, whatsappOptInSource: null };
  return {};
}
