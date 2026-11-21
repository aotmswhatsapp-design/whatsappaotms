"use client";

import { CopyField } from "./copy-field";

/**
 * The two values Meta's Webhooks panel asks for, always in one place.
 *
 * They are a pair: Meta will not verify the callback URL without the token, and
 * the token is meaningless on its own. They used to be rendered separately —
 * both on the webhook step, only the URL on the last two — so a customer who
 * reached the end of the flow could no longer see the token they needed to
 * paste. Rendering them from one component makes that drift impossible.
 */
export function WebhookFields({
  callbackUrl,
  verifyToken,
}: {
  callbackUrl: string | null;
  verifyToken: string | null;
}) {
  return (
    <div className="space-y-4">
      <CopyField
        hint="One URL for every workspace. Meta calls it for the handshake and for every delivery."
        label="Callback URL"
        value={callbackUrl}
      />

      <CopyField
        hint="Generated for this workspace. Meta echoes it back when it verifies the URL."
        label="Verify token"
        value={verifyToken}
      />
    </div>
  );
}
