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
  platform = false,
}: {
  callbackUrl: string | null;
  verifyToken: string | null;
  /**
   * A one-click connection lives under the server's platform Meta app, whose
   * callback URL is verified once for the whole deployment — so there is no
   * per-workspace token for the customer to paste.
   */
  platform?: boolean;
}) {
  return (
    <div className="space-y-4">
      <CopyField
        hint="One URL for every workspace. Meta calls it for the handshake and for every delivery."
        label="Callback URL"
        value={callbackUrl}
      />

      {platform ? (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Meta verified this app&apos;s callback URL once; the token lives in the
          server&apos;s environment. Nothing to paste here.
        </p>
      ) : (
        <CopyField
          hint="Generated for this workspace. Meta echoes it back when it verifies the URL."
          label="Verify token"
          value={verifyToken}
        />
      )}
    </div>
  );
}
