"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, History, Inbox, Loader2, Paperclip, Plus, Receipt, Sparkles, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/common/page";
import { ModelPicker } from "@/components/assistant/model-picker";
import { ProposalCards, ProposalList, type ProposalCard } from "@/components/assistant/proposal-cards";
import { useCurrentUser } from "@/components/providers";
import { ApiClientError, request } from "@/lib/client/api";
import { chooseOrderCustomer, choosePaymentDeal, pickHeading, readOrderDocument, readPaymentDocument, type OrderReading } from "@/lib/client/document-upload";
import { errorMessage } from "@/lib/client/hooks";
import { parseBlocks, streamChat, type Inline, type IvyChat, type IvyChatSummary, type IvyEvent, type IvyMessage, type IvyStatus } from "@/lib/client/ivy";
import { cn } from "@/lib/utils";

const STARTERS = ["Who owes me money, and how late are they?", "Which stock is running low?", "What is on my task list this week?", "How have sales gone over the last 6 months?"];

type Activity = { id: string; label: string; status: "start" | "done" | "error" };
type Bubble = IvyMessage & { activity?: Activity[] };
type Problem = { code: string; message: string };
type InboxData = { available: "ok" | "disabled" | "muted" | "read_only"; ranToday: boolean; running: boolean; pending: number; items: ProposalCard[] };

/** The reasons AI cannot be used yet, in words, and whether an admin can fix them from Settings. */
function notReady(reason: NonNullable<IvyStatus["reason"]>, resetsOn: string | null, isAdmin: boolean) {
  const who = isAdmin ? "You can fix this in Settings → AI assistant." : "Ask an admin to fix this in Settings → AI assistant.";
  switch (reason) {
    case "AI_DISABLED": return `AI is switched off for your business. ${who}`;
    case "AI_NOT_CONFIGURED": return `AI needs an Anthropic key before it can answer. ${who}`;
    case "AI_CEILING_UNSET": return `AI needs a monthly spending limit before it can answer. ${who}`;
    case "AI_CEILING_REACHED": return `This month's spending limit for AI has been reached. AI resumes on ${resetsOn ?? "the 1st"}, or sooner if the limit is raised. ${who}`;
  }
}

/** AI's reply as safe text: bold, lists and in-app links only (see parseBlocks). */
function IvyText({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const inline = (parts: Inline[]) =>
    parts.map((p, i) =>
      p.kind === "bold" ? (
        <strong key={i}>{p.text}</strong>
      ) : p.kind === "link" ? (
        <Link key={i} href={p.href} onClick={onNavigate} className="font-medium underline underline-offset-2">
          {p.text}
        </Link>
      ) : (
        <span key={i}>{p.text}</span>
      ),
    );
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {parseBlocks(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className="whitespace-pre-line">{inline(b.inline)}</p>
        ) : b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">{b.items.map((it, n) => <li key={n}>{inline(it)}</li>)}</ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5">{b.items.map((it, n) => <li key={n}>{inline(it)}</li>)}</ol>
        ),
      )}
    </div>
  );
}

