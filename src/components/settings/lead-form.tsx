"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, FormField } from "@/components/common/page";
import { errorMessage, useLeadForm, useSaveLeadForm } from "@/lib/client/hooks";

const FIRST_ADMIN = "__first_admin__";

/** Plain HTML + a few lines of script the website owner pastes into any page. Styling is left to the site. */
const snippet = (endpoint: string, siteKey: string | null) => `${siteKey ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
` : ""}<form id="ivy-lead-form">
  <input name="name" placeholder="Your name" required maxlength="100">
  <input name="email" type="email" placeholder="Email">
  <input name="phone" placeholder="Phone / WhatsApp">
  <textarea name="message" placeholder="What are you looking for?" maxlength="2000"></textarea>
  <!-- Hidden trap for spam bots. Leave it empty and hidden. -->
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
${siteKey ? `  <div class="cf-turnstile" data-sitekey="${siteKey}"></div>
` : ""}  <button type="submit">Send</button>
  <p id="ivy-lead-status" role="status"></p>
</form>
<script>
document.getElementById("ivy-lead-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  var f = e.target, s = document.getElementById("ivy-lead-status");
  var body = Object.fromEntries(new FormData(f));
${siteKey ? `  body.captchaToken = body["cf-turnstile-response"];
  delete body["cf-turnstile-response"];
` : ""}  s.textContent = "Sending...";
  try {
    var r = await fetch("${endpoint}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    var j = await r.json();
    if (r.ok) { f.reset(); ${siteKey ? "if (window.turnstile) turnstile.reset(); " : ""}s.textContent = "Thank you! We will be in touch soon."; }
    else s.textContent = j.error || "Something went wrong. Please try again.";
  } catch (err) { s.textContent = "Could not send. Please try again."; }
});
</script>`;

/** Admin: who website enquiries go to, and the code to put the enquiry form on the website. */
export function LeadFormCard() {
  const { data, isLoading, error, refetch } = useLeadForm();
  const save = useSaveLeadForm();
  const user = useCurrentUser();
  const endpoint = typeof window === "undefined" ? "" : `${window.location.origin}/api/public/lead/${user.tenantId}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Website enquiry form</CardTitle>
        <CardDescription>
          Visitors fill in a form on your website and appear here as a new lead with the source &quot;Website&quot;. The owner gets a task to reply and an email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : error || !data ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : (
          <>
            <FormField label="Who gets new website leads" hint={data.effectiveOwner ? `Currently: ${data.effectiveOwner.name}` : "No active admin found"}>
              <Select
                value={data.ownerId ?? FIRST_ADMIN}
                onValueChange={(v) =>
                  save.mutate(v === FIRST_ADMIN ? null : v, { onSuccess: () => toast.success("Saved"), onError: (e) => toast.error(errorMessage(e)) })
                }
              >
                <SelectTrigger className="max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FIRST_ADMIN}>The first admin (default)</SelectItem>
                  {data.users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <div className="space-y-2 text-sm">
              <p className="font-medium">Websites allowed to send enquiries</p>
              {data.allowedOrigins.length === 0 ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                  None yet, so browsers on other websites are blocked. Add your website address (for example <code>https://www.ivycandyhair.com</code>) under Settings → Integrations.
                </p>
              ) : (
                <ul className="list-inside list-disc text-muted-foreground">
                  {data.allowedOrigins.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Code for your website</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(snippet(endpoint, data.captchaSiteKey)).then(() => toast.success("Copied"), () => toast.error("Could not copy"))}
                >
                  <Copy /> Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Paste this where the form should appear. It is plain HTML, so your site&apos;s own styling applies. The address inside points at this CRM, so use it from the live address rather than localhost.</p>
              <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-3 text-xs">{snippet(endpoint, data.captchaSiteKey)}</pre>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
