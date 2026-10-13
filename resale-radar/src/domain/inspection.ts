/** Category-specific pickup inspection checklists. */

export interface ChecklistItem {
  id: string;
  label: string;
  critical: boolean;
}

const common: ChecklistItem[] = [
  { id: "matches_listing", label: "Item matches listing photos and description", critical: true },
  { id: "photos_taken", label: "Photos taken of item, labels, and any defects", critical: false },
  { id: "receipt", label: "Receipt or message confirming price saved", critical: false },
];

export const CHECKLISTS: Record<string, ChecklistItem[]> = {
  game_consoles: [
    { id: "powers_on", label: "Powers on and boots to the home screen", critical: true },
    { id: "disc_reads", label: "Reads discs (disc models)", critical: true },
    { id: "hdmi", label: "HDMI output works", critical: true },
    { id: "controller", label: "Controller connects and all buttons respond", critical: true },
    { id: "network", label: "Connects to Wi-Fi or Ethernet", critical: false },
    { id: "model", label: "Model number matches listing", critical: true },
    { id: "ban", label: "No console ban or account restriction message", critical: true },
    { id: "accessories", label: "Power cable, HDMI cable, and listed accessories present", critical: false },
    { id: "serial", label: "Serial number recorded", critical: false },
  ],
  computers: [
    { id: "activation_lock", label: "Activation Lock / Find My is off (signed out of Apple ID or Microsoft account)", critical: true },
    { id: "mdm", label: "No device management or school/corporate enrollment", critical: true },
    { id: "specs", label: "Serial and specifications match listing (About This Mac / System info)", critical: true },
    { id: "battery", label: "Battery cycle count and health recorded", critical: false },
    { id: "display", label: "Display has no dead pixels, lines, or pressure marks", critical: true },
    { id: "keyboard_ports", label: "Keyboard, trackpad, and all ports work", critical: true },
    { id: "charger", label: "Charger included and charges the device", critical: false },
    { id: "function", label: "Wi-Fi, camera, speakers, and microphone tested", critical: false },
  ],
  phones_tablets: [
    { id: "activation_lock", label: "Activation Lock / FRP removed and account signed out", critical: true },
    { id: "carrier", label: "Carrier lock status and IMEI blacklist checked", critical: true },
    { id: "battery", label: "Battery health recorded", critical: false },
    { id: "display", label: "Screen and touch fully responsive", critical: true },
    { id: "cameras", label: "Cameras, Face ID / fingerprint, speakers work", critical: true },
  ],
  sports_cards: [
    { id: "identity", label: "Year, manufacturer, set, player, and card number confirmed", critical: true },
    { id: "parallel", label: "Parallel, serial numbering, and autograph confirmed", critical: true },
    { id: "surface", label: "Surface checked under light for scratches and print lines", critical: false },
    { id: "corners_edges", label: "Corners and edges inspected", critical: false },
    { id: "centering", label: "Centering estimated", critical: false },
    { id: "slab", label: "Grading certificate verified on the grader's website (if slabbed)", critical: true },
  ],
  trading_cards: [
    { id: "identity", label: "Set, number, edition, and language confirmed", critical: true },
    { id: "authentic", label: "Authenticity indicators checked (light test, print pattern, font)", critical: true },
    { id: "condition", label: "Surface, corners, edges, and centering inspected", critical: false },
    { id: "slab", label: "Grading certificate verified (if slabbed)", critical: true },
  ],
  video_games: [
    { id: "region", label: "Region and platform confirmed", critical: true },
    { id: "complete", label: "Case, manual, and inserts present as listed (CIB status)", critical: false },
    { id: "media", label: "Disc or cartridge condition inspected; labels authentic", critical: true },
    { id: "test", label: "Tested in a console if possible", critical: false },
  ],
  dj_equipment: [
    { id: "power", label: "Powers on; all channels pass audio", critical: true },
    { id: "controls", label: "Faders, knobs, and jog wheels are smooth with no crackle", critical: true },
    { id: "usb", label: "USB / software connection works", critical: false },
    { id: "serial", label: "Serial number recorded and not reported stolen", critical: true },
  ],
  artwork: [
    { id: "medium", label: "Original vs print determined (texture, brush strokes, dot pattern under magnification)", critical: true },
    { id: "signature", label: "Signature photographed; edition number noted", critical: true },
    { id: "provenance", label: "Provenance documents or labels on the back photographed", critical: false },
    { id: "condition", label: "Canvas, frame, and paper condition checked", critical: false },
  ],
  dolls: [
    { id: "markings", label: "Manufacturer marks on neck, back, or feet photographed", critical: true },
    { id: "reproduction", label: "Reproduction indicators checked (markings, materials, face paint)", critical: true },
    { id: "original_parts", label: "Original clothing, accessories, and box identified", critical: false },
  ],
  watches: [
    { id: "authenticity", label: "Serial, reference, caseback, and movement checked", critical: true },
    { id: "running", label: "Runs and keeps time; crown and functions work", critical: true },
    { id: "papers", label: "Box and papers present as listed", critical: false },
  ],
};

export function checklistFor(category: string | null | undefined): ChecklistItem[] {
  const specific = category ? CHECKLISTS[category] ?? [] : [];
  return [...specific, ...common];
}

export const SAFETY_TIPS = [
  "Meet in a public, well-lit place such as a police station exchange zone when practical.",
  "Never send a deposit to an unknown seller before seeing the item.",
  "Bring exact cash and a way to test the item (power bank, HDMI cable, controller).",
  "Walk away if the seller refuses testing, the item differs from photos, or serial numbers are removed.",
];
