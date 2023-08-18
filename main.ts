import {parse} from "https://deno.land/std@0.168.0/flags/mod.ts";
import {Logger, ESCAPE_SEQUENCES} from "https://dev.cdn.unyt.org/unyt_core/utils/logger.ts";
import { getCallerFile } from "https://dev.cdn.unyt.org/unyt_core/utils/caller_metadata.ts";

export type OptionType = "string" | "boolean" | "number" | "URL"
export type TypeFromOptionType<T extends OptionType> = (
    T extends "string" ? string : 
    T extends "number" ? number : 
    T extends "URL" ? URL : 
    boolean)

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
     * if the type is "boolean"
     */
    placeholder?: string,
    /**
     * def
     */
    default?: TypeFromOptionType<T>
    aliases?: string[],
    /**
     * allow the option multiple times and collect all values in an array
     */
    multiple?: boolean,
    /**
     * throw an error if the option is not set (or a defalt is available)
     */
    required?: boolean,
    /**
     * if false, throw an error if type == "string" and the provided string value is empty
     * default: true
     */
    allowEmptyString?: boolean,
    /**
     * if true, add command line args without option prefixes (--option) to the
     * list of values for this argument
     */
    collectNotPrefixedArgs?: boolean
    /**
     * don't show a warning if the option name or aliases are already used by
     * another context
     */
    overload?: boolean
}

export type OptionValue<C extends OptionConfig> = C extends OptionConfig<infer T> ? 
    _OptionsValue<C & (C['type'] extends string ? unknown : {type:"boolean"})>
    : never;

type hasArrayValue<C extends OptionConfig> = C['multiple'] extends true ? true : false;

type _OptionsValue<C extends OptionConfig> = C extends OptionConfig<infer T> ? 
  hasArrayValue<C> extends true ? TypeFromOptionType<T>[] : TypeFromOptionType<T> | 
 (C['required'] extends true ? never : (hasArrayValue<C> extends true ? never : undefined))
 : never;

export type OptionsConfig = {[name:string]: OptionConfig|undefined}
export type OptionsConfigValues<C extends OptionsConfig|undefined> = {[K in keyof C]: OptionValue<C[K] extends OptionConfig ? C[K] : OptionConfig>}


type ParseOptions = {
    string: string[],
    boolean: string[],
    alias: Record<string,string>,
    default: Record<string,TypeFromOptionType<OptionType>>,
    collect: string[],
    unknown?: (arg: string, key?: string, value?: unknown) => unknown;
}

export interface HelpGenerator {
    formatPrefix(args:string[], placeholder:string | undefined): string
    formatDescription(description: string, level: number): string
    formatDefault(value: any): string
    formatTitle(title: string, level: number): string
    getPreamble?(): string
    getEnd?(): string
    getMinSpacing?():number
}


const logger = new Logger();

export class CommandLineOptions {

    static collecting = false; // true when --generate-help called or --help without a static file
    static _collector?: ()=>any; // collector callback

    static #contexts = new Map<string, CommandLineOptions>();
    static defaultHelpFileURL = new URL("./RUN.md", "file://"+Deno.cwd()+"/");
    static #globalLockContext?: CommandLineOptions;
    static #lockedCommands = new Map<string, CommandLineOptions>();

    readonly #contextName: string
    #description?: string
    #optionConfigs: Record<string, OptionConfig|undefined> = {}
    #helpFile: URL 


    // capture args up until this point, exit afterwards
    static capture():Promise<never> {
        if (this._collector) {
            this._collector();
            return new Promise((resolve)=>setTimeout(resolve, 60_000))
        }
        else throw "command line options not collecting";
    }

    constructor(contextName: string, description?: string, helpFile?:URL|string) {
        helpFile = new URL(helpFile??"./RUN.md", getCallerFile());
        this.#contextName = contextName;
        this.#description = description;
        this.#helpFile = helpFile;
        CommandLineOptions.#contexts.set(this.#contextName, this);

        // update md file
        if (generatingStaticHelp) {
            CommandLineOptions.generateHelpMarkdownFile();
        }
    }

    /**
     * Define options for this context
     * @param options object with option names as keys, option configs as values
     * @param allowOtherOptions if false:
     *      * this and other CommandLineOptions contexts cannot define any further options or commands
     *      * an error is displayed if an option not defined in the options is used
     */
    public options<C extends OptionsConfig>(options: C, allowOtherOptions = false): OptionsConfigValues<C> {
        const def = this.#getEmptyOptionParserDefinition();

        for (const [name, config] of Object.entries(options)) {
            this.#registerOption(name, config);
            this.#addOptionConfigToParserDefinition(name, config, def);
        }

        if (!allowOtherOptions) CommandLineOptions.#globalLockContext = this;

        return this.#getArgValues(options, def, undefined, !allowOtherOptions);
    }

