import { DollarSign, Newspaper, Image, LayoutGrid, ListChecks, Megaphone, Plug, Search, Shield, Users } from "lucide-react";

// Lives outside the route file: it's used by both validateSearch and the component,
// and TanStack's code splitter can't share a non-exported route-file constant.
export const SECTIONS = [
  { id: "overview", label: "Overview", icon: LayoutGrid, ready: true },
  { id: "users", label: "User Management", icon: Users, ready: true },
  { id: "posts", label: "Posts", icon: Newspaper, ready: true },
  { id: "media", label: "Media Library", icon: Image, ready: true },
  { id: "search", label: "Search Management", icon: Search, ready: true },
  { id: "announcements", label: "Announcements & Settings", icon: Megaphone, ready: true },
  { id: "monetization", label: "Ads", icon: DollarSign, ready: true },
  { id: "jobs", label: "Background Jobs", icon: ListChecks, ready: true },
  { id: "health", label: "Integrations & Health", icon: Plug, ready: true },
  { id: "audit", label: "Security & Audit Log", icon: Shield, ready: true },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];
