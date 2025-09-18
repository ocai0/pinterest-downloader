import "dotenv/config"
import { program } from "commander"
import { getVersion } from "./modules/version.js"
import * as auth from "./modules/auth.js"
import { getFolderItems, saveFolderOnDisk, saveFolderLog } from "./modules/download.js";
import { deepVerify } from "./modules/file.js";
import { normalizeUrl } from "./modules/url.js";

program
    .name(`Pinterest Downloader`)
    .description(`Download pins easily`)
    .version(getVersion());

program
    .command("status")
    .description("Show if you're logged or not")
    .action(auth.printStatus);

program
    .command("download")
    .description("Download pins given a url")
    .option("-l, --limit <number>", "How many pins to download", "100")
    .option("-D, --deleteAfter", "Delete the pin from your folder (must be logged in)", false)
    .option("-i, --ignore-images", "Do not download images", false)
    .option("-v, --ignore-videos", "Do not downlaod videos", false)
    .option("-m, --ignore-metadata", "Do not create metadata files (with title and description) for the pins", false)
    .option("-r, --recursive", "Download sub folders if any", false)
    .argument("<url>", "url of the folder / user")
    .action(async (url, options) => {
        url = normalizeUrl(url);
        const folderData = await getFolderItems(url, options)
        await saveFolderLog(folderData);
        await saveFolderOnDisk(folderData, "./output", {deletePinsAfterDownload: options.deleteAfter})
    })

program
    .command("login")
    .description("Generate session token")
    .action((_, options) => auth.login());

program
    .command("verify")
    .description("Checks if has any missing pins using the log file as base")
    .argument("<folder>", "Folder name in ./output folder")
    .action((folder, options) => deepVerify(folder));


program.parse();