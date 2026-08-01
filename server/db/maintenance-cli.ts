import { backup, checkpoint, optimize } from "./maintenance.js";
import { sqlite } from "./database.js";
const command = process.argv[2];
const invalid = !["backup", "checkpoint", "optimize"].includes(command ?? "");
const result: unknown = command === "backup" ? await backup() : command === "checkpoint" ? await checkpoint("TRUNCATE") : command === "optimize" ? await optimize() : { error: "Use backup, checkpoint, or optimize" };
console.log(JSON.stringify(result, null, 2)); sqlite.close(); if (invalid) process.exitCode = 2;
