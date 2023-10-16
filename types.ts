
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
     * default value
     */
    default?: TypeFromOptionType<T>
    aliases?: string[],
    /**
     * allow the option multiple times and collect all values in an array
     */
    multiple?: boolean,
    /**
     * throw an error if the option is not set (or a default is available)
     */
    required?: boolean,
    /**
     * if false, throw an error if type == "string" and the provided string value is empty
     * default: true
     */
    allowEmptyString?: boolean,
    /**
     * if true, add command line args without option prefixes (--[option]) to the
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
 (C['required'] extends true ? never : (hasArrayValue<C> extends true ? never : (C['default'] extends OptionConfig['default'] ? never : undefined)))
 : never;

export type OptionsConfig = {[name:string]: OptionConfig|undefined}
export type OptionsConfigValues<C extends OptionsConfig|undefined> = {[K in keyof C]: OptionValue<C[K] extends OptionConfig ? C[K] : OptionConfig>}


export type ParseOptions = {
    string: string[],
    boolean: string[],
    alias: Record<string,string>,
    default: Record<string,TypeFromOptionType<OptionType>>,
    collect: string[],
    unknown?: (arg: string, key?: string, value?: unknown) => unknown;
}

export interface HelpGenerator {
    formatPrefix(args:string[], placeholder:string | undefined, isOptional?: boolean): string
    formatDescription(description: string, level: number): string
    formatDefault(value: any): string
    formatTitle(title: string, level: number): string
    createSection(name: string): string
    formatSubcommand(command: string): string
    getPreamble?(): string
    getEnd?(): string
    getMinSpacing?():number
}
