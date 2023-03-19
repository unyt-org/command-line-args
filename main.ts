import {parse} from "https://deno.land/std@0.168.0/flags/mod.ts";
import {Logger, ESCAPE_SEQUENCES} from "unyt_core/utils/logger.ts";

export type OptionType = "string" | "boolean"
export type TypeFromOptionType<T extends OptionType> = (T extends "string" ? string : boolean)

export type OptionConfig<T extends OptionType = OptionType> = {
    /**
     * The description displayed in the help view
     */
    description?: string,
    /**
     * "string" if the option requires a value,
     * "boolean" if the option can be either set or not set
     * default: "string"
     */
    type?: T,
    /**
     * Placeholder label for value in the help view, only displayed
     * if the type is "string"
     */
    placeholder?: string,
    /**
     * def
     */
    default?: TypeFromOptionType<T>
    aliases?: string[],
    multiple?: boolean,
    required?: boolean
}

export type OptionValue<C extends OptionConfig> = C extends OptionConfig<infer T> ? (
    (C['multiple'] extends true ? TypeFromOptionType<T>[] : TypeFromOptionType<T>) | (C['required'] extends true ? never : (C['default'] extends null|undefined|void ? undefined : never))
): never;

export interface HelpGenerator {
    formatPrefix(args:string[], placeholder:string | undefined): string
    formatDescription(description: string, level: number): string
    formatTitle(title: string, level: number): string
    getPreamble?(): string
    getEnd?(): string
    getMinSpacing?():number
}


const logger = new Logger();

export class CommandLineOptions {

    static #entries = new Map<string, CommandLineOptions>();
    static helpFileURL = new URL("./RUN.md", "file://"+Deno.cwd()+"/");

    readonly #name: string
    #description?: string
    #options: Record<string, OptionConfig|undefined> = {}

    constructor(name: string, description?: string) {
        this.#name = name;
        this.#description = description;
        CommandLineOptions.#entries.set(this.#name, this);
    }

    public option<C extends OptionConfig>(name: string, config?:C): (OptionValue<C & (C['type'] extends string ? unknown : {type:"string"})>) & (string|unknown){
        this.#registerOption(name, config);

        const string = [];
        const boolean = [];
        const collect = [];
        const alias:Record<string,string> = {};

        const def: Record<string,string|boolean> = {};
        if (config?.type == "string") string.push(name);
        else boolean.push(name);
        if (config?.aliases) {
            for (const a of config?.aliases) alias[a] = name;
        }
        if (config?.default) def[name] = config?.default;
        if (config?.multiple) collect.push(name);

        const parsed = parse(Deno.args, {
            string,
            boolean,
            alias,
            default: def,
            collect
        })
        const val = parsed[name];

        if (config?.required && ((!config?.multiple && val == undefined) || (config?.multiple && !(<any>val).length))) {
            const [args, placeholder, description] = this.#getArg(name)!;
            logger.error(`Missing command line option:\n${commandLineHelpGenerator.formatPrefix(args, placeholder)}   ${commandLineHelpGenerator.formatDescription(description, 2)}`);
            Deno.exit(1);
        }

        return parsed[name];
    }