    /**
     * Define a command with an optional list of options
     * If the command is not used, the method returns null, otherwise
     * it returns an object containing the option values
     * @param name the name of the command
     * @param options object with option names as keys, option configs as values
     * @param allowOtherOptionsForCommand if false:
     *      * this and other CommandLineOptions contexts cannot define any further options for this command
     *      * an error is displayed if an option not defined in the options is used
     */
    public command<C extends OptionsConfig|undefined>(name: string, options?: C, allowOtherOptionsForCommand = false): OptionsConfigValues<C>|null {
        if (CommandLineOptions.#lockedCommands.has(name)) {
            logger.error(`Cannot extend command "${name}" for "${this.#contextName}". The command is used and locked by context "${CommandLineOptions.#lockedCommands.has(name) ? CommandLineOptions.#lockedCommands.get(name)!.#contextName : 'unknown'}". No additional command line options can be defined.`);
            Deno.exit(1);
        }

        const def = this.#getEmptyOptionParserDefinition();

        for (const [name, config] of Object.entries(options??<OptionsConfig>{})) {
            this.#registerOption(name, config);
            this.#addOptionConfigToParserDefinition(name, config, def);
        }

        if (!allowOtherOptionsForCommand) CommandLineOptions.#lockedCommands.set(name, this);

        return <OptionsConfigValues<C>|null> this.#getArgValues(options, def, name, !allowOtherOptionsForCommand);
    }

    /**
     * define a single command line option with name and config and get the option value
     */
    public option<C extends OptionConfig>(name: string, config?:C): OptionValue<C> {
        const def = this.#getEmptyOptionParserDefinition();
        this.#addOptionConfigToParserDefinition(name, config, def);
        this.#registerOption(name, config);
        return <OptionValue<C>> this.#getArgValues({[name]:config}, def, undefined)[name];
    }

