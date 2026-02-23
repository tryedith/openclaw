"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Server,
  BarChart3,
  Cloud,
  ScrollText,
  ArrowLeft,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users, exact: false },
  { href: "/admin/instances", label: "Instances", icon: Server, exact: false },
  { href: "/admin/usage", label: "Usage", icon: BarChart3, exact: false },
  { href: "/admin/infra", label: "Infrastructure", icon: Cloud, exact: false },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText, exact: false },
] as const;

export function AdminSidebarNav() {
  const pathname = usePathname();

  const baseClasses =
    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors";
  const activeClasses = "bg-primary-light text-primary";
  const inactiveClasses = "text-foreground-muted hover:text-foreground hover:bg-background";

  function isActive(href: string, exact: boolean) {
    if (exact) {return pathname === href;}
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <nav className="flex-1 p-4 overflow-y-auto">
      <div className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${baseClasses} ${active ? activeClasses : inactiveClasses}`}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Back to dashboard */}
      <div className="mt-8 pt-6 border-t border-border">
        <Link
          href="/dashboard"
          className={`${baseClasses} ${inactiveClasses}`}
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Dashboard
        </Link>
      </div>
    </nav>
  );
}
