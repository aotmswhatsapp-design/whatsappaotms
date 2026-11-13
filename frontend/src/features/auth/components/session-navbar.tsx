import { Navbar } from "@/components/marketing/navbar";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Resolves the session on the server and hands it to the client navbar.
 *
 * Always render this inside `<Suspense fallback={<Navbar />}>`: reading cookies
 * makes it dynamic, and `cacheComponents` rejects dynamic data that is not
 * already wrapped. The fallback is the signed-out navbar, so the first paint is
 * correct for anonymous visitors and only signed-in visitors see it swap.
 */
export async function SessionNavbar() {
  const user = await getSessionUser();
  return <Navbar user={user} />;
}