    #getEmptyOptionParserDefinition() {
        return <ParseOptions> {
            string: [],
            boolean: [],
            alias: {},
            default: {},
            collect: []
        }
    }

    #addOptionConfigToParserDefinition(name: string, config: OptionConfig|undefined, def: ParseOptions) {
        if (config?.type == "string" || config?.type == "number" || config?.type == "URL") def.string.push(name);
        else def.boolean.push(name);
        if (config?.aliases) {
            for (const a of config?.aliases) def.alias[a] = name;
        }
        if (config?.default != undefined) def.default[name] = config.default;
        if (config?.multiple) def.collect.push(name);
    }

    #getCollectorArgForNotPrefixedArgs(options:OptionsConfig) {
        let arg:string|undefined;
        for (const [name, config] of Object.entries(options)) {
            if (config?.collectNotPrefixedArgs) {
                if (arg) {
                    logger.error(`multiple arguments are used to collect remaining non-prefixed command line arguments: ${this.#formatArgName(name)} and ${this.#formatArgName(arg)}`);
                    Deno.exit(1);
                }
                arg = name;
            }
        }
        return arg;
    }

    #getArgValues<C extends OptionsConfig|undefined, COM extends string|undefined>(options: C, def: ParseOptions, command?:COM, throwOnInvalid = false): OptionsConfigValues<C> | (COM extends string ? null : never) {
        
        let valid = true;

        const notPrefixedArgsCollector = options ? this.#getCollectorArgForNotPrefixedArgs(options) : undefined;
        const notPrefixedArgsCollectorConfig = options?.[<string>notPrefixedArgsCollector];
        const collected:string[] = [];

        if (command || throwOnInvalid || notPrefixedArgsCollector) {
            let isFirst = true;
            def.unknown = (arg: string, key?:string) => {
                if (command) {
                    if (isFirst) {
                        isFirst = false;
                        // no command
                        if (key) valid = false; 
                        // wrong command
                        if (!key && arg !== command) valid = false; 
                        return false;
                    }
                }
                
                if (notPrefixedArgsCollector && !key) {
                    // not multiple, but has more than 1 collected value
                    if (!notPrefixedArgsCollectorConfig?.multiple && collected.length) {
                        logger.error(`Too many collected arguments (${this.#formatArgName(notPrefixedArgsCollector)})`);
                        Deno.exit(1);
                    }
                    collected.push(arg);
                }
                else if (throwOnInvalid) {
                    logger.error(`Invalid command line option${command? ` for command "${command}"`:""}:\n${arg}`);
                    Deno.exit(1);
                }
                isFirst = false;
                return false;
            }
        }
        
        const parsed = parse(Deno.args, def);

        if (notPrefixedArgsCollector) {
            // multiple
            if (<any>parsed[notPrefixedArgsCollector] instanceof Array) (<any>parsed[notPrefixedArgsCollector]).push(...collected)
            // single
            else if (collected.length) (<any>parsed)[notPrefixedArgsCollector] = collected[0];
        }

        if (!valid) return <any>null;

        const values:Record<string,any> = {};

        for (const [name, config] of Object.entries(options??<OptionsConfig>{})) {
            const val = <unknown> parsed[name];
            const isMultiple = !!config?.multiple;

            if (config?.required && ((!isMultiple && val == undefined) || (isMultiple && !(<any>val).length))) {
                const [args, placeholder, description] = this.#getArg(name)!;
                logger.error(`Missing command line option${command? ` for command "${command}"`:""}:\n${commandLineHelpGenerator.formatPrefix(args, placeholder)}   ${commandLineHelpGenerator.formatDescription(description, 2)}`);
                Deno.exit(1);
            }

            if (config?.type == "string" && config?.allowEmptyString === false && (!val || !(<any>val).length)) {
                logger.error(`Invalid value for command line option ${this.#formatArgName(this.#getUsedCommandLineArgAlias(parsed, name))}: cannot be empty`);
                Deno.exit(1);
            } 

            else if (config?.type == "number") {
                values[name] = isMultiple ? (<string[]>val).map(v=>this.#validateNumber(v,parsed,name)) : this.#validateNumber(<string>val, parsed, name);
            }

            else if (config?.type == "URL") {
                values[name] = isMultiple ? (<string[]>val).map(v=>this.#validateURL(v,parsed,name)) : this.#validateURL(<string>val, parsed, name);
            }

            else values[name] = val;
        }

        return <OptionsConfigValues<C>> values;
    }

    #validateNumber(val:string, parsed:any, name: string): number|undefined {
        if (val == undefined) return val;
        if (!(<string>String(val)).match(/^[\d.]+$/)) {
            logger.error(`Invalid value for command line option ${this.#formatArgName(this.#getUsedCommandLineArgAlias(parsed, name))}: must be a number`);
            Deno.exit(1);
        }
        return parseFloat(val);
    }

    #validateURL(val:string, parsed:any, name: string): URL|undefined {
        if (val == undefined) return val;
        return new URL(val, "file://"+Deno.cwd()+"/");
    }


    #getUsedCommandLineArgAlias(parsed:Record<string,any>, name:string) {
        const nameCandidates = this.#getAliases(name, false);
        // get first occurence of arg key in parsed object -> is option alias that was used
        for (const key of Object.keys(parsed)) {
            if (nameCandidates.includes(key)) return key;
        }
        return nameCandidates[0];
    }

    #registerOption(name: string, config?: OptionConfig) {
        
        if (CommandLineOptions.#globalLockContext) {
            logger.error(`Cannot add command line options for "${this.#contextName}". Options were locked by context "${CommandLineOptions.#globalLockContext.#contextName}". No additional command line options can be defined.`);
            Deno.exit(1);
        }

        // check if duplicate option name/alias, don't display if running with --help
        if (!config?.overload && !showHelp) {
            const [existingContext, optionConfig] = this.#getContextForArgument(name);
            if (existingContext && existingContext!=this && !optionConfig.overload) logger.warn(`command line option ${this.#formatArgName(name)} is used by two different contexts: "${existingContext.#contextName}" and "${this.#contextName}"`)

            for (const alias of config?.aliases??[]) {
                const [existingContext, optionConfig] = this.#getContextForArgument(alias);
                if (existingContext && existingContext!=this && !optionConfig.overload) logger.warn(`command line option ${this.#formatArgName(alias)} is used by two different contexts: "${existingContext.#contextName}" and "${this.#contextName}"`)
            }
        }

        if (!this.#optionConfigs[name]) {
            this.#optionConfigs[name] = config;
        }
        else if (config) {
            for (const [key, val] of Object.entries(config)) {
                if (this.#optionConfigs[name]![<keyof OptionConfig>key] == undefined) {
                    this.#optionConfigs[name]![<keyof OptionConfig>key] = <any>val;
                }
            }
        }

        // update md file
        if (generatingStaticHelp) CommandLineOptions.generateHelpMarkdownFile();
    }

    #getContextForArgument(arg:string) {
        for (const [_name, context] of CommandLineOptions.#contexts) {
            // check default name
            if (arg in context.#optionConfigs) return <[CommandLineOptions, OptionConfig]>[context, context.#optionConfigs[arg]];
            // check aliases
            for (const opt of Object.values(context.#optionConfigs)) {
                if (opt?.aliases?.includes(arg)) return <[CommandLineOptions, OptionConfig]>[context, opt];
            }
        }
        return []
    }

    *#getArgs(type?:'required'|'optional') {
        for (const name of Object.keys(this.#optionConfigs)) {
            const data = this.#getArg(name, type);
            if (!data) continue;
            yield data;
        }
    }
    #getArg(name:string, type?:'required'|'optional') {
        const config = this.#optionConfigs[name];
        // @ts-ignore
        if (config?._dev) return; // ignore dev args;
        if (type == 'required' && !config?.required) return;
        if (type == 'optional' && config?.required) return;
        const args = this.#getAliases(name);
        return <[string[], string|undefined, string, any]> [args, config?.type == "boolean" ? undefined : this.#getPlacholdder(name), config?.description??"", config?.default];
    }
    #getAliases(name:string, formatted = true) {
        const config = this.#optionConfigs[name];
        const aliases = [];
        for (const a of config?.aliases??[]) aliases.push(formatted ? this.#formatArgName(a) : a);
        aliases.push(formatted ? this.#formatArgName(name): name);
        return aliases;
    }
    #getPlacholdder(name:string) {
        const config = this.#optionConfigs[name];
        if (config?.type !== "boolean" && config?.placeholder) return config.placeholder;
        else return null;
    }

    #formatArgName(name:string) {
           return (name.length == 1 ? '-':'--') + name;
    }

    static #getStringLengthWithoutFormatters(string:string) {
        return string.replace(/\x1b\[[0-9;]*m/g, '').length;
    }

    public generateHelp(generator: HelpGenerator) {
        let content = "";
        let max_prefix_size = 0;

        content += generator.formatTitle(this.#contextName, 2);
        if (this.#description) content += `\n${generator.formatDescription(this.#description, 1)}`

        const requiredArgs = [...this.#getArgs("required")];
        const optionalArgs = [...this.#getArgs("optional")];

        if (requiredArgs.length) content += "\n" + generator.formatTitle("Required", 3);
        else content += generator.formatTitle("", 3);

        for (const [args, placeholder, description, defaultVal] of requiredArgs) {
            const prefix = generator.formatPrefix(args, placeholder);
            const size = CommandLineOptions.#getStringLengthWithoutFormatters(prefix);
            if (size > max_prefix_size) max_prefix_size = size;
            const defaultText = defaultVal ? generator.formatDefault(defaultVal) : ""
            content += `\n${prefix}\x01${" ".repeat(generator.getMinSpacing?.()??1)}${generator.formatDescription(description + defaultText, 2)}`
        }

        if (requiredArgs.length && optionalArgs.length) content += "\n" + generator.formatTitle("Optional", 3);
        for (const [args, placeholder, description, defaultVal] of optionalArgs) { 
            const prefix = generator.formatPrefix(args, placeholder);
            const size = CommandLineOptions.#getStringLengthWithoutFormatters(prefix);
            if (size > max_prefix_size) max_prefix_size = size;
            const defaultText = defaultVal ? generator.formatDefault(defaultVal) : ""
            content += `\n${prefix}\x01${" ".repeat(generator.getMinSpacing?.()??1)}${generator.formatDescription(description + defaultText, 2)}`
        }

        return <[string,number]>[content, max_prefix_size];
    }

    public generateHelpMarkdownFile(log = true) {
        if (!this.#helpFile.toString().startsWith("file://")) return false; // can only save file:// paths
        if (log) logger.info("Generating help page in "+this.#helpFile.pathname+" (can be displayed with --help)")
        Deno.writeTextFileSync(this.#helpFile, CommandLineOptions.generateHelp(markdownHelpGenerator, true));
        return true;
    }

    public static printHelp(keepOrder = false) {
        console.log(this.generateHelp(commandLineHelpGenerator, keepOrder))
    }

    public static generateHelp(generator: HelpGenerator, keepOrder = false) {
        const content_array = [];
        let max_prefix_size = 0;

        let defaultOptionsContent: string|undefined; // separate content for default options (--help, ...)
        for (const e of (keepOrder ? this.#contexts.values() : [...this.#contexts.values()].toReversed())) {
            const [c, c_maxprefix_size] = e.generateHelp(generator);
            if (c_maxprefix_size > max_prefix_size) max_prefix_size = c_maxprefix_size;
            if (e == defaultOptions) defaultOptionsContent = c;
            else content_array.push(c);
        }
        // add defaultOptionsContent at the end
        if (defaultOptionsContent) content_array.push(defaultOptionsContent);

        // align descriptions right
        const content = content_array.join("\n").replace(/^.*\x01/gm, v => v.replace('\x01', '').padEnd(max_prefix_size+(v.length-this.#getStringLengthWithoutFormatters(v))));
        return (generator.getPreamble?.()??"") + content + (generator.getEnd?.()??"");
    }


    static #generating = false;

    public static generateHelpMarkdownFile(log = true) {
        // delayed / bundled generation
        if (this.#generating) return;
        this.#generating = true;
        setTimeout(()=>{
            this.#generating = false;

            if (!this.#contexts.size) logger.error("Cannot create Help file, no command line options registered");
            // only save help file for last #context, all contexts before are imported modules (assuming only static imports were used (TODO:?))
            for (const ctx of [...this.#contexts.values()].toReversed()) {
                if (ctx.#helpFile.protocol === "file:") {
                    ctx.generateHelpMarkdownFile(log);
                    return;
                }
            }
            // no custom context, just fall back to default file path
            [...this.#contexts.values()][0].generateHelpMarkdownFile(log);
        }, 1000);

   
    }

    public static parseHelpMarkdownFiles() {
        // const parsed = new Set<string>();
        // for (const ctx of this.#contexts.values()) {
        //     const file_path = ctx.#helpFile.toString();
        //     console.log(file_path, ctx.#contextName)
        //     if (parsed.has(file_path)) continue;
        //     // parsed.add(file_path);
        //     // this.parseHelpMarkdownFile(ctx.#helpFile)
        // }
        return this.parseHelpMarkdownFile(this.defaultHelpFileURL);
    }

    public static parseHelpMarkdownFile(file:URL) {
        try {
            const entries = Deno.readTextFileSync(file).split(/^## /gm);
            MarkdownGenerator.generalDescription = entries.shift()?.trim() ?? MarkdownGenerator.generalDescription;

            for (const e of entries) {
                const parts = e.split(/\n+/);
                const name = parts.shift();
                if (!name) continue;

                let description = "";
                while (!parts[0]?.startsWith("#") && !parts[0]?.startsWith(" *")) description += (description?'\n':'') + parts.shift();

                const c = this.#contexts.get(name) ?? new CommandLineOptions(name, description||undefined);

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
            return true;
        }
        catch {
            return false;
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
    formatDefault(value: any): string {
        return `${ESCAPE_SEQUENCES.UNYT_GREY} (default: ${value})${ESCAPE_SEQUENCES.RESET}`;
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
    formatDefault(value: any): string {
        return ` (default: ${value})`;
    }
    formatDescription(description: string): string {
        return description;
    }
    formatTitle(title: string,level: number): string {
        return title ? `\n${'#'.repeat(level)} ${title}` : '\n'
    }
}

const commandLineHelpGenerator = new CommandLineHelpGenerator();
const markdownHelpGenerator = new MarkdownGenerator();

let generatingStaticHelp = false;
let defaultOptions: CommandLineOptions

let showHelp = false;

if (globalThis.Deno) {
    defaultOptions = new CommandLineOptions("General Options", undefined, CommandLineOptions.defaultHelpFileURL);
    showHelp = CommandLineOptions.collecting = !!defaultOptions.option("help", {type:"boolean", aliases: ['h'], description: "Show the help page"})
    generatingStaticHelp = !!defaultOptions.option("generate-help", {type:"boolean", _dev:true, description: "Run the program with this option to update this help page"})
    if (generatingStaticHelp) {
        CommandLineOptions.collecting = true;
        addEventListener("load", CommandLineOptions._collector = ()=>{
            CommandLineOptions.generateHelpMarkdownFile();
            // terminate after some time (TODO: how to handle this)
            setTimeout(()=>Deno.exit(10), 5000);
        })
    }

    else if (showHelp) {
        const foundHelpFile = CommandLineOptions.parseHelpMarkdownFiles(); // first parse additional statically saved command line options help
        // help md file exists, print from file
        if (foundHelpFile) {
            CommandLineOptions.printHelp(true); // must always be true to print in the same order as in the markdown file
            Deno.exit(0);
        }
        // load until help available, print help afterwards
        else {
            CommandLineOptions.collecting = true;
            addEventListener("load", CommandLineOptions._collector = () => {
                CommandLineOptions.printHelp(true);
                Deno.exit(0);
            })
        }
    }
    
    // // otherwise, also generate, but keep program running
    // else {
    //     addEventListener("load", CommandLineOptions._collector = ()=>{
    //         CommandLineOptions.generateHelpMarkdownFile(false);
    //     })
    // }
        
}

