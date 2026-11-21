import { request } from "@/lib/api/http";

export { ApiError } from "@/lib/api/http";

/** The workspace's own details. Customers never see these. */
export interface BusinessProfile {
  companyName: string | null;
  website: string | null;
  timezone: string;
  supportNumber: string | null;
  /** Null until the first save, so the form can say nothing is stored yet. */
  updatedAt: string | null;
}

/** What the form sends. Blank strings clear a field on the server. */
export interface BusinessProfileInput {
  companyName: string;
  website: string;
  timezone: string;
  supportNumber: string;
}

export function fetchBusinessProfile(): Promise<BusinessProfile> {
  return request<BusinessProfile>("/v1/business/profile", { method: "GET" });
}

/** A PATCH, so a save never has to resend a field the user did not touch. */
export function saveBusinessProfile(
  input: BusinessProfileInput,
): Promise<BusinessProfile> {
  return request<BusinessProfile>("/v1/business/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
