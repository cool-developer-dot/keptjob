"use client";

import { createContext, useContext } from "react";

import type { OrgSettings } from "@/lib/org-settings";

const OrgSettingsContext = createContext<OrgSettings | null>(null);

/** Provided by the (app) layout with getOrgSettings(); read with useOrgSettings(). */
export function OrgSettingsProvider({
  value,
  children,
}: {
  value: OrgSettings;
  children: React.ReactNode;
}) {
  return <OrgSettingsContext.Provider value={value}>{children}</OrgSettingsContext.Provider>;
}

/** Org timezone / default currency / stale days for client components. */
export function useOrgSettings(): OrgSettings {
  const value = useContext(OrgSettingsContext);
  if (!value) throw new Error("useOrgSettings must be used inside <OrgSettingsProvider>.");
  return value;
}
