import { ESCAPE_SEQUENCES } from "https://cdn.unyt.org/datex-core-js-legacy@0.0.10/utils/logger.ts";
import { HelpGenerator } from "../types.ts";

const LIGHT_CYAN = `\x1b[38;2;${[24,78,109].join(';')}m`;

export class CommandLineHelpGenerator implements HelpGenerator {

    formatPrefix(args: string[], placeholder: string|undefined, isOptional = false) {
        const inset = args[0].startsWith("--") ? '    ' : '';
        const content  = `    ${inset}${args.map(a=>`${isOptional ? LIGHT_CYAN : ESCAPE_SEQUENCES.UNYT_CYAN}${a}${ESCAPE_SEQUENCES.RESET}`).join(", ")}${placeholder?' '+ placeholder:''}`;
        return content;
    }
    formatDescription(description: string, level: number): string {
        if (level == 1) description = '\n' + description.replace(/^/gm, '  ');
        return `${ESCAPE_SEQUENCES.UNYT_GREY}${description}${ESCAPE_SEQUENCES.RESET}`;
    }
    formatDefault(value: any): string {
        return `${ESCAPE_SEQUENCES.UNYT_GREY} (default: ${value})${ESCAPE_SEQUENCES.RESET}`;
    }
    formatTitle(title: string, level: number): string {
        if (level >= 4) return `\n    ${ESCAPE_SEQUENCES.UNYT_GREY}${title}${ESCAPE_SEQUENCES.RESET}`
        else if (level >= 3) return `\n  ${title}${ESCAPE_SEQUENCES.RESET}`
        else return `\n${ESCAPE_SEQUENCES.BOLD}${title}${ESCAPE_SEQUENCES.RESET}`
    }

    formatSubcommand(command: string): string {
       return `\n${ESCAPE_SEQUENCES.UNYT_GREEN}\n  ${command}${ESCAPE_SEQUENCES.RESET}`;
    }

    getMinSpacing(): number {
        return 4;
    }
    getEnd() {
        return `\n`;
    }

    createSection() {
        return ""
    }
}