/** The "Ask AI" button for the header and the chat panel it opens (also on Ctrl/⌘+K). */
export function AskIvy() {
  const user = useCurrentUser();
  const isAdmin = user.role === "ADMIN";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history" | "suggested">("chat");
  const [chat, setChat] = useState<{ id?: string; messages: Bubble[]; stale: boolean; full: boolean }>({ messages: [], stale: false, full: false });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [deleting, setDeleting] = useState<IvyChatSummary | null>(null);
  // An order AI read but could not match to one customer: the person picks, and the draft goes back with the choice.
  const [pick, setPick] = useState<(Pick<OrderReading, "conversationId" | "candidates" | "draft"> & { of: "customer" | "deal" }) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachKind = useRef<"order" | "payment">("order");
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const status = useQuery({
    queryKey: ["ivy-status"],
    queryFn: async () => (await request<{ data: IvyStatus }>("GET", "/api/assistant/status")).data,
    enabled: open,
    staleTime: 0,
  });
  const history = useQuery({
    queryKey: ["ivy-chats"],
    queryFn: async () => (await request<{ data: IvyChatSummary[] }>("GET", "/api/assistant/conversations")).data,
    enabled: open && view === "history",
  });
  // The daily "Suggested actions": cheap to read, and off (nothing shown) until an admin allows it.
  const inbox = useQuery({
    queryKey: ["ivy-inbox"],
    queryFn: async () => (await request<{ data: InboxData }>("GET", "/api/assistant/inbox")).data,
    staleTime: 30_000,
    refetchInterval: (q) => (q.state.data?.available === "disabled" ? false : q.state.data?.running ? 4_000 : 60_000),
  });
  // The first time someone uses the app each day, ask for today's suggestions (once per page load; the server makes them once a day).
  const asked = useRef(false);
  useEffect(() => {
    const d = inbox.data;
    if (!d || asked.current || d.available !== "ok" || d.ranToday || d.running) return;
    asked.current = true;
    void request("POST", "/api/assistant/inbox/refresh", {}).then(() => setTimeout(() => void qc.invalidateQueries({ queryKey: ["ivy-inbox"] }), 3_000), () => undefined);
  }, [inbox.data, qc]);
  const mute = useMutation({
    mutationFn: (muted: boolean) => request("PUT", "/api/assistant/inbox/mute", { muted }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ivy-inbox"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => request("DELETE", `/api/assistant/conversations/${id}`),
    onSuccess: (_, id) => {
      toast.success("Conversation deleted");
      setDeleting(null);
      if (chat.id === id) reset();
      return qc.invalidateQueries({ queryKey: ["ivy-chats"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Ctrl/⌘+K opens AI from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the newest text in view as AI writes.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, problem, view]);

  const reset = useCallback(() => {
    abort.current?.abort();
    setChat({ messages: [], stale: false, full: false });
    setPick(null);
    setProblem(null);
    setStreaming(false);
    setView("chat");
  }, []);

  const patchLast = (fn: (b: Bubble) => Bubble) =>
    setChat((c) => ({ ...c, messages: c.messages.length ? [...c.messages.slice(0, -1), fn(c.messages[c.messages.length - 1])] : c.messages }));

  const onEvent = (e: IvyEvent) => {
    if (e.type === "conversation") setChat((c) => ({ ...c, id: e.id }));
    else if (e.type === "text") patchLast((b) => ({ ...b, text: b.text + e.delta }));
    else if (e.type === "tool") {
      patchLast((b) => {
        const list = b.activity ?? [];
        const known = list.some((a) => a.id === e.id);
        return { ...b, activity: known ? list.map((a) => (a.id === e.id ? { ...a, status: e.status } : a)) : [...list, { id: e.id, label: e.label, status: e.status }] };
      });
    } else if (e.type === "error") setProblem({ code: e.code, message: e.message });
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setProblem(null);
    setPick(null);
    setInput("");
    setStreaming(true);
    setChat((c) => ({ ...c, messages: [...c.messages, { role: "user", text: message, tools: [] }, { role: "assistant", text: "", tools: [], activity: [] }] }));
    const controller = new AbortController();
    abort.current = controller;
    try {
      await streamChat({ conversationId: chat.id, message }, onEvent, controller.signal);
    } catch (e) {
      setProblem({ code: e instanceof ApiClientError ? e.code : "ERROR", message: errorMessage(e) });
      if (e instanceof ApiClientError && (e.code === "AI_CONVERSATION_STALE" || e.code === "AI_CONVERSATION_FULL")) {
        setChat((c) => ({ ...c, stale: e.code === "AI_CONVERSATION_STALE", full: e.code === "AI_CONVERSATION_FULL" }));
      }
    } finally {
      setStreaming(false);
      abort.current = null;
      // An answer that never started leaves an empty bubble; remove it.
      setChat((c) => {
        const last = c.messages[c.messages.length - 1];
        return last && last.role === "assistant" && !last.text && !(last.activity?.length) ? { ...c, messages: c.messages.slice(0, -1) } : c;
      });
      void qc.invalidateQueries({ queryKey: ["ivy-chats"] });
      void qc.invalidateQueries({ queryKey: ["ivy-status"] });
      void qc.invalidateQueries({ queryKey: ["ivy-proposals"] });
    }
  };

  const showOrder = (r: OrderReading) => {
    setChat((c) => ({ ...c, id: r.conversationId }));
    patchLast((b) => ({ ...b, text: r.message }));
    setPick(r.outcome === "pick_customer" || r.outcome === "pick_deal" ? { of: r.outcome === "pick_deal" ? "deal" : "customer", conversationId: r.conversationId, candidates: r.candidates, draft: r.draft } : null);
  };
  const afterOrder = () => {
    setStreaming(false);
    void qc.invalidateQueries({ queryKey: ["ivy-chats"] });
    void qc.invalidateQueries({ queryKey: ["ivy-status"] });
    void qc.invalidateQueries({ queryKey: ["ivy-proposals"] });
  };

  /** A screenshot of a customer's order or a payment receipt: AI reads it and, if it can, puts a card in this chat for the person to approve. */
  const attach = async (file: File, what: "order" | "payment") => {
    if (streaming) return;
    setProblem(null);
    setPick(null);
    setStreaming(true);
    setChat((c) => ({ ...c, messages: [...c.messages, { role: "user", text: `Attached a picture: ${file.name.slice(0, 60)}`, tools: [] }, { role: "assistant", text: "", tools: [], activity: [{ id: "read", label: "Reading the picture", status: "start" }] }] }));
    try {
      showOrder(await (what === "payment" ? readPaymentDocument : readOrderDocument)(file, chat.id));
      patchLast((b) => ({ ...b, activity: [{ id: "read", label: "Read the picture", status: "done" }] }));
    } catch (e) {
      setProblem({ code: e instanceof ApiClientError ? e.code : "ERROR", message: errorMessage(e) });
      setChat((c) => ({ ...c, messages: c.messages.slice(0, -2) }));
    } finally {
      afterOrder();
    }
  };
  const choose = async (id: string) => {
    if (!pick || streaming) return;
    const { conversationId, draft, of } = pick;
    setStreaming(true);
    setProblem(null);
    try {
      const r = await (of === "deal" ? choosePaymentDeal({ conversationId, dealId: id, draft }) : chooseOrderCustomer({ conversationId, contactId: id, draft }));
      setPick(null);
      setChat((c) => ({ ...c, messages: [...c.messages, { role: "assistant", text: r.message, tools: [] }] }));
    } catch (e) {
      setProblem({ code: e instanceof ApiClientError ? e.code : "ERROR", message: errorMessage(e) });
    } finally {
      afterOrder();
    }
  };

  const openChat = async (id: string) => {
    try {
      const { data } = await request<{ data: IvyChat }>("GET", `/api/assistant/conversations/${id}`);
      setChat({ id: data.id, messages: data.messages.map((m) => ({ ...m, activity: m.tools.map((t, i) => ({ id: `${i}`, label: t, status: "done" as const })) })), stale: data.stale, full: data.full });
      setProblem(null);
      setPick(null);
      setView("chat");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const ready = status.data?.ready ?? false;
  const blocked = status.data && !status.data.ready && status.data.reason ? notReady(status.data.reason, status.data.resetsOn, isAdmin) : null;
  const locked = chat.stale || chat.full;
  const closePanel = () => setOpen(false);

  return (
    <>
      <Button ref={trigger} variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)} aria-label="Ask AI">
        <Sparkles className="size-4" />
        <span className="hidden sm:inline">Ask AI</span>
        {(inbox.data?.pending ?? 0) > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground" aria-label={`${inbox.data?.pending} suggestions waiting`}>{inbox.data?.pending}</span>}
        <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] font-normal text-muted-foreground lg:inline">Ctrl K</kbd>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full max-w-full gap-0 px-0 pt-0 sm:w-[28rem]" onCloseAutoFocus={(e) => (e.preventDefault(), trigger.current?.focus())}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <SheetTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4" /> AI assistant</SheetTitle>
              <SheetDescription className="text-xs">Ask about your contacts, deals, payments and stock.</SheetDescription>
            </div>
            <div className="mr-8 flex gap-1">
              {inbox.data && inbox.data.available !== "disabled" && (
                <Button variant="ghost" size="icon" className="relative" aria-label="Suggested actions" onClick={() => setView(view === "suggested" ? "chat" : "suggested")}>
                  <Inbox className="size-4" />
                  {inbox.data.pending > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[9px] text-primary-foreground">{inbox.data.pending}</span>}
                </Button>
              )}
              <Button variant="ghost" size="icon" aria-label="Past conversations" onClick={() => setView(view === "history" ? "chat" : "history")}><History className="size-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="New chat" onClick={reset}><Plus className="size-4" /></Button>
            </div>
          </div>
          <ModelPicker active={open && ready} />

          {view === "suggested" ? (
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {inbox.data?.available === "muted" ? (
                <div className="space-y-2 rounded-md border bg-muted/50 p-3 text-sm">
                  <p>You have turned off the daily suggestions.</p>
                  <Button size="sm" disabled={mute.isPending} onClick={() => mute.mutate(false)}>Turn them back on</Button>
                </div>
              ) : inbox.data?.available === "read_only" ? (
                <p className="rounded-md border bg-muted/50 p-3 text-sm">This workspace is read-only, so there are no new suggestions.</p>
              ) : (
                <>
                  {inbox.data?.running && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Preparing today&apos;s suggestions…</p>}
                  <ProposalList
                    heading="Suggested for you"
                    queryKey={["ivy-inbox"]}
                    items={inbox.data?.items ?? []}
                    onNavigate={closePanel}
                    empty={inbox.data?.running ? undefined : "Nothing needs your attention right now. AI looks again each day."}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    AI suggests these from your own records; nothing happens until you approve it.{" "}
                    <button type="button" className="underline" disabled={mute.isPending} onClick={() => mute.mutate(true)}>Turn off daily suggestions</button>
                  </p>
                </>
              )}
            </div>
          ) : view === "history" ? (
            <div className="flex-1 overflow-y-auto p-3">
              {history.isLoading ? <p className="p-2 text-sm text-muted-foreground">Loading…</p> : !history.data?.length ? <p className="p-2 text-sm text-muted-foreground">No conversations yet.</p> : (
                <ul className="space-y-1">
                  {history.data.map((c) => (
                    <li key={c.id} className="flex items-center gap-1">
                      <button type="button" className="min-w-0 flex-1 rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => void openChat(c.id)}>
                        <span className="block truncate">{c.title}</span>
                        <span className="block text-xs text-muted-foreground">{new Date(c.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                      </button>
                      <Button variant="ghost" size="icon" aria-label={`Delete conversation: ${c.title}`} onClick={() => setDeleting(c)}><Trash2 className="size-4" /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div ref={log} role="log" aria-live="polite" aria-label="Conversation with AI" className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                {chat.messages.length === 0 && (
                  <div className="space-y-3">
                    {blocked ? (
                      <p className="rounded-md border bg-muted/50 p-3 text-sm">{blocked}{isAdmin && <> <Link href="/settings" onClick={closePanel} className="font-medium underline">Open Settings</Link></>}</p>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">Hello{user.name ? `, ${user.name.split(" ")[0]}` : ""}. Ask me anything about your records. I can look things up and suggest actions, but nothing changes until you approve it, and I never message customers.</p>
                        <div className="flex flex-col gap-2">
                          {STARTERS.map((s) => (
                            <button key={s} type="button" disabled={!ready} onClick={() => void send(s)} className="rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">{s}</button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {chat.messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="ml-8 whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{m.text}</div>
                  ) : (
                    <div key={i} className="mr-4 space-y-2">
                      {!!m.activity?.length && (
                        <ul className="flex flex-wrap gap-1.5" aria-label="What AI looked at">
                          {m.activity.map((a) => (
                            <li key={a.id} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground", a.status === "error" && "border-destructive/50 text-destructive")}>
                              {a.status === "start" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                              {a.label}
                            </li>
                          ))}
                        </ul>
                      )}
                      {m.text ? <IvyText text={m.text} onNavigate={closePanel} /> : streaming && i === chat.messages.length - 1 && !m.activity?.length ? <p className="text-sm text-muted-foreground">Thinking…</p> : null}
                    </div>
                  ),
                )}
                {pick && (
                  <div className="space-y-2 rounded-md border p-3" role="group" aria-label={pickHeading(pick.of)}>
                    <p className="text-sm font-medium">{pickHeading(pick.of)}</p>
                    <div className="flex flex-wrap gap-2">
                      {pick.candidates.map((c) => (
                        <Button key={c.id} type="button" size="sm" variant="outline" disabled={streaming} onClick={() => void choose(c.id)}>{c.label}</Button>
                      ))}
                      <Button type="button" size="sm" variant="ghost" disabled={streaming} onClick={() => setPick(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
                <ProposalCards conversationId={chat.id} onNavigate={closePanel} />
                {problem && (
                  <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                    {problem.message}
                    {isAdmin && /^AI_(DISABLED|NOT_CONFIGURED|CEILING_UNSET|CEILING_REACHED|KEY_REJECTED|NO_CREDIT)$/.test(problem.code) && (
                      <> <Link href="/settings" onClick={closePanel} className="font-medium underline">Open Settings</Link></>
                    )}
                  </div>
                )}
                {locked && <p className="rounded-md border bg-muted/50 p-3 text-sm">{chat.stale ? "This chat was started with an older version of AI, so you can read it but not continue it." : "This chat has reached its length limit."} <button type="button" className="font-medium underline" onClick={reset}>Start a new chat</button></p>}
              </div>

              <form
                className="border-t p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
              >
                <div className="flex items-end gap-2">
                  {(status.data?.orders || status.data?.payments) && (
                    <>
                      <input
                        ref={fileInput}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) void attach(f, attachKind.current);
                        }}
                      />
                      {status.data?.orders && (
                        <Button type="button" size="icon" variant="outline" aria-label="Attach a customer's order screenshot" title="Attach a customer's order screenshot" disabled={!ready || locked || streaming} onClick={() => ((attachKind.current = "order"), fileInput.current?.click())}><Paperclip className="size-4" /></Button>
                      )}
                      {status.data?.payments && (
                        <Button type="button" size="icon" variant="outline" aria-label="Attach a bank transfer receipt" title="Attach a bank transfer receipt" disabled={!ready || locked || streaming} onClick={() => ((attachKind.current = "payment"), fileInput.current?.click())}><Receipt className="size-4" /></Button>
                      )}
                    </>
                  )}
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void send(input);
                      }
                    }}
                    rows={2}
                    maxLength={4000}
                    disabled={!ready || locked}
                    placeholder={ready ? "Ask AI…" : "AI is not available yet"}
                    aria-label="Your question for AI"
                    className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  />
                  {streaming ? (
                    <Button type="button" size="icon" variant="outline" aria-label="Stop" onClick={() => abort.current?.abort()}><Square className="size-4" /></Button>
                  ) : (
                    <Button type="submit" size="icon" aria-label="Send" disabled={!ready || locked || !input.trim()}><ArrowUp className="size-4" /></Button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">AI can make mistakes. Amounts come from your records.{status.data?.orders || status.data?.payments ? " A picture you attach is sent to Anthropic to be read and is not kept." : ""}</p>
              </form>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this conversation?"
        description="It is removed for good. AI keeps nothing from it."
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
