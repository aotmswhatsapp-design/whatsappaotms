/**
 * The industries the landing page speaks to, one row per image in `public/`.
 *
 * Each illustration already prints the exchange it is making a case for — a
 * sizing question answered with a price, an appointment reminder with a tick,
 * a lead card with a budget, a campaign with its reach, an enquiry assigned to
 * a counsellor. The bullets below restate those bubbles in words, so the card
 * cannot claim something the picture in the same box does not show.
 *
 * Copy lives here rather than in the component for the same reason the client
 * logos do: adding an industry is a PNG plus an entry, not a JSX edit.
 */
export type Industry = {
  /** Stable, URL-safe: it becomes the tab and panel id fragments. */
  id: string;
  /** The pill. Kept to one or two words so five fit on one line. */
  label: string;
  image: {
    src: string;
    /** Describes the exchange in the picture, not the person in it. */
    alt: string;
    width: number;
    height: number;
  };
  headline: string;
  description: string;
  /** Three proofs; rendered with a tick, so keep them noun-phrase length. */
  points: string[];
};

export const industries: Industry[] = [
  {
    id: "e-commerce",
    label: "E-commerce",
    image: {
      src: "/E-commerce.png",
      alt: "A shopper asking whether an item comes in medium, answered with the price and an offer to complete the order.",
      width: 1024,
      height: 796,
    },
    headline: "Turn conversations into purchases",
    description:
      "Sizing, stock and price questions get answered the minute they land, and the order closes in the same thread instead of a checkout link.",
    points: [
      "Catalogue questions answered without a person reading them first",
      "Price and availability quoted in the chat",
      "Orders completed where the customer already is",
    ],
  },
  {
    id: "healthcare",
    label: "Healthcare",
    image: {
      src: "/Doctor.png",
      alt: "An appointment reminder marked as sent, followed by a confirmed slot with the patient's name and time.",
      width: 1024,
      height: 858,
    },
    headline: "Reminders that get read",
    description:
      "Appointment reminders, confirmations and follow-ups go out on the number the patient already has saved, so the front desk stops dialling.",
    points: [
      "Reminders sent ahead of the slot without a manual list",
      "Confirmations and reschedules handled in the thread",
      "No-shows caught while the slot can still be refilled",
    ],
  },
  {
    id: "real-estate",
    label: "Real Estate",
    image: {
      src: "/Real-Estate.png",
      alt: "A qualified lead card showing configuration, budget and locality, next to a booked site visit and a stage pipeline.",
      width: 1130,
      height: 944,
    },
    headline: "Qualify the lead before the site visit",
    description:
      "Budget, configuration and locality are asked once, up front, so the agent opens a conversation that already knows what the buyer wants.",
    points: [
      "Budget and configuration captured on the first reply",
      "High-intent leads flagged instead of queued",
      "Site visits booked from the same conversation",
    ],
  },
  {
    id: "restaurants",
    label: "Restaurants",
    image: {
      src: "/Restaurants.png",
      alt: "An automated follow-up campaign for a weekend offer showing how many people it reached.",
      width: 1024,
      height: 852,
    },
    headline: "Fill the quiet nights with one send",
    description:
      "Build the list from people who have already ordered, then send the weekend offer and watch who read it.",
    points: [
      "Offers sent to your own list, not to a bought one",
      "Reach and replies counted per campaign",
      "Follow-ups scheduled once and then handled for you",
    ],
  },
  {
    id: "education",
    label: "Education",
    image: {
      src: "/Education.png",
      alt: "An enquiry scored as high intent and assigned to a named counsellor, with twelve more routed the same way.",
      width: 1024,
      height: 858,
    },
    headline: "Route every enquiry to the right counsellor",
    description:
      "Programme interest and intent decide who a lead belongs to, so nobody sits unread until the batch closes.",
    points: [
      "Interest captured on the very first reply",
      "Enquiries scored and assigned automatically",
      "Counsellors open a lead with the context attached",
    ],
  },
];
