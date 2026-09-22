import { WorkspaceRoute } from "@/components/workspace/WorkspaceRoute";
export const dynamic = "force-dynamic";
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <><WorkspaceRoute mode="live" view="overview" />{children}</>;
}
