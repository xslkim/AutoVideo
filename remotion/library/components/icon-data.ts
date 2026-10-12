/**
 * AutoVideo — Library icon data (offline stroke-icon set)
 *
 * SVG path data transcribed from Tabler Icons (https://tabler.io/icons),
 * which are released under the MIT License:
 *
 *   MIT License
 *   Copyright (c) 2020-2026 Paweł Kuna
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to
 *   permit persons to whom the Software is furnished to do so, subject to
 *   the following conditions: the above copyright notice and this
 *   permission notice shall be included in all copies or substantial
 *   portions of the Software.
 *   https://github.com/tabler/tabler-icons/blob/main/LICENSE
 *
 * Every glyph is stroke-based on a 24×24 viewBox (stroke-width 2, round
 * caps/joins, fill none) — that uniformity is what lets Icon.tsx run
 * draw-on entrances via strokeDashoffset with a normalized pathLength.
 *
 * Pure data + one pure lookup helper; no imports, no remotion dependency,
 * safe to pull into any layer (registry schemas, web pickers).
 */

/** Native viewBox edge of every glyph in ICON_PATHS. */
export const ICON_VIEWBOX = 24;

/** Tabler stroke width at ICON_VIEWBOX scale (multiply by size/24 when rendering). */
export const ICON_STROKE_WIDTH = 2;

/**
 * Canonical glyph table: name → combined `d` attribute (subpaths are
 * space-separated "M…" runs; split on /(?=M)/ to animate them one by one).
 */
