import { getCallerFile } from "https://deno.land/x/caller_metadata@v0.0.1/src/main.ts";

import { CommandLineHelpGenerator } from "./generators/cli-generator.ts";
import { MarkdownGenerator } from "./generators/markdown-generator.ts";
import {
  HelpGenerator,
  OptionConfig,
  OptionsConfig,
  OptionsConfigValues,
  OptionValue,
  ParseOptions,
} from "./types.ts";
import { parse } from "https://deno.land/std@0.168.0/flags/mod.ts";
import { ESCAPE_SEQUENCES } from "./ansi.ts";

export class CommandLineOptions {
  static collecting = false; // true when --generate-help called or --help without a static file
  static _collector?: () => unknown; // collector callback

  static #contexts = new Map<string, CommandLineOptions>();
  static defaultHelpFileURL = new URL("./RUN.md", "file://" + Deno.cwd() + "/");
  static #globalLockContext?: CommandLineOptions;
  static #lockedCommands = new Map<string, CommandLineOptions>();

  readonly #contextName: string;
  #description?: string;
  #optionConfigs: Record<string, Record<string, OptionConfig | undefined>> = {};
  #helpFile: URL;

  /**
   * Capture command line option definitions up until this point during module loading.
   * This should be called before any program logic is executed.
   * When running with --help, the program exits afterwards.
   */
  static capture(): Promise<void> | void {
    if (this._collector) {
      this._collector();
      return new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    return undefined;
  }

  constructor(
    contextName: string,
    description?: string,
    helpFile?: URL | string,
  ) {
    helpFile = new URL(helpFile ?? "./RUN.md", getCallerFile());
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
  public options<C extends OptionsConfig>(
    options: C,
    allowOtherOptions = false,
  ): OptionsConfigValues<C> {
    const def = this.#getEmptyOptionParserDefinition();

    for (const [name, config] of Object.entries(options)) {
      this.#registerOption("", name, config);
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
  public command<C extends OptionsConfig | undefined>(
    name: string,
    options?: C,
    allowOtherOptionsForCommand = false,
  ): OptionsConfigValues<C> | null {
    if (CommandLineOptions.#lockedCommands.has(name)) {
      console.error(
        `${ESCAPE_SEQUENCES.RED}Cannot extend command "${name}" for "${this.#contextName}". The command is used and locked by context "${
          CommandLineOptions.#lockedCommands.has(name)
            ? CommandLineOptions.#lockedCommands.get(name)!.#contextName
            : "unknown"
        }". No additional command line options can be defined.${ESCAPE_SEQUENCES.RESET}`,
      );
      Deno.exit(1);
    }

    const def = this.#getEmptyOptionParserDefinition();

    for (
      const [optionName, config] of Object.entries(
        options ?? <OptionsConfig> {},
      )
    ) {
      this.#registerOption(name, optionName, config);
      this.#addOptionConfigToParserDefinition(optionName, config, def);
    }

    if (!allowOtherOptionsForCommand) {
      CommandLineOptions.#lockedCommands.set(name, this);
    }

    return <OptionsConfigValues<C> | null> this.#getArgValues(
      options,
      def,
      name,
      !allowOtherOptionsForCommand,
    );
  }

  /**
   * define a single command line option with name and config and get the option value
   */
  public option<C extends OptionConfig>(
    name: string,
    config?: C,
  ): OptionValue<C> {
    const def = this.#getEmptyOptionParserDefinition();
    this.#addOptionConfigToParserDefinition(name, config, def);
    this.#registerOption("", name, config);
    return <OptionValue<C>> this.#getArgValues(
      { [name]: config },
      def,
      undefined,
    )[name];
  }

  #getEmptyOptionParserDefinition() {
    return <ParseOptions> {
      string: [],
      boolean: [],
      alias: {},
      default: {},
      collect: [],
    };
  }

  #addOptionConfigToParserDefinition(
    name: string,
    config: OptionConfig | undefined,
    def: ParseOptions,
  ) {
    if (
      config?.type == "string" || config?.type == "number" ||
      config?.type == "URL"
    ) def.string.push(name);
    else def.boolean.push(name);
    if (config?.aliases) {
      for (const a of config?.aliases) def.alias[a] = name;
    }
    if (config?.default != undefined) def.default[name] = config.default;
    if (config?.multiple) def.collect.push(name);
  }

