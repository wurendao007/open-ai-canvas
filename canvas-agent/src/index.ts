#!/usr/bin/env node
import { runCli, printHelp } from "./cli.js";

const args = process.argv.slice(2);
if (!args.length) {
    printHelp(process.stdout);
    process.exitCode = 2;
} else {
    await runCli(args);
}
