/** The slice of the Supabase user that UI actually needs. */
export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};
