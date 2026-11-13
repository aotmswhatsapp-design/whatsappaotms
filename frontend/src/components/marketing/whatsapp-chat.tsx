import {
  CheckCheck,
  ChevronLeft,
  Mic,
  Paperclip,
  Phone,
  Smile,
  Video,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * WhatsApp's own palette, pinned to hex rather than site tokens: this is a
 * facsimile of the app, and it has to keep looking like the app.
 */
const INCOMING =
  "self-start max-w-[82%] rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]";
const OUTGOING =
  "self-end max-w-[82%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]";

function Stamp({ time, sent }: { time: string; sent?: boolean }) {
  return (
    <span className="mt-1 flex items-center justify-end gap-1 text-[9px] text-[#667781]">
      {time}
      {sent ? <CheckCheck className="size-[11px] text-[#53bdeb]" /> : null}
    </span>
  );
}

/**
 * A WhatsApp thread rendered as markup rather than an image. Sized for the
 * 389.5 x 843.5 screen of the Iphone15Pro frame — every value here is in that
 * user space and scales with the device.
 */
export function WhatsAppChat() {
  return (
    <div className="flex h-full w-full flex-col bg-[#efeae2] text-[#111b21]">
      <header className="shrink-0 bg-[#008069] text-white">
        {/* Status bar. The 48px row keeps the clock and battery clear of the
            dynamic island, which the frame paints over this area. */}
        <div className="flex h-12 items-end justify-between px-6 pb-1.5 text-[11px] font-semibold">
          <span>9:41</span>
          <span className="flex items-end gap-1">
            <span className="flex items-end gap-[2px]">
              {[3, 5, 7, 9].map((h) => (
                <span
                  key={h}
                  className="w-[3px] rounded-[1px] bg-white"
                  style={{ height: h }}
                />
              ))}
            </span>
            <svg viewBox="0 0 16 12" className="h-[9px] w-3 fill-white">
              <path d="M8 10.2a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Z" />
              <path d="M8 1.4c2.2 0 4.2.9 5.7 2.3l-1.3 1.3A6.3 6.3 0 0 0 8 3.2c-1.7 0-3.2.7-4.4 1.8L2.3 3.7A8.1 8.1 0 0 1 8 1.4Z" />
              <path d="M8 5.6c1 0 1.9.4 2.6 1L8 9.2 5.4 6.6c.7-.6 1.6-1 2.6-1Z" />
            </svg>
            <span className="h-[9px] w-[18px] rounded-[3px] border border-white/70 p-[1.5px]">
              <span className="block h-full w-[70%] rounded-[1px] bg-white" />
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2 px-2 pb-2.5">
          <ChevronLeft className="size-4 shrink-0" strokeWidth={2.5} />
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-white/25 text-[12px] font-semibold">
            P
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold">Priya · Support</p>
            <p className="text-[10px] text-white/80">online</p>
          </div>
          <Video className="size-4 shrink-0" />
          <Phone className="size-[15px] shrink-0" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-2.5 py-2 text-[12px] leading-[1.35]">
        <p className="mx-auto max-w-[88%] rounded-md bg-[#feefc6] px-2 py-1 text-center text-[9px] text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
          Messages are end-to-end encrypted
        </p>

        <div className={INCOMING}>
          Hi! Do you have the 2 kg pack in stock?
          <Stamp time="09:41" />
        </div>

        <div className={OUTGOING}>
          Yes — 2 kg is available at the Andheri hub. Shall I reserve one for you?
          <Stamp time="09:41" sent />
        </div>

        <div className={INCOMING}>
          Please. Need it tomorrow before 11.
          <Stamp time="09:42" />
        </div>

        <div className={OUTGOING}>
          Booked for 9–11 am tomorrow. I&apos;ll share tracking as soon as it ships.
          <Stamp time="09:42" sent />
        </div>

        <p className="mx-auto max-w-[88%] rounded-md bg-white/85 px-2 py-1 text-center text-[9px] text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
          Chatbot answered 4 messages · Priya joined
        </p>

        <div className={INCOMING}>
          Perfect, thank you!
          <Stamp time="09:43" />
        </div>

        <div className={OUTGOING}>
          Anytime. Reply here if the slot needs to change.
          <Stamp time="09:43" sent />
        </div>

        <div
          className={cn(INCOMING, "flex items-center gap-1 py-2")}
          aria-hidden="true"
        >
          {[0, 0.15, 0.3].map((delay) => (
            <span
              key={delay}
              className="size-1.5 animate-bounce rounded-full bg-[#8696a0]"
              style={{ animationDelay: `${delay}s` }}
            />
          ))}
        </div>
      </div>

      <div className="shrink-0 bg-[#f0f2f5] px-2 pb-2.5 pt-1.5">
        <div className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-[7px]">
          <Smile className="size-[15px] shrink-0 text-[#6b7c85]" />
          <span className="flex-1 text-[11px] text-[#8696a0]">Message</span>
          <Paperclip className="size-[15px] shrink-0 text-[#6b7c85]" />
          <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-[#00a884]">
            <Mic className="size-3 text-white" />
          </span>
        </div>
      </div>
    </div>
  );
}
