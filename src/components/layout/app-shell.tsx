"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity as ActivityIcon,
  Building2,
  Package,
  Receipt,
  CheckSquare,
  ChevronsUpDown,
  CircleDollarSign,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useCurrentUser } from "@/components/providers";
import { ThemeToggle } from "@/components/theme-toggle";
import { initials } from "@/lib/client/format";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/deals", label: "Deals", icon: CircleDollarSign },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/stock", label: "Stock", icon: Package },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/activities", label: "Activities", icon: ActivityIcon },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

const Brand = () => (
  <Link href="/dashboard" className="flex h-14 items-center gap-2 px-6 font-semibold">
    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">C</span>
    CRM
  </Link>
);

function UserMenu() {
  const user = useCurrentUser();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2">
          <Avatar className="h-7 w-7">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden text-left sm:block">
            <span className="block text-sm leading-none">{user.name}</span>
            <span className="block text-[11px] font-normal capitalize text-muted-foreground">{user.role.toLowerCase()}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate">{user.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/sign-in" })}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const currentUser = useCurrentUser();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // The Kanban board uses the full window width; other pages stay in a readable column.
  const wide = pathname.startsWith("/deals");
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r bg-background print:hidden lg:block">
        <Brand />
        <NavLinks />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="px-0 pt-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <Brand />
          <NavLinks onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-60 print:pl-0">
        <header className="sticky top-0 z-20 flex h-14 print:hidden items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        {currentUser.mfaPending && (
          <div role="status" className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100 sm:px-6 print:hidden">
            Admin access is on hold until you turn on two-step verification.{" "}
            <Link href="/settings" className="font-medium underline">Set it up in Settings → Security</Link>, then reload.
          </div>
        )}
        <main className={cn("w-full p-4 sm:p-6 print:p-0", !wide && "mx-auto max-w-7xl print:max-w-none")}>{children}</main>
      </div>
    </div>
  );
}
