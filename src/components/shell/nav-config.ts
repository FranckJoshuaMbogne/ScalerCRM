import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  Cog,
  FileText,
  Inbox,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Megaphone,
  Plug,
  ShoppingBag,
  Users,
  UserSquare2,
  Workflow,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Sprint in docs/SPRINTS.md where the module becomes functional. */
  sprint: number;
  summary: string;
  /** Shown in the mobile bottom bar (max 4). */
  mobile?: boolean;
  /** Has its own route folder; the placeholder route skips it. */
  built?: boolean;
};

export const workspaceNav: NavItem[] = [
  {
    href: "/dashboard",
    built: true,
    label: "Dashboard",
    icon: LayoutDashboard,
    sprint: 8,
    summary: "Leads, orders, revenue and team performance at a glance.",
    mobile: true,
  },
  {
    href: "/leads",
    label: "Leads",
    icon: ClipboardList,
    sprint: 2,
    summary:
      "Every enquiry from Meta, Google, WhatsApp, your website and walk-ins, in one pipeline.",
    mobile: true,
  },
  {
    href: "/customers",
    label: "Customers",
    icon: UserSquare2,
    sprint: 2,
    summary:
      "One customer file per person, with every lead, conversation and order attached.",
  },
  {
    href: "/inbox",
    label: "WhatsApp inbox",
    icon: Inbox,
    sprint: 5,
    summary: "Shared WhatsApp conversations, assigned to the right person.",
    mobile: true,
  },
  {
    href: "/campaigns",
    label: "Campaigns",
    icon: Megaphone,
    sprint: 6,
    summary:
      "Send approved WhatsApp templates to filtered audiences and track the orders they bring in.",
  },
  {
    href: "/appointments",
    label: "Appointments",
    icon: CalendarClock,
    sprint: 4,
    summary: "Store visits, walk-ins, trials and reminders.",
  },
  {
    href: "/orders",
    label: "Orders",
    icon: ShoppingBag,
    sprint: 4,
    summary: "Quotations, orders, payments and fulfilment tracking.",
  },
  {
    href: "/tasks",
    label: "Tasks",
    icon: ListChecks,
    sprint: 3,
    summary: "Follow-ups and reminders for every lead and customer.",
    mobile: true,
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    sprint: 8,
    summary: "Conversion by channel, campaign, branch and person.",
  },
  {
    href: "/reports",
    label: "Reports",
    icon: FileText,
    sprint: 8,
    summary: "Exportable CSV and PDF reports, scheduled by email.",
  },
];

export const adminNav: NavItem[] = [
  {
    href: "/team",
    built: true,
    label: "Team & roles",
    icon: Users,
    sprint: 1,
    summary: "Invite employees, set roles and limit access by branch.",
  },
  {
    href: "/integrations",
    label: "Integrations",
    icon: Plug,
    sprint: 5,
    summary: "Connect WhatsApp, Meta and Google, and see whether they are healthy.",
  },
  {
    href: "/automation",
    label: "Automation",
    icon: Workflow,
    sprint: 8,
    summary: "Automatic assignment, follow-ups and alerts.",
  },
  {
    href: "/settings",
    built: true,
    label: "Settings",
    icon: Cog,
    sprint: 1,
    summary: "Business profile, branches, pipeline stages and custom fields.",
  },
];

export const allNav = [...workspaceNav, ...adminNav];

export function findNav(href: string) {
  return allNav.find((item) => item.href === href);
}
