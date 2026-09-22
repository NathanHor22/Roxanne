"use client";
import { createContext, useContext, useMemo } from "react";
import { workspaceTime } from "@/lib/workspace-time";

export const WorkspaceTimezone = createContext("Asia/Kuala_Lumpur");
export function useWorkspaceTime() {
  const timezone = useContext(WorkspaceTimezone);
  return useMemo(() => workspaceTime(timezone), [timezone]);
}