    #registerOption(name: string, config?: OptionConfig) {
        if (!this.#options[name]) {
            this.#options[name] = config;
        }
        else if (config) {
            for (const [key, val] of Object.entries(config)) {
                if (this.#options[name]![<keyof OptionConfig>key] == undefined) {
                    this.#options[name]![<keyof OptionConfig>key] = <any>val;
                }
            }
        }
    }

    *#getArgs(type?:'required'|'optional') {
        for (const name of Object.keys(this.#options)) {
            const data = this.#getArg(name, type);
            if (!data) continue;
            yield data;
        }
    }
    #getArg(name:string, type?:'required'|'optional') {
        const config = this.#options[name];
        // @ts-ignore
        if (config?._dev) return; // ignore dev args;
        if (type == 'required' && !config?.required) return;
        if (type == 'optional' && config?.required) return;
        const args = this.#getAliases(name);
        return <[string[], string|undefined, string]> [args, config?.type == "boolean" ? undefined : this.#getPlacholdder(name), config?.description??""];
    }
    #getAliases(name:string) {
        const config = this.#options[name];
        const aliases = [];
        for (const a of config?.aliases??[]) aliases.push((a.length == 1 ? '-':'--') + a);
        aliases.push((name.length == 1 ? '-':'--') + name);
        return aliases;
    }
    #getPlacholdder(name:string) {
        const config = this.#options[name];
        if (config?.type !== "boolean" && config?.placeholder) return config.placeholder.toUpperCase(); 
        else return null;
    }
    #getDescription(name:string) {
        const config = this.#options[name];
        return config?.description??"";
    }


    #formatArg(name:string) {
        const args = this.#getAliases(name);
        const placeholder = this.#getPlacholdder(name);
        const description = this.#getDescription(name);

        let formatted = args.join(", ")
        if (placeholder) formatted += ` ${placeholder}`;
        if (description) formatted += ` : ${description}`;

        return formatted;
    }

    static #getStringLengthWithoutFormatters(string:string) {
        return string.replace(/\x1b\[[0-9;]*m/g, '').length;
    }

    public generateHelp(generator: HelpGenerator) {
        let content = "";
        let max_prefix_size = 0;

        content += generator.formatTitle(this.#name, 2);
        if (this.#description) content += `\n${generator.formatDescription(this.#description, 1)}`

        const requiredArgs = [...this.#getArgs("required")];
        const optionalArgs = [...this.#getArgs("optional")];

        if (requiredArgs.length) content += "\n" + generator.formatTitle("Required", 3);
        for (const [args, placeholder, description] of requiredArgs) {
            const prefix = generator.formatPrefix(args, placeholder);
            const size = CommandLineOptions.#getStringLengthWithoutFormatters(prefix);
            if (size > max_prefix_size) max_prefix_size = size;
            content += `\n${prefix}\x01${" ".repeat(generator.getMinSpacing?.()??1)}${generator.formatDescription(description, 2)}`
        }

        if (requiredArgs.length && optionalArgs.length) content += "\n" + generator.formatTitle("Optional", 3);
        for (const [args, placeholder, description] of optionalArgs) { 
            const prefix = generator.formatPrefix(args, placeholder);
            const size = CommandLineOptions.#getStringLengthWithoutFormatters(prefix);
            if (size > max_prefix_size) max_prefix_size = size;
            content += `\n${prefix}\x01${" ".repeat(generator.getMinSpacing?.()??1)}${generator.formatDescription(description, 2)}`
        }

        return <[string,number]>[content, max_prefix_size];
    }

    public parseHelpMarkdownContent(content:string) {
        

    }

    public static printHelp() {
        logger.plain(this.generateHelp(commandLineHelpGenerator))
    }

    public static generateHelp(generator: HelpGenerator) {
        const content_array = [];
        let max_prefix_size = 0;

        for (const e of [...this.#entries.values()].toReversed()) {
            const [c, c_maxprefix_size] = e.generateHelp(generator);
            if (c_maxprefix_size > max_prefix_size) max_prefix_size = c_maxprefix_size;
            content_array.push(c);
        }

        // align descriptions right
        const content = content_array.join("\n").replace(/^.*\x01/gm, v => v.replace('\x01', '').padEnd(max_prefix_size+(v.length-this.#getStringLengthWithoutFormatters(v))));
        return (generator.getPreamble?.()??"") + content + (generator.getEnd?.()??"");
    }

    public static parseHelpMarkdownFile() {
        try {
            const entries = Deno.readTextFileSync(this.helpFileURL).split(/^## /gm);
            MarkdownGenerator.generalDescription = entries.shift()?.trim() ?? MarkdownGenerator.generalDescription;

            for (const e of entries) {
                const parts = e.split(/\n+/);
                const name = parts.shift();
                if (!name) continue;

                let description = "";
                while (!parts[0]?.startsWith("#") && !parts[0]?.startsWith(" *")) description += (description?'\n':'') + parts.shift();

                const c = this.#entries.get(name) ?? new CommandLineOptions(name, description||undefined);

                let required = false;
                for (const part of parts) {
                    // required/optional sections
                    if (part.startsWith("### Required")) {
                        required = true;
                        continue;
                    }
                    if (part.startsWith("### Optional")) {
                        required = false;
                        continue;
                    }
                    // invalid line, ignore
                    if (!part.trim().startsWith("*")) continue;
                    
                    const line = part.match(/`(.*)` *(.*$)/);
                    if (!line) continue;
                    const description = line[2];
                    let placeholder:string|undefined
                    const aliases = line[1]?.split(",")?.map(a=>{
                        const parts = a.trim().split(" ");
                        if (parts[1]) placeholder = parts[1];
                        return parts[0].replace(/^\-+/,'');
                    });
                    if (!aliases) continue;
                    const name = aliases.pop();
                    if (!name) continue;
                    c.#registerOption(name, {aliases, required, placeholder, description})
                }

                
            }
        }
        catch {
            // ignore if file does not exist
        }
    }
} 


export class CommandLineHelpGenerator implements HelpGenerator {
    // getPreamble() {
    //     return `\n`;
    // }
    formatPrefix(args: string[],placeholder: string|undefined) {
        const inset = args[0].startsWith("--") ? '    ' : '';
        const content  = `    ${inset}${args.map(a=>`${ESCAPE_SEQUENCES.UNYT_CYAN}${a}${ESCAPE_SEQUENCES.RESET}`).join(", ")}${placeholder?' '+ placeholder:''}`;
        return content;
    }
    formatDescription(description: string, level: number): string {
        if (level == 1) description = '\n' + description.replace(/^/gm, '  ');
        return `${ESCAPE_SEQUENCES.UNYT_GREY}${description}${ESCAPE_SEQUENCES.RESET}`;
    }
    formatTitle(title: string,level: number): string {
        if (level >= 3) return `\n  ${title}${ESCAPE_SEQUENCES.RESET}`
        else return `\n${ESCAPE_SEQUENCES.BOLD}${title}${ESCAPE_SEQUENCES.RESET}`
    }
    getMinSpacing(): number {
        return 4;
    }
    getEnd() {
        return `\n`;
    }
}

export class MarkdownGenerator implements HelpGenerator {

    static generalDescription = `# Run Options\nThis file contains an auto-generated list of the available command line options.`

    getPreamble() {
        return `${MarkdownGenerator.generalDescription}\n`;
    }
    formatPrefix(args: string[],placeholder: string|undefined) {
        return ` * \`${args.join(", ")}${placeholder?' '+ placeholder:''}\``;
    }
    formatDescription(description: string): string {
        return description;
    }
    formatTitle(title: string,level: number): string {
        return `\n${'#'.repeat(level)} ${title}`
    }
}

const commandLineHelpGenerator = new CommandLineHelpGenerator();


const internalOptions = new CommandLineOptions("General Options");
const help = internalOptions.option("help", {type:"boolean", aliases: ['h'], description: "Show the help page"})
const generateStaticHelp = internalOptions.option("generate-help", {type:"boolean", _dev:true, description: "Run the program with this option to update this help page"})

if (generateStaticHelp) {
    addEventListener("load", ()=>{
        Deno.writeTextFileSync(CommandLineOptions.helpFileURL, CommandLineOptions.generateHelp(new MarkdownGenerator()));
        logger.success("Generated help page in RUN.md (can be displayed with --help)")
        Deno.exit(10);
    })
}

else if (help) {
    CommandLineOptions.parseHelpMarkdownFile(); // first parse additional statically saved command line options help
    CommandLineOptions.printHelp();
    Deno.exit(0);
}