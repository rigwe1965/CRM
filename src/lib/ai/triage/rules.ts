/**
 * Opt-out words in a customer's message, found by a rule and not by the model (AI_ASSISTANT_PLAN.md, Phase 3c). A message
 * is a stranger's text, and consent is the one thing a stranger's text must not be able to talk the model out of: a clear
 * "stop" always puts a card in front of the owner, whatever else happens. The card only proposes; a person approves it.
 */

// The whole message is just the word ("STOP", "Unsubscribe.").
const BARE = /^[\s"'*]*(stop|unsubscribe|optout|opt out|opt-out|cancel|end|quit)[\s.!"'*]*$/i;
// A short request in a sentence ("please stop messaging me", "remove me from this list").
const SENTENCE = /\b(stop (?:messag|text|send|contact|whatsapp|email|calling|writing|bother)|unsubscribe|opt[ -]?out|remove (?:me|my number)|take me off|do not (?:message|contact|text|whatsapp|send)|don'?t (?:message|contact|text|whatsapp|send)|leave me alone|no more messages)/i;

/** True when the text clearly asks us to stop messaging. Long messages are not scanned: a stop word in a paragraph is rarely one. */
export function asksToStop(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 300) return false;
  return BARE.test(t) || SENTENCE.test(t);
}
