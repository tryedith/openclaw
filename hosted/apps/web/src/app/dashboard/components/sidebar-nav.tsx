"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Grid2x2,
  MessageSquare,
  Radio,
  BarChart3,
  Bug,
  Settings,
  BookOpen,
  Github,
  ExternalLink,
  Bot,
} from "lucide-react";

interface Instance {
  id: string;
  name: string;
  status: "pending" | "provisioning" | "running" | "stopped" | "error";
}

const BOTTOM_NAV_ITEMS = [
  { href: "/dashboard/usage", label: "Usage (All)", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

const HELP_ITEMS = [
  { href: "https://docs.openclaw.ai", label: "Documentation", icon: BookOpen },
  { href: "https://github.com/openclaw/openclaw", label: "GitHub", icon: Github },
] as const;

const INSTANCE_SUB_ITEMS = [
  { suffix: "", label: "Chat", icon: MessageSquare },
  { suffix: "/channels", label: "Channels", icon: Radio },
  { suffix: "/usage", label: "Usage", icon: BarChart3 },
  { suffix: "/debug", label: "Debug", icon: Bug },
] as const;

const STATUS_DOT: Record<Instance["status"], string> = {
  running: "bg-success",
  provisioning: "bg-warning animate-pulse",
  pending: "bg-warning animate-pulse",
  stopped: "bg-foreground-subtle",
  error: "bg-error",
};

export function SidebarNav() {
  const pathname = usePathname();
  const [instances, setInstances] = useState<Instance[]>([]);

  useEffect(() => {
    fetch("/api/instances")
      .then((r) => r.json())
      .then((data) => setInstances(data.instances ?? []))
      .catch(() => {});
  }, []);

  const instanceMatch = pathname.match(/^\/dashboard\/instances\/([^/]+)/);
  const activeInstanceId = instanceMatch?.[1];

  function isInstanceSubActive(instanceId: string, suffix: string) {
    if (activeInstanceId !== instanceId) return false;
    const base = `/dashboard/instances/${instanceId}`;
    if (suffix === "") return pathname === base;
    return pathname.startsWith(`${base}${suffix}`);
  }

  const baseClasses =
    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors";
  const activeClasses = "bg-primary-light text-primary";
  const inactiveClasses = "text-foreground-muted hover:text-foreground hover:bg-background";

  const instancesActive = pathname === "/dashboard" || !!activeInstanceId;

  return (
    <nav className="flex-1 p-4 overflow-y-auto">
      <div className="space-y-1">
        {/* Instances header */}
        <Link
          href="/dashboard"
          className={`${baseClasses} ${instancesActive ? activeClasses : inactiveClasses}`}
        >
          <Grid2x2 className="w-5 h-5" />
          Instances
        </Link>

        {/* Individual instances */}
        {instances.length > 0 && (
          <div className="ml-5 space-y-0.5 border-l border-border pl-3">
            {instances.map((inst) => {
              const isActive = activeInstanceId === inst.id;
              return (
                <div key={inst.id}>
                  <Link
                    href={`/dashboard/instances/${inst.id}`}
                    className={`${baseClasses} py-2 text-[13px] ${
                      isActive ? activeClasses : inactiveClasses
                    }`}
                  >
                    <Bot className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{inst.name}</span>
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ml-auto ${STATUS_DOT[inst.status]}`}
                      title={inst.status}
                    />
                  </Link>

                  {/* Sub-links for the active instance */}
                  {isActive && (
                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-3">
                      {INSTANCE_SUB_ITEMS.map((sub) => {
                        const subActive = isInstanceSubActive(inst.id, sub.suffix);
                        const SubIcon = sub.icon;
                        return (
                          <Link
                            key={sub.suffix}
                            href={`/dashboard/instances/${inst.id}${sub.suffix}`}
                            className={`${baseClasses} py-1.5 text-[13px] ${
                              subActive ? activeClasses : inactiveClasses
                            }`}
                          >
                            <SubIcon className="w-3.5 h-3.5" />
                            {sub.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Other top-level nav */}
        {BOTTOM_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
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

      {/* Help section */}
      <div className="mt-8 pt-6 border-t border-border">
        <p className="px-3 text-xs font-medium text-foreground-subtle uppercase tracking-wider mb-3">
          Help
        </p>
        <div className="space-y-1">
          {HELP_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`${baseClasses} ${inactiveClasses}`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
                <ExternalLink className="w-3 h-3 ml-auto text-foreground-subtle" />
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
