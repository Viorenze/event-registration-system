export interface ExemptionEntry {
  method: "GET" | "POST";
  path: string;
}

export const exemptionsList: ExemptionEntry[] = [
  { method: "POST", path: "/api/auth/*" },
  { method: "GET", path: "/api/auth/*" },
  { method: "GET", path: "/doc" },
];