export const ICON_PATHS = {
  "alert-triangle": "M12 9v4 M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0 M12 16h.01",
  atom: "M12 12v.01 M19.071 4.929c-1.562 -1.562 -6 .337 -9.9 4.243c-3.905 3.905 -5.804 8.337 -4.242 9.9c1.562 1.561 6 -.338 9.9 -4.244c3.905 -3.905 5.804 -8.337 4.242 -9.9 M4.929 4.929c-1.562 1.562 .337 6 4.243 9.9c3.905 3.905 8.337 5.804 9.9 4.242c1.561 -1.562 -.338 -6 -4.244 -9.9c-3.905 -3.905 -8.337 -5.804 -9.9 -4.242",
  bolt: "M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11",
  book: "M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0 M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0 M3 6l0 13 M12 6l0 13 M21 6l0 13",
  bookmark: "M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4",
  brackets: "M8 4h-3v16h3 M16 4h3v16h-3",
  brain: "M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8 M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8 M17.5 16a3.5 3.5 0 0 0 0 -7h-.5 M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0 M6.5 16a3.5 3.5 0 0 1 0 -7h.5 M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10",
  bug: "M9 9v-1a3 3 0 0 1 6 0v1 M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3 M3 13l4 0 M17 13l4 0 M12 20l0 -6 M4 19l3.35 -2 M20 19l-3.35 -2 M4 7l3.75 2.4 M20 7l-3.75 2.4",
  bulb: "M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7 M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3 M9.7 17l4.6 0",
  camera: "M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2 M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
  "chart-bar": "M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6 M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10 M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14 M4 20h14",
  "chart-line": "M4 19l16 0 M4 15l4 -6l4 2l4 -5l4 4",
  "chart-pie": "M10 3.2a9 9 0 1 0 10.8 10.8a1 1 0 0 0 -1 -1h-6.8a2 2 0 0 1 -2 -2v-7a.9 .9 0 0 0 -1 -.8 M15 3.5a9 9 0 0 1 5.5 5.5h-4.5a1 1 0 0 1 -1 -1v-4.5",
  check: "M5 12l5 5l10 -10",
  clock: "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0 M12 7v5l3 3",
  cloud: "M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878",
  code: "M7 8l-4 4l4 4 M17 8l4 4l-4 4 M14 4l-4 16",
  copy: "M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666 M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1",
  cpu: "M5 6a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -12 M9 9h6v6h-6l0 -6 M3 10h2 M3 14h2 M10 3v2 M14 3v2 M21 10h-2 M21 14h-2 M14 21v-2 M10 21v-2",
  database: "M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0 M4 6v6a8 3 0 0 0 16 0v-6 M4 12v6a8 3 0 0 0 16 0v-6",
  download: "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2 M7 11l5 5l5 -5 M12 4l0 12",
  edit: "M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1 M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415 M16 5l3 3",
  "external-link": "M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6 M11 13l9 -9 M15 4h5v5",
  eye: "M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0 M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6",
  "file-text": "M14 3v4a1 1 0 0 0 1 1h4 M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2 M9 9l1 0 M9 13l6 0 M9 17l6 0",
  filter: "M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227",
  folder: "M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2",
  "git-branch": "M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M15 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M7 8l0 8 M9 18h6a2 2 0 0 0 2 -2v-5 M14 14l3 -3l3 3",
  heart: "M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572",
  help: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 17l0 .01 M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4",
  "info-circle": "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0 M12 9h.01 M11 12h1v4h1",
  key: "M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0 M15 9h.01",
  link: "M9 15l6 -6 M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464 M13 18l-.397 -.534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463",
  lock: "M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6 M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0 M8 11v-4a4 4 0 1 1 8 0v4",
  mail: "M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10 M3 7l9 6l9 -6",
  math: "M19 5h-7l-4 14l-3 -6h-2 M14 13l6 6 M14 19l6 -6",
  "math-function": "M3 19a2 2 0 0 0 2 2c2 0 2 -4 3 -9s1 -9 3 -9a2 2 0 0 1 2 2 M5 12h6 M15 12l6 6 M15 18l6 -6",
  "message-circle": "M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1",
  microphone: "M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5 M5 10a7 7 0 0 0 14 0 M8 21l8 0 M12 17l0 4",
  music: "M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0 M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0 M9 17v-13h10v13 M9 8h10",
  network: "M6 9a6 6 0 1 0 12 0a6 6 0 0 0 -12 0 M12 3c1.333 .333 2 2.333 2 6s-.667 5.667 -2 6 M12 3c-1.333 .333 -2 2.333 -2 6s.667 5.667 2 6 M6 9h12 M3 20h7 M14 20h7 M10 20a2 2 0 1 0 4 0a2 2 0 0 0 -4 0 M12 15v3",
  photo: "M15 8h.01 M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12 M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5 M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3",
  "player-play": "M7 4v16l13 -8l-13 -8",
  plus: "M12 5l0 14 M5 12l14 0",
  robot: "M6 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -4 M12 2v2 M9 12v9 M15 12v9 M5 16l4 -2 M15 14l4 2 M9 18h6 M10 8v.01 M14 8v.01",
  rocket: "M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3 M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3 M14 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
  search: "M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0 M21 21l-6 -6",
  server: "M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-2 M3 15a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -2 M7 8l0 .01 M7 16l0 .01",
  settings: "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065 M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
  "shield-lock": "M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3 M11 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M12 12l0 2.5",
  star: "M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245",
  target: "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0 M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
  "terminal-2": "M8 9l3 3l-3 3 M13 15l3 0 M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12",
  upload: "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2 M7 9l5 -5l5 5 M12 4l0 12",
  user: "M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0 M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
  users: "M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2 M16 3.13a4 4 0 0 1 0 7.75 M21 21v-2a4 4 0 0 0 -3 -3.85",
  video: "M15 10l4.553 -2.276a1 1 0 0 1 1.447 .894v6.764a1 1 0 0 1 -1.447 .894l-4.553 -2.276v-4 M3 8a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -8",
  wifi: "M12 18l.01 0 M9.172 15.172a4 4 0 0 1 5.656 0 M6.343 12.343a8 8 0 0 1 11.314 0 M3.515 9.515c4.686 -4.687 12.284 -4.687 17 0",
  world: "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0 M3.6 9h16.8 M3.6 15h16.8 M11.5 3a17 17 0 0 0 0 18 M12.5 3a17 17 0 0 1 0 18",
  x: "M18 6l-12 12 M6 6l12 12",
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** All canonical icon names (for registry enums, pickers, docs). */
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

/**
 * Forgiving aliases → canonical names, so LLM-generated specs that say
 * "idea"/"ai"/"gear"/"warning" still resolve to a real glyph.
 */
export const ICON_ALIASES: Record<string, IconName> = {
  idea: "bulb",
  ai: "brain",
  lightning: "bolt",
  data: "database",
  chart: "chart-bar",
  graph: "chart-line",
  pie: "chart-pie",
  security: "shield-lock",
  warning: "alert-triangle",
  gear: "settings",
  image: "photo",
  play: "player-play",
  terminal: "terminal-2",
  globe: "world",
  internet: "world",
  chat: "message-circle",
  info: "info-circle",
  close: "x",
  file: "file-text",
  doc: "file-text",
  mic: "microphone",
  branch: "git-branch",
  people: "users",
  person: "user",
  time: "clock",
  question: "help",
  success: "check",
};

/**
 * Resolve a free-form name (canonical or alias, case-insensitive) to an
 * IconName. Returns undefined for unknown names — callers decide the
 * fallback (Icon.tsx renders "help").
 */
export function resolveIconName(name: string): IconName | undefined {
  const n = name.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ICON_PATHS, n)) return n as IconName;
  return ICON_ALIASES[n];
}
