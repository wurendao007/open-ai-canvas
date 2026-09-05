import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(webDir, "../plugins/kraftreel");
const outputPath = resolve(webDir, "public/cli/latest/kraftreel-cli-skill.zip");

function collectFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolute = join(directory, entry.name);
        return entry.isDirectory() ? collectFiles(absolute) : [absolute];
    });
}

const archive = {};
for (const file of collectFiles(sourceDir)) {
    const archivePath = join("kraftreel-cli", relative(sourceDir, file)).replaceAll("\\", "/");
    archive[archivePath] = readFileSync(file);
}

mkdirSync(dirname(outputPath), { recursive: true });
for (const extension of ["sh", "ps1", "cmd"]) {
    copyFileSync(join(sourceDir, "scripts", `install-kraftreel-cli.${extension}`), resolve(webDir, "public/cli/latest", `install-kraftreel-cli.${extension}`));
}
writeFileSync(outputPath, zipSync(archive, { level: 6 }));
console.log(`Generated ${relative(webDir, outputPath)} (${statSync(outputPath).size} bytes)`);
