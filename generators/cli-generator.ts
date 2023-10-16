import { ESCAPE_SEQUENCES } from "../ansi.ts";
import { HelpGenerator } from "../types.ts";

export class CommandLineHelpGenerator implements HelpGenerator {
  formatPrefix(
    args: string[],
    placeholder: string | undefined,
    isOptional = false,
  ) {
    const inset = args[0].startsWith("--") ? "    " : "";
    const content = `    ${inset}${
      args.map((a) =>
        `${
          isOptional
            ? ESCAPE_SEQUENCES.SCHEME_LIGHT_CYAN
            : ESCAPE_SEQUENCES.SCHEME_CYAN
        }${a}${ESCAPE_SEQUENCES.RESET}`
      ).join(", ")
    }${placeholder ? " " + placeholder : ""}`;
    return content;
  }
  formatDescription(description: string, level: number): string {
    if (level == 1) description = "\n" + description.replace(/^/gm, "  ");
    return `${ESCAPE_SEQUENCES.SCHEME_GREY}${description}${ESCAPE_SEQUENCES.RESET}`;
  }
  formatDefault(value: unknown): string {
    return `${ESCAPE_SEQUENCES.SCHEME_GREY} (default: ${value})${ESCAPE_SEQUENCES.RESET}`;
  }
  formatTitle(title: string, level: number): string {
    if (level >= 4) {
      return `\n    ${ESCAPE_SEQUENCES.SCHEME_GREY}${title}${ESCAPE_SEQUENCES.RESET}`;
    } else if (level >= 3) return `\n  ${title}${ESCAPE_SEQUENCES.RESET}`;
    else return `\n${ESCAPE_SEQUENCES.BOLD}${title}${ESCAPE_SEQUENCES.RESET}`;
  }

  formatSubcommand(command: string): string {
    return `\n${ESCAPE_SEQUENCES.SCHEME_GREEN}\n  ${command}${ESCAPE_SEQUENCES.RESET}`;
  }

  getMinSpacing(): number {
    return 4;
  }
  getEnd() {
    return `\n`;
  }

  createSection() {
    return "";
  }
}
