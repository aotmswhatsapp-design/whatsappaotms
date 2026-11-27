"use client";

/**
 * Meta's Embedded Signup needs their JavaScript SDK on the page.
 *
 * It is fetched on demand: the workspace shell should not pay for a third-party
 * script because someone opened the Overview. The card preloads it while the
 * customer reads, so the click that opens the dialog is still inside a user
 * gesture — a dialog opened after an `await` is what browsers call a pop-up and
 * block.
 */

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const SDK_TIMEOUT_MS = 15_000;
/**
 * How long to wait for the `FINISH` post-message after the login callback has
 * already handed us the code. v4 sends the ids in their own message and it can
 * trail the callback by a moment; failing instantly would reject a setup that
 * actually finished.
 */
const IDS_GRACE_MS = 3_000;

interface FbAuthResponse {
  code?: string;
}

interface FbLoginResponse {
  status?: string;
  authResponse?: FbAuthResponse | null;
}

interface FbSdk {
  init(options: Record<string, unknown>): void;
  login(
    callback: (response: FbLoginResponse) => void,
    options: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

/** What the dialog produced, or one sentence to show under the button. */
export type SignupResult =
  | {
      ok: true;
      code: string;
      wabaId: string;
      /**
       * Absent on a coexistence finish — a number that stays in use in the
       * WhatsApp Business app. Meta reports only the business account there,
       * and the server resolves the number from it.
       */
      phoneNumberId?: string;
    }
  | { ok: false; message: string };

let loader: Promise<void> | null = null;
/** The app id the SDK was initialised with; it refuses a second init. */
let initialisedFor: string | null = null;

export function signupSdkReady(): boolean {
  return typeof window !== "undefined" && Boolean(window.FB);
}

/**
 * Warms the script up so the click that opens the dialog stays inside a user
 * gesture. Rejects with a sentence the card can show.
 */
export function preloadSignupSdk(): Promise<void> {
  return load();
}

function load(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.FB) return Promise.resolve();
  if (loader) return loader;

  const pending = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      loader = null;
      reject(new Error("Meta's signup script did not load in time."));
    }, SDK_TIMEOUT_MS);

    // The SDK calls this once the script has run; `FB.init` happens later, when
    // the app id is known.
    window.fbAsyncInit = () => {
      window.clearTimeout(timer);
      if (window.FB) resolve();
      else reject(new Error("Meta's signup script loaded without its SDK."));
    };

    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      window.clearTimeout(timer);
      loader = null;
      reject(
        new Error(
          "Meta's signup script was blocked. An ad blocker or a corporate proxy can do that.",
        ),
      );
    };

    document.body.appendChild(script);
  });

  loader = pending;
  return pending;
}

/**
 * Opens Meta's dialog and resolves when it either produces a code plus the
 * chosen business/number, or explains why it did not.
 *
 * Two sources are needed because Meta splits the answer: the post-message
 * carries the ids, the `FB.login` callback carries the code. Neither alone is
 * enough to connect an account.
 */
