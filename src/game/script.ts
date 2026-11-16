/** All in-world copy. Original dialogue — no borrowed characters or quotes. */
export const LINES = {
  intro: ['Another cosy little room.\nI think I\'ll take it.', 'Walls, floor, air —\nall mine now.'],
  throw: ['Dodge, little spark!', 'Too slow!', 'Hold still...'],
  charging: ['What is that glow?', 'Stop that. STOP.', 'Your light is cracking my walls!'],
  crack: ['The seams... they\'re splitting!'],
  arena: ['Then meet me where\nthere are no walls.'],
  surge: ['KNEEL!', 'BURN!', 'FADE!'],
  win: ['Impossible...'],
  lose: ['Rest now, little spark.'],
} as const;

export type InputKind = 'hands' | 'controller' | 'pointer';

export const PROMPTS = {
  scan: 'LOOK AT THE FLOOR',
  scanDesktop: 'ENTERING YOUR ROOM...',
  charge: {
    hands: 'CUP BOTH HANDS TOGETHER\nLOW AT YOUR SIDE',
    controller: 'HOLD A TRIGGER\nTO CHARGE',
    pointer: 'HOLD CLICK / TAP\nTO CHARGE',
  },
  fire: {
    hands: 'PUSH BOTH PALMS\nFORWARD',
    controller: 'PULL THE TRIGGER',
    pointer: 'CLICK TO FIRE',
  },
  pump: {
    hands: 'PUMP YOUR HANDS FORWARD!',
    controller: 'MASH THE TRIGGER!',
    pointer: 'CLICK! CLICK! CLICK!',
  },
  win: { title: 'THE SOVEREIGN FALLS', sub: 'You held the line.' },
  lose: { title: 'THE REALM CLOSES', sub: 'Your light fades...' },
} as const;

export const pick = <T,>(arr: readonly T[], i: number): T => arr[i % arr.length];
