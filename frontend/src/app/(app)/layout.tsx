import { Suspense, type ReactNode } from "react";

import { WorkspaceShell } from "@/components/workspace/shell/workspace-shell";
import { ToastProvider } from "@/components/ui/toast";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Shell for signed-in routes: sidebar, top bar and account avatar — not the
 * marketing navbar. `getSessionUser` reads cookies, so it lives behind a
 * Suspense boundary; the fallback renders the same chrome signed-out (no
 * avatar) and is replaced once the session resolves.
 */
async function SessionWorkspaceShell({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  return <WorkspaceShell user={user}>{children}</WorkspaceShell>;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <Suspense fallback={<WorkspaceShell user={null}>{children}</WorkspaceShell>}>
        <SessionWorkspaceShell>{children}</SessionWorkspaceShell>
      </Suspense>
    </ToastProvider>
  );
}
