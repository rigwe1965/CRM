"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Building2, Mail, Pencil, Phone, Plus, Trash2, UserCheck, Activity as ActivityIcon, CheckSquare, CircleDollarSign, UserX } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityItem, DealMiniRow, TaskRow } from "@/components/common/items";
import { ConfirmDialog, EmptyState, ErrorState } from "@/components/common/page";
import { ContactDialog, EmailContactDialog } from "@/components/forms/contact-org-dialogs";
import { ActivityDialog, DealDialog, TaskDialog } from "@/components/forms/deal-task-activity-dialogs";
import { contactTypeInfo, leadStatusInfo } from "@/lib/client/constants";
import { fullName, initials, shortDate } from "@/lib/client/format";
import { ApiClientError } from "@/lib/client/api";
import { errorMessage, useConvertContact, useItem, useList, useRemove } from "@/lib/client/hooks";
import type { Activity, Contact, Deal, Task } from "@/lib/client/types";

function InfoRow({ icon: Icon, children }: { icon: typeof Mail; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: contact, isLoading, error, refetch } = useItem<Contact>("contacts", id);
  const activities = useList<Activity>("activities", { contactId: id, pageSize: 50 });
  const deals = useList<Deal>("deals", { contactId: id, pageSize: 50, sort: "updatedAt" });
  const tasks = useList<Task>("tasks", { contactId: id, pageSize: 50 });
  const convert = useConvertContact();
  const removeContact = useRemove("contacts");
  const removeActivity = useRemove("activities");
  const removeTask = useRemove("tasks");

  const [editing, setEditing] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activityDialog, setActivityDialog] = useState<{ open: boolean; activity?: Activity }>({ open: false });
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task?: Task }>({ open: false });
  const [dealDialog, setDealDialog] = useState<{ open: boolean; deal?: Deal }>({ open: false });

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error || !contact) {
    const notFound = error instanceof ApiClientError && error.status === 404;
    return (
      <Card>
        {notFound ? (
          <EmptyState icon={UserX} title="Contact not found" description="It may have been deleted, or it belongs to someone else." action={<Button asChild variant="outline"><Link href="/contacts">Back to contacts</Link></Button>} />
        ) : (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        )}
      </Card>
    );
  }

  const t = contactTypeInfo(contact.type);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/contacts">
          <ArrowLeft /> Contacts
        </Link>
      </Button>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="text-lg">{initials(fullName(contact))}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-xl font-semibold">{fullName(contact)}</h1>
              <p className="text-sm text-muted-foreground">
                {contact.title}
                {contact.title && contact.organization ? " at " : ""}
                {contact.organization && (
                  <Link href={`/companies/${contact.organization.id}`} className="hover:underline">
                    {contact.organization.name}
                  </Link>
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant={t.tone}>{t.label}</Badge>
                {contact.leadStatus && <Badge variant={leadStatusInfo(contact.leadStatus).tone}>{leadStatusInfo(contact.leadStatus).label}</Badge>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {contact.type !== "CUSTOMER" && (
              <Button
                variant="outline"
                disabled={convert.isPending}
                onClick={() =>
                  convert.mutate(contact.id, {
                    onSuccess: () => toast.success(`${fullName(contact)} is now a customer`),
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
              >
                <UserCheck /> {convert.isPending ? "Converting…" : "Convert to customer"}
              </Button>
            )}
            {contact.email && (
              <Button onClick={() => setEmailing(true)}>
                <Mail /> Send email
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleting(true)}>
              <Trash2 /> Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow icon={Mail}>{contact.email ? <a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a> : <span className="text-muted-foreground">No email</span>}</InfoRow>
            <InfoRow icon={Phone}>{contact.phone ? <a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a> : <span className="text-muted-foreground">No phone</span>}</InfoRow>
            <InfoRow icon={Building2}>{contact.organization?.name ?? <span className="text-muted-foreground">No company</span>}</InfoRow>
            <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Source</dt>
                <dd>{contact.source ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Owner</dt>
                <dd>{contact.owner?.name ?? "Unassigned"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Created</dt>
                <dd>{shortDate(contact.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Updated</dt>
                <dd>{shortDate(contact.updatedAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="activity">Activity ({contact._count.activities})</TabsTrigger>
              <TabsTrigger value="deals">Deals ({contact._count.deals})</TabsTrigger>
              <TabsTrigger value="tasks">Tasks ({contact._count.tasks})</TabsTrigger>
            </TabsList>

            <TabsContent value="activity">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Timeline</CardTitle>
                  <Button size="sm" onClick={() => setActivityDialog({ open: true })}>
                    <Plus /> Log activity
                  </Button>
                </CardHeader>
                <CardContent className="px-0 pb-2">
                  {activities.isLoading ? (
                    <Skeleton className="mx-5 h-24" />
                  ) : activities.data?.data.length ? (
                    <div className="divide-y">
                      {activities.data.data.map((a) => (
                        <ActivityItem key={a.id} activity={a} showLinks={false} onEdit={() => setActivityDialog({ open: true, activity: a })} onDelete={() => removeActivity.mutate(a.id, { onSuccess: () => toast.success("Activity deleted"), onError: (e) => toast.error(errorMessage(e)) })} />
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={ActivityIcon} title="No activity yet" description="Log a call, email or meeting with this contact." className="py-10" />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="deals">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Deals</CardTitle>
                  <Button size="sm" onClick={() => setDealDialog({ open: true })}>
                    <Plus /> New deal
                  </Button>
                </CardHeader>
                <CardContent className="px-0 pb-2">
                  {deals.isLoading ? (
                    <Skeleton className="mx-5 h-24" />
                  ) : deals.data?.data.length ? (
                    <div className="divide-y">
                      {deals.data.data.map((d) => (
                        <DealMiniRow key={d.id} deal={d} onClick={() => setDealDialog({ open: true, deal: d })} />
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={CircleDollarSign} title="No deals" description="Create a deal to track an opportunity with this contact." className="py-10" />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tasks">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Tasks</CardTitle>
                  <Button size="sm" onClick={() => setTaskDialog({ open: true })}>
                    <Plus /> New task
                  </Button>
                </CardHeader>
                <CardContent className="px-0 pb-2">
                  {tasks.isLoading ? (
                    <Skeleton className="mx-5 h-24" />
                  ) : tasks.data?.data.length ? (
                    <div className="divide-y">
                      {tasks.data.data.map((task) => (
                        <TaskRow key={task.id} task={task} onEdit={() => setTaskDialog({ open: true, task })} onDelete={() => removeTask.mutate(task.id, { onSuccess: () => toast.success("Task deleted"), onError: (e) => toast.error(errorMessage(e)) })} />
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={CheckSquare} title="No tasks" description="Add a follow-up so nothing slips." className="py-10" />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {editing && <ContactDialog open onOpenChange={(o) => !o && setEditing(false)} contact={contact} />}
      {emailing && contact.email && <EmailContactDialog open onOpenChange={(o) => !o && setEmailing(false)} contact={contact} />}
      {activityDialog.open && <ActivityDialog open onOpenChange={(o) => !o && setActivityDialog({ open: false })} activity={activityDialog.activity} defaults={{ contactId: contact.id }} />}
      {taskDialog.open && <TaskDialog open onOpenChange={(o) => !o && setTaskDialog({ open: false })} task={taskDialog.task} defaults={{ contactId: contact.id }} />}
      {dealDialog.open && <DealDialog open onOpenChange={(o) => !o && setDealDialog({ open: false })} deal={dealDialog.deal} defaults={{ contactId: contact.id, organizationId: contact.organizationId }} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete contact?"
        description={`${fullName(contact)} will be removed from your contacts. An admin can restore it later.`}
        pending={removeContact.isPending}
        onConfirm={() =>
          removeContact.mutate(contact.id, {
            onSuccess: () => {
              toast.success("Contact deleted");
              router.push("/contacts");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}
