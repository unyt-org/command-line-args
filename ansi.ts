/**
 * color scheme
 */
const COLORS = {
  RED: [234, 43, 81],
  GREEN: [30, 218, 109],
  BLUE: [6, 105, 193],
  YELLOW: [235, 182, 38],
  MAGENTA: [196, 112, 222],
  CYAN: [79, 169, 232],
  BLACK: [5, 5, 5],
  WHITE: [250, 250, 250],
  GREY: [150, 150, 150],
  LIGHT_CYAN: [24, 78, 109],
} as const;

/**
 * Common ANSI esacpe sequences for colors and text style
 */
export const ESCAPE_SEQUENCES = {
  CLEAR: "\x1b[2J", // clear screen

  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
  DEFAULT: "\x1b[2m",
  ITALIC: "\x1b[3m",
  UNDERLINE: "\x1b[4m",
  INVERSE: "\x1b[7m",
  HIDDEN: "\x1b[8m",

  RESET_UNDERLINE: "\x1b[24m",
  RESET_INVERSE: "\x1b[27m",

  BLACK: "\x1b[30m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  WHITE: "\x1b[37m",
  GREY: "\x1b[90m",
  COLOR_DEFAULT: "\x1b[39m",

  BG_BLACK: "\x1b[40m",
  BG_RED: "\x1b[41m",
  BG_GREEN: "\x1b[42m",
  BG_YELLOW: "\x1b[43m",
  BG_BLUE: "\x1b[44m",
  BG_MAGENTA: "\x1b[45m",
  BG_CYAN: "\x1b[46m",
  BG_WHITE: "\x1b[47m",
  BG_GREY: "\x1b[100m",
  BG_COLOR_DEFAULT: "\x1b[49m",

  SCHEME_RED: `\x1b[38;2;${COLORS.RED.join(";")}m`,
  SCHEME_GREEN: `\x1b[38;2;${COLORS.GREEN.join(";")}m`,
  SCHEME_BLUE: `\x1b[38;2;${COLORS.BLUE.join(";")}m`,
  SCHEME_CYAN: `\x1b[38;2;${COLORS.CYAN.join(";")}m`,
  SCHEME_MAGENTA: `\x1b[38;2;${COLORS.MAGENTA.join(";")}m`,
  SCHEME_YELLOW: `\x1b[38;2;${COLORS.YELLOW.join(";")}m`,
  SCHEME_BLACK: `\x1b[38;2;${COLORS.BLACK.join(";")}m`,
  SCHEME_WHITE: `\x1b[38;2;${COLORS.WHITE.join(";")}m`,
  SCHEME_GREY: `\x1b[38;2;${COLORS.GREY.join(";")}m`,
  SCHEME_LIGHT_CYAN: `\x1b[38;2;${COLORS.LIGHT_CYAN.join(";")}m`,

  SCHEME_BG_RED: `\x1b[48;2;${COLORS.RED.join(";")}m`,
  SCHEME_BG_GREEN: `\x1b[48;2;${COLORS.GREEN.join(";")}m`,
  SCHEME_BG_BLUE: `\x1b[48;2;${COLORS.BLUE.join(";")}m`,
  SCHEME_BG_CYAN: `\x1b[48;2;${COLORS.CYAN.join(";")}m`,
  SCHEME_BG_MAGENTA: `\x1b[48;2;${COLORS.MAGENTA.join(";")}m`,
  SCHEME_BG_YELLOW: `\x1b[48;2;${COLORS.YELLOW.join(";")}m`,
  SCHEME_BG_GREY: `\x1b[48;2;${COLORS.GREY.join(";")}m`,

  SCHEME_POINTER: "\x1b[38;2;65;102;238m",
} as const;
