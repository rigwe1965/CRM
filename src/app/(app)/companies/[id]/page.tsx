"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Building2, CircleDollarSign, Globe, MapPin, Pencil, Phone, Plus, Trash2, Users, Users2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityItem, DealMiniRow } from "@/components/common/items";
import { ConfirmDialog, EmptyState, ErrorState } from "@/components/common/page";
import { ContactDialog, OrganizationDialog } from "@/components/forms/contact-org-dialogs";
import { ActivityDialog, DealDialog } from "@/components/forms/deal-task-activity-dialogs";
import { contactTypeInfo } from "@/lib/client/constants";
import { fullName, initials, shortDate } from "@/lib/client/format";
import { ApiClientError } from "@/lib/client/api";
import { errorMessage, useItem, useList, useRemove } from "@/lib/client/hooks";
import type { Activity, Contact, Deal, Organization } from "@/lib/client/types";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: org, isLoading, error, refetch } = useItem<Organization>("organizations", id);
  const contacts = useList<Contact>("contacts", { organizationId: id, pageSize: 50, sort: "name", order: "asc" });
  const deals = useList<Deal>("deals", { organizationId: id, pageSize: 50, sort: "updatedAt" });
  const activities = useList<Activity>("activities", { organizationId: id, pageSize: 10 });
  const remove = useRemove("organizations");

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [contactDialog, setContactDialog] = useState(false);
  const [dealDialog, setDealDialog] = useState<{ open: boolean; deal?: Deal }>({ open: false });
  const [activityDialog, setActivityDialog] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error || !org) {
    const notFound = error instanceof ApiClientError && error.status === 404;
    return (
      <Card>
        {notFound ? (
          <EmptyState icon={Building2} title="Company not found" description="It may have been deleted, or it belongs to someone else." action={<Button asChild variant="outline"><Link href="/companies">Back to companies</Link></Button>} />
        ) : (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        )}
      </Card>
    );
  }

  const location = [org.city, org.state, org.country].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/companies">
          <ArrowLeft /> Companies
        </Link>
      </Button>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14 rounded-lg">
              <AvatarFallback className="rounded-lg text-lg">{initials(org.name)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-xl font-semibold">{org.name}</h1>
              <p className="text-sm text-muted-foreground">{[org.industry, org.size ? `${org.size.toLocaleString()} employees` : null].filter(Boolean).join(" · ") || "No details yet"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
              {org.website ? (
                <a href={org.website} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
                  {org.domain ?? org.website}
                </a>
              ) : (
                <span className="text-muted-foreground">{org.domain ?? "No website"}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
              {org.phone ? <a href={`tel:${org.phone}`} className="hover:underline">{org.phone}</a> : <span className="text-muted-foreground">No phone</span>}
            </div>
            <div className="flex items-center gap-3">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className={location || org.address ? "" : "text-muted-foreground"}>{[org.address, location].filter(Boolean).join(", ") || "No address"}</span>
            </div>
            <dl className="grid grid-cols-2 gap-3 border-t pt-3">
              <div>
                <dt className="text-xs text-muted-foreground">Owner</dt>
                <dd>{org.owner?.name ?? "Unassigned"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Created</dt>
                <dd>{shortDate(org.createdAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Contacts ({org._count.contacts})</CardTitle>
              <Button size="sm" onClick={() => setContactDialog(true)}>
                <Plus /> Add contact
              </Button>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {contacts.isLoading ? (
                <Skeleton className="mx-5 h-20" />
              ) : contacts.data?.data.length ? (
                <div className="divide-y">
                  {contacts.data.data.map((c) => (
                    <Link key={c.id} href={`/contacts/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>{initials(fullName(c))}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{fullName(c)}</p>
                          <p className="text-xs text-muted-foreground">{c.title ?? c.email ?? "—"}</p>
                        </div>
                      </div>
                      <Badge variant={contactTypeInfo(c.type).tone}>{contactTypeInfo(c.type).label}</Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Users} title="No contacts" description="Add the people you work with at this company." className="py-8" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Deals ({org._count.deals})</CardTitle>
              <Button size="sm" onClick={() => setDealDialog({ open: true })}>
                <Plus /> New deal
              </Button>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {deals.isLoading ? (
                <Skeleton className="mx-5 h-20" />
              ) : deals.data?.data.length ? (
                <div className="divide-y">
                  {deals.data.data.map((d) => (
                    <DealMiniRow key={d.id} deal={d} onClick={() => setDealDialog({ open: true, deal: d })} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={CircleDollarSign} title="No deals" description="Track an opportunity with this company." className="py-8" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Recent activity</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setActivityDialog(true)}>
                <Plus /> Log activity
              </Button>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {activities.isLoading ? (
                <Skeleton className="mx-5 h-20" />
              ) : activities.data?.data.length ? (
                <div className="divide-y">
                  {activities.data.data.map((a) => (
                    <ActivityItem key={a.id} activity={a} showLinks={false} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={Users2} title="No activity yet" className="py-8" />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {editing && <OrganizationDialog open onOpenChange={(o) => !o && setEditing(false)} organization={org} />}
      {contactDialog && <ContactDialog open onOpenChange={(o) => !o && setContactDialog(false)} defaults={{ organizationId: org.id }} />}
      {dealDialog.open && <DealDialog open onOpenChange={(o) => !o && setDealDialog({ open: false })} deal={dealDialog.deal} defaults={{ organizationId: org.id }} />}
      {activityDialog && <ActivityDialog open onOpenChange={(o) => !o && setActivityDialog(false)} defaults={{ organizationId: org.id }} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete company?"
        description={`${org.name} will be removed. Its contacts and deals stay. An admin can restore it later.`}
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(org.id, {
            onSuccess: () => {
              toast.success("Company deleted");
              router.push("/companies");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}