  #getCollectorArgForNotPrefixedArgs(options: OptionsConfig) {
    let arg: string | undefined;
    for (const [name, config] of Object.entries(options)) {
      if (config?.collectNotPrefixedArgs) {
        if (arg) {
          console.error(
            `${ESCAPE_SEQUENCES.RED}Multiple arguments are used to collect remaining non-prefixed command line arguments: ${
              this.#formatArgName(name)
            } and ${this.#formatArgName(arg)}${ESCAPE_SEQUENCES.RESET}`,
          );
          Deno.exit(1);
        }
        arg = name;
      }
    }
    return arg;
  }

  #getArgValues<
    C extends OptionsConfig | undefined,
    COM extends string | undefined,
  >(
    options: C,
    def: ParseOptions,
    command?: COM,
    throwOnInvalid = false,
  ): OptionsConfigValues<C> | (COM extends string ? null : never) {
    let valid = true;

    const notPrefixedArgsCollector = options
      ? this.#getCollectorArgForNotPrefixedArgs(options)
      : undefined;
    const notPrefixedArgsCollectorConfig = options
      ?.[<string> notPrefixedArgsCollector];
    const collected: string[] = [];

    if (command || throwOnInvalid || notPrefixedArgsCollector) {
      let isFirst = true;
      def.unknown = (arg: string, key?: string) => {
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
            console.error(
              `${ESCAPE_SEQUENCES.RED}Too many collected arguments (${
                this.#formatArgName(notPrefixedArgsCollector)
              })${ESCAPE_SEQUENCES.RESET}`,
            );
            Deno.exit(1);
          }
          collected.push(arg);
        } else if (throwOnInvalid && !showHelp && !generatingStaticHelp) {
          console.error(
            `${ESCAPE_SEQUENCES.RED}Invalid command line option${
              command ? ` for command "${command}"` : ""
            }:\n${arg}${ESCAPE_SEQUENCES.RESET}`,
          );
          Deno.exit(1);
        }
        isFirst = false;
        return false;
      };
    }

    const parsed = parse(Deno.args, def) as any;

    if (notPrefixedArgsCollector) {
      // multiple
      if (parsed[notPrefixedArgsCollector] instanceof Array) {
        parsed[notPrefixedArgsCollector].push(...collected);
      } // single
      else if (collected.length) {
        parsed[notPrefixedArgsCollector] = collected[0];
      }
    }

    if (!valid) return <any> null;

    const values: Record<string, unknown> = {};

    for (
      const [name, config] of Object.entries(options ?? <OptionsConfig> {})
    ) {
      const val = <unknown> parsed[name];
      const isMultiple = !!config?.multiple;

      if (
        !showHelp && !generatingStaticHelp && config?.required &&
        ((!isMultiple && val == undefined) ||
          (isMultiple && !(<any> val).length))
      ) {
        const [args, placeholder, description] = this.#getArg(name)!;
        console.error(
          `${ESCAPE_SEQUENCES.RED}Missing command line option${
            command ? ` for command "${command}"` : ""
          }:\n${
            CommandLineOptions.commandLineHelpGenerator.formatPrefix(
              args,
              placeholder,
            )
          }   ${
            CommandLineOptions.commandLineHelpGenerator.formatDescription(
              description,
              2,
            )
          }${ESCAPE_SEQUENCES.RESET}`,
        );
        Deno.exit(1);
      }

      if (
        !showHelp && !generatingStaticHelp && config?.type == "string" &&
        config?.allowEmptyString === false && (!val || !(<any> val).length)
      ) {
        console.error(
          `${ESCAPE_SEQUENCES.RED}Invalid value for command line option ${
            this.#formatArgName(this.#getUsedCommandLineArgAlias(parsed, name))
          }: cannot be empty${ESCAPE_SEQUENCES.RESET}`,
        );
        Deno.exit(1);
      } else if (config?.type == "number") {
        values[name] = isMultiple
          ? (<string[]> val).map((v) => this.#validateNumber(v, parsed, name))
          : this.#validateNumber(<string> val, parsed, name);
      } else if (config?.type == "URL") {
        values[name] = isMultiple
          ? (<string[]> val).map((v) => this.#validateURL(v))
          : this.#validateURL(<string> val);
      } else values[name] = val;
    }

    return <OptionsConfigValues<C>> values;
  }

  #validateNumber(
    val: string,
    parsed: Record<string, unknown>,
    name: string,
  ): number | undefined {
    if (val == undefined) return val;
    if (!(<string> String(val)).match(/^[\d.]+$/)) {
      console.error(
        `${ESCAPE_SEQUENCES.RED}Invalid value for command line option ${
          this.#formatArgName(this.#getUsedCommandLineArgAlias(parsed, name))
        }: must be a number${ESCAPE_SEQUENCES.RESET}`,
      );
      Deno.exit(1);
    }
    return parseFloat(val);
  }

  #validateURL(val: string): URL | undefined {
    if (val == undefined) return val;
    return new URL(val, "file://" + Deno.cwd() + "/");
  }

  #getUsedCommandLineArgAlias(parsed: Record<string, unknown>, name: string) {
    const nameCandidates = this.#getAliases(name, false);
    // get first occurence of arg key in parsed object -> is option alias that was used
    for (const key of Object.keys(parsed)) {
      if (nameCandidates.includes(key)) return key;
    }
    return nameCandidates[0];
  }

  #registerOption(commandName = "", name: string, config?: OptionConfig) {
    if (CommandLineOptions.#globalLockContext) {
      console.error(
        `${ESCAPE_SEQUENCES.RED}Cannot add command line options for "${this.#contextName}". Options were locked by context "${CommandLineOptions.#globalLockContext.#contextName}". No additional command line options can be defined.${ESCAPE_SEQUENCES.RESET}`,
      );
      Deno.exit(1);
    }

    // check if duplicate option name/alias, don't display if running with --help
    if (!config?.overload && !showHelp && !generatingStaticHelp) {
      const [existingContext, optionConfig] = this.#getContextForArgument(name);
      if (
        existingContext && existingContext != this && !optionConfig.overload
      ) {
        console.warn(
          `${ESCAPE_SEQUENCES.YELLOW}command line option ${
            this.#formatArgName(name)
          } is used by two different contexts: "${existingContext.#contextName}" and "${this.#contextName}"${ESCAPE_SEQUENCES.RESET}`,
        );
      }

      for (const alias of config?.aliases ?? []) {
        const [existingContext, optionConfig] = this.#getContextForArgument(
          alias,
        );
        if (
          existingContext && existingContext != this && !optionConfig.overload
        ) {
          console.warn(
            `${ESCAPE_SEQUENCES.YELLOW}command line option ${
              this.#formatArgName(alias)
            } is used by two different contexts: "${existingContext.#contextName}" and "${this.#contextName}"${ESCAPE_SEQUENCES.RESET}`,
          );
        }
      }
    }

    if (!this.#optionConfigs[commandName]) {
      this.#optionConfigs[commandName] = {};
    }

    if (!this.#optionConfigs[commandName][name]) {
      this.#optionConfigs[commandName][name] = config;
    } else if (config) {
      for (const [key, val] of Object.entries(config)) {
        if (
          this.#optionConfigs[commandName][name]![<keyof OptionConfig> key] ==
            undefined
        ) {
          this.#optionConfigs[commandName][name]![<keyof OptionConfig> key] =
            val as any;
        }
      }
    }

    // update md file
    if (generatingStaticHelp) CommandLineOptions.generateHelpMarkdownFile();
  }

  #getContextForArgument(arg: string) {
    for (const [_name, context] of CommandLineOptions.#contexts) {
      const optionConfigs = this.#getSubcommandOptions();
      // check default name
      if (arg in optionConfigs) {
        return <[CommandLineOptions, OptionConfig]> [
          context,
          optionConfigs[arg],
        ];
      }
      // check aliases
      for (const opt of Object.values(optionConfigs)) {
        if (opt?.aliases?.includes(arg)) {
          return <[CommandLineOptions, OptionConfig]> [context, opt];
        }
      }
    }
    return [];
  }

  *#getArgs(type?: "required" | "optional", subcommand?: string) {
    for (const name of Object.keys(this.#getSubcommandOptions(subcommand))) {
      const data = this.#getArg(name, type, subcommand);
      if (!data) continue;
      yield data;
    }
  }
  #getArg(name: string, type?: "required" | "optional", subcommand?: string) {
    const config = this.#getSubcommandOptions(subcommand)[name];
    // @ts-ignore
    if (config?._dev) return; // ignore dev args;
    if (type == "required" && !config?.required) return;
    if (type == "optional" && config?.required) return;
    const args = this.#getAliases(name, true, subcommand);
    return <[string[], string | undefined, string, unknown]> [
      args,
      config?.type == "boolean"
        ? undefined
        : this.#getPlaceholder(name, subcommand),
      config?.description ?? "",
      config?.default,
    ];
  }
  #getAliases(name: string, formatted = true, subcommand?: string) {
    const config = this.#getSubcommandOptions(subcommand)[name];
    const aliases = [];
    for (const a of config?.aliases ?? []) {
      aliases.push(formatted ? this.#formatArgName(a) : a);
    }
    aliases.push(formatted ? this.#formatArgName(name) : name);
    return aliases;
  }
  #getPlaceholder(name: string, subcommand?: string) {
    const config = this.#getSubcommandOptions(subcommand)[name];
    if (config?.type !== "boolean" && config?.placeholder) {
      return config.placeholder;
    } else return null;
  }

  #getSubcommandOptions(subcommand?: string) {
    const all: Record<string, OptionConfig | undefined> = {};
    for (const [commandName, options] of Object.entries(this.#optionConfigs)) {
      if (subcommand !== undefined && commandName !== subcommand) continue;
      Object.assign(all, options);
    }
    return all;
  }

  #formatArgName(name: string) {
    return (name.length == 1 ? "-" : "--") + name;
  }

  get #subcommands() {
    return Object.keys(this.#optionConfigs);
  }

  static #getStringLengthWithoutFormatters(string: string) {
    // deno-lint-ignore no-control-regex
    return string.replace(/\x1b\[[0-9;]*m/g, "").length;
  }

  public generateHelp(generator: HelpGenerator) {
    let content = "";
    let max_prefix_size = 0;

    content += generator.formatTitle(this.#contextName, 2);
    if (this.#description) {
      content += `\n${generator.formatDescription(this.#description, 1)}\n`;
    }

    const subcommands = this.#subcommands;

    for (const subcommand of subcommands) {
      const requiredArgs = [...this.#getArgs("required", subcommand)];
      const optionalArgs = [...this.#getArgs("optional", subcommand)];

      if (subcommand) content += generator.formatSubcommand(subcommand);

      if (requiredArgs.length && optionalArgs.length) {
        content += generator.createSection("Required:");
      }

      for (const [args, placeholder, description, defaultVal] of requiredArgs) {
        const prefix = generator.formatPrefix(args, placeholder);
        const size = CommandLineOptions.#getStringLengthWithoutFormatters(
          prefix,
        );
        if (size > max_prefix_size) max_prefix_size = size;
        const defaultText = defaultVal
          ? generator.formatDefault(defaultVal)
          : "";
        content += `\n${prefix}\x01${
          " ".repeat(generator.getMinSpacing?.() ?? 1)
        }${generator.formatDescription(description + defaultText, 2)}`;
      }

      if (optionalArgs.length) {
        content += generator.createSection("\nOptional:");
      }

      for (const [args, placeholder, description, defaultVal] of optionalArgs) {
        const prefix = generator.formatPrefix(args, placeholder, true);
        const size = CommandLineOptions.#getStringLengthWithoutFormatters(
          prefix,
        );
        if (size > max_prefix_size) max_prefix_size = size;
        const defaultText = defaultVal
          ? generator.formatDefault(defaultVal)
          : "";
        content += `\n${prefix}\x01${
          " ".repeat(generator.getMinSpacing?.() ?? 1)
        }${generator.formatDescription(description + defaultText, 2)}`;
      }
    }

    return <[string, number]> [content, max_prefix_size];
  }

  public generateHelpMarkdownFile(log = true) {
    if (!this.#helpFile.toString().startsWith("file://")) return false; // can only save file:// paths
    if (log) {
      console.log(
        "Generating help page in " + this.#helpFile.pathname +
          " (can be displayed with --help)",
      );
    }
    Deno.writeTextFileSync(
      this.#helpFile,
      CommandLineOptions.generateHelp(
        CommandLineOptions.markdownHelpGenerator,
        true,
      ),
    );
    return true;
  }

  public static printHelp(keepOrder = false) {
    console.log(
      this.generateHelp(CommandLineOptions.commandLineHelpGenerator, keepOrder),
    );
  }

  public static generateHelp(generator: HelpGenerator, keepOrder = false) {
    const content_array = [];
    let max_prefix_size = 0;

    let defaultOptionsContent: string | undefined; // separate content for default options (--help, ...)
    for (
      const e
        of (keepOrder
          ? this.#contexts.values()
          : [...this.#contexts.values()].toReversed())
    ) {
      const [c, c_maxprefix_size] = e.generateHelp(generator);
      if (c_maxprefix_size > max_prefix_size) {
        max_prefix_size = c_maxprefix_size;
      }
      if (e == defaultOptions) defaultOptionsContent = c;
      else content_array.push(c);
    }
    // add defaultOptionsContent at the end
    if (defaultOptionsContent) content_array.push(defaultOptionsContent);

    // align descriptions right
    // deno-lint-ignore no-control-regex
    const content = content_array.join("\n").replace(
      /^.*\x01/gm,
      (v) =>
        v.replace("\x01", "").padEnd(
          max_prefix_size +
            (v.length - this.#getStringLengthWithoutFormatters(v)),
        ),
    );
    return (generator.getPreamble?.() ?? "") + content +
      (generator.getEnd?.() ?? "");
  }

  static #generating = false;

  public static generateHelpMarkdownFile(log = true) {
    // delayed / bundled generation
    if (this.#generating) return;
    this.#generating = true;
    setTimeout(() => {
      this.#generating = false;

      if (!this.#contexts.size) {
        console.error(
          `${ESCAPE_SEQUENCES.RED}Cannot create Help file, no command line options registered${ESCAPE_SEQUENCES.RESET}`,
        );
      }
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

  public static parseHelpMarkdownFile(file: URL) {
    try {
      const entries = Deno.readTextFileSync(file).split(/^## /gm);
      MarkdownGenerator.generalDescription = entries.shift()?.trim() ??
        MarkdownGenerator.generalDescription;

      for (const e of entries) {
        const parts = e.split(/\n+/);
        const name = parts.shift();
        if (!name) continue;

        let description = "";
        while (
          !parts[0]?.startsWith("#") && !parts[0]?.startsWith(" *") &&
          !parts[0]?.startsWith("Required:") &&
          !parts[0]?.startsWith("Optional:")
        ) description += (description ? "\n" : "") + parts.shift();

        const c = this.#contexts.get(name) ??
          new CommandLineOptions(name, description || undefined);

        let required = true;
        let currentCommand = "";
        for (const part of parts) {
          // required/optional sections
          if (part.startsWith("###")) {
            currentCommand = part.replace("###", "").trim();
            continue;
          }
          if (part.startsWith("Required:")) continue;
          if (part.startsWith("Optional:")) {
            required = false;
            continue;
          }

          // invalid line, ignore
          if (!part.trim().startsWith("*")) continue;

          const line = part.match(/`(.*)` *(.*$)/);
          if (!line) continue;
          const description = line[2];
          let placeholder: string | undefined;
          const aliases = line[1]?.split(",")?.map((a) => {
            const parts = a.trim().split(" ");
            if (parts[1]) placeholder = parts[1];
            return parts[0].replace(/^\-+/, "");
          });
          if (!aliases) continue;
          const name = aliases.pop();
          if (!name) continue;
          c.#registerOption(currentCommand, name, {
            aliases,
            required,
            placeholder,
            description,
          });
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  static commandLineHelpGenerator = new CommandLineHelpGenerator();
  static markdownHelpGenerator = new MarkdownGenerator();
}

let generatingStaticHelp = false;
let defaultOptions: CommandLineOptions;
let showHelp = false;

if (globalThis.Deno) {
  defaultOptions = new CommandLineOptions(
    "Other Options",
    undefined,
    CommandLineOptions.defaultHelpFileURL,
  );
  showHelp = CommandLineOptions.collecting = !!defaultOptions.option("help", {
    type: "boolean",
    aliases: ["h"],
    description: "Show the help page",
  });
  generatingStaticHelp = !!defaultOptions.option("generate-help", {
    type: "boolean",
    _dev: true,
    description: "Run the program with this option to update this help page",
  });
  if (generatingStaticHelp) {
    CommandLineOptions.collecting = true;
    addEventListener(
      "load",
      CommandLineOptions._collector = () => {
        CommandLineOptions.generateHelpMarkdownFile();
      },
    );
  } else if (showHelp) {
    const foundHelpFile = CommandLineOptions.parseHelpMarkdownFiles(); // first parse additional statically saved command line options help
    // help md file exists, print from file
    if (foundHelpFile) {
      CommandLineOptions.printHelp(true); // must always be true to print in the same order as in the markdown file
      Deno.exit(0);
    } // load until help available, print help afterwards
    else {
      CommandLineOptions.collecting = true;
      addEventListener(
        "load",
        CommandLineOptions._collector = () => {
          CommandLineOptions.printHelp(true);
          Deno.exit(0);
        },
      );
    }
  }
}
