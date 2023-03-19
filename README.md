# Command Line Argument Manager

This tool is based on <https://deno.land/std/flags/mod.ts> and provides a straightforward way to declare and parse command line options.
A help page can be automatically generated and viewed with `--help`.

## Define Command Line Options

```typescript
// create a CommandLineOptions instance
const options = new CommandLineOptions("Name of the Program/Libarary", "Describe what this program does");

// declare options and get their values
const customOptionA = options.option("optionA", {type: "boolean", description:"Describe what this option does"})
const customOptionB = options.option("optionB", {type: "string", description:"Describe what this option does", default: "default value"})
const customOptionC = options.option("optionC", {required: true, description:"Describe what this option does"})
```

## Generate the help page

The `CommandLineOptions.printHelp()` method can always be called to print all currently declared command line options.

When using the `--help` option, this method is also called in the background, and the process is stopped directly afterwards.
In this scenario, custom command line options declared during the initialization of the program mit not yet be loaded and not shown
on the help page.

For this reason, this tool allows you to generate a static help page, `RUN.md` which serves as a human readable help document, but is
also parsed by the command line argument manager to display a help page in the console when using `--help`.

To generate or update this file, start your program with the `--generate-help` option.
All options that are registered with a `CommandLineOptions` instance during the runtime of the program will be added to the `RUN.md` file.