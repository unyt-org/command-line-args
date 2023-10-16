import { HelpGenerator } from "../types.ts";

export class MarkdownGenerator implements HelpGenerator {
  static generalDescription =
    `# Run Options\nThis file contains an auto-generated list of the available command line options.`;

  getPreamble() {
    return `${MarkdownGenerator.generalDescription}\n`;
  }
  formatPrefix(args: string[], placeholder: string | undefined) {
    return ` * \`${args.join(", ")}${placeholder ? " " + placeholder : ""}\``;
  }
  formatDefault(value: unknown): string {
    return ` (default: ${value})`;
  }
  formatDescription(description: string): string {
    return description;
  }
  formatTitle(title: string, level: number): string {
    return title ? `\n${"#".repeat(level)} ${title}` : "\n";
  }

  formatSubcommand(command: string): string {
    return `\n\n${"###"} ${command}`;
  }

  createSection(name: string): string {
    return `\n${name}\n`;
  }
}