export function runEmbeddedSignup(input: {
  appId: string;
  configId: string;
  version: string;
}): Promise<SignupResult> {
  const sdk = typeof window === "undefined" ? undefined : window.FB;

  if (!sdk) {
    return Promise.resolve({
      ok: false,
      message: "Meta's signup script is still loading. Try again in a second.",
    });
  }

  return new Promise<SignupResult>((resolve) => {
    let settled = false;
    /** The code, once the login callback has produced it. */
    let pendingCode: string | null = null;
    /** Armed when the code arrives before the ids; see IDS_GRACE_MS. */
    let idsTimer: number | null = null;
    const chosen: { wabaId?: string; phoneNumberId?: string } = {};

    const settle = (result: SignupResult) => {
      if (settled) return;
      settled = true;
      if (idsTimer !== null) {
        window.clearTimeout(idsTimer);
        idsTimer = null;
      }
      window.removeEventListener("message", onMessage);
      resolve(result);
    };

    /**
     * Resolves once both halves exist, whichever order Meta sends them in.
     *
     * The number is not required: a coexistence finish ends with the business
     * account alone, and waiting for a number that will never arrive would
     * reject a setup Meta has already completed.
     */
    const settleIfComplete = () => {
      if (!pendingCode || !chosen.wabaId) return;

      settle({
        ok: true,
        code: pendingCode,
        wabaId: chosen.wabaId,
        phoneNumberId: chosen.phoneNumberId,
      });
    };

    const onMessage = (event: MessageEvent) => {
      // Only Meta's own frames speak this protocol; anything else is a stray
      // post-message from another tab or another integration on the page.
      if (!isFacebookOrigin(event.origin)) return;

      const payload = readSessionMessage(event.data);
      if (!payload || payload.type !== "WA_EMBEDDED_SIGNUP") return;

      const data = payload.data ?? {};

      if (typeof data.waba_id === "string") chosen.wabaId = data.waba_id;
      if (typeof data.phone_number_id === "string") {
        chosen.phoneNumberId = data.phone_number_id;
      }

      if (payload.event === "CANCEL") {
        settle({
          ok: false,
          message: "The Meta window was closed before setup finished.",
        });
        return;
      }

      if (payload.event === "ERROR") {
        settle({
          ok: false,
          message:
            typeof data.error_message === "string" && data.error_message
              ? data.error_message
              : "Meta reported an error during setup.",
        });
        return;
      }

      // `FINISH` and `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` are the v4 names
      // for "the customer picked a number"; older builds carried the ids on
      // events that no longer exist, which is why this does not switch on the
      // event name at all.
      settleIfComplete();
    };

    window.addEventListener("message", onMessage);

    try {
      if (initialisedFor !== input.appId) {
        sdk.init({
          appId: input.appId,
          version: input.version,
          // Meta's sample sets this; no `<fb:*>` markup exists in this app, so
          // the parse pass finds nothing and costs one scan.
          xfbml: true,
          // No Facebook Login cookie: the dialog hands the server an OAuth code,
          // so there is no `fbsr_` cookie worth setting.
          cookie: false,
        });
        initialisedFor = input.appId;
      }
    } catch {
      settle({
        ok: false,
        message:
          "Meta's SDK rejected this app's configuration. A workspace administrator has to fix the Meta app settings.",
      });
      return;
    }

    sdk.login(
      (response) => {
        const code = response.authResponse?.code;

        if (!code) {
          settle({
            ok: false,
            message:
              response.status === "not_authorized"
                ? "That Facebook account was not allowed to finish setup."
                : "The Meta window closed before setup finished. If nothing opened, allow pop-ups for this site and try again.",
          });
          return;
        }

        if (!chosen.wabaId) {
          // The ids may still be in flight; give the FINISH message a moment
          // before calling the setup incomplete. Only the business account is
          // required — the number can legitimately never arrive.
          pendingCode = code;
          idsTimer = window.setTimeout(() => {
            settle({
              ok: false,
              message:
                "Meta did not report which business account you chose. Run the setup again and finish every step.",
            });
          }, IDS_GRACE_MS);
          return;
        }

        settle({
          ok: true,
          code,
          wabaId: chosen.wabaId,
          phoneNumberId: chosen.phoneNumberId,
        });
      },
      {
        config_id: input.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          // Coexistence: the screen Meta opens then offers "connect your
          // existing WhatsApp Business app account" alongside the normal
          // paths, and finishes with the business account alone. Without this
          // the dialog cannot onboard a number that is already on the app.
          featureType: "whatsapp_business_app_onboarding",
          // The shape of the `WA_EMBEDDED_SIGNUP` messages this listener reads.
          sessionInfoVersion: "3",
        },
      },
    );
  });
}

interface SessionMessage {
  type?: string;
  event?: string;
  data?: {
    waba_id?: unknown;
    phone_number_id?: unknown;
    error_message?: unknown;
  };
}

/** Meta posts an object, but some versions post the same JSON as a string. */
function readSessionMessage(raw: unknown): SessionMessage | null {
  if (typeof raw === "object" && raw !== null) return raw as SessionMessage;

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === "object" && parsed !== null
        ? (parsed as SessionMessage)
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

function isFacebookOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    return (
      protocol === "https:" &&
      (hostname === "facebook.com" || hostname.endsWith(".facebook.com"))
    );
  } catch {
    return false;
  }
}
