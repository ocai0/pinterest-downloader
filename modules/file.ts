import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { PinData } from "./download.js";
import chalk from "chalk";

export async function deepVerify(folder: string | undefined) {
    if(!folder) throw new Error(`You must provide a folder name`);
    if(!existsSync(`./output/${folder}`)) return console.error(`Folder ${folder} doesn't exist in output`);
    if(!existsSync(`./logs`)) return console.error(`Folder ./logs doesn't exist`);
    const logFilesPath = (await readdir(`./logs/`)).filter(file => file.indexOf(folder) != -1);
    const logFilesContent = (await Promise.all(
            logFilesPath.map(async path => await readFile(`./logs/${path}`, {encoding: 'utf-8'}))
        ))
        .map(buffer => JSON.parse(buffer).pins as PinData[])
        .flat()
        .filter((item, index, _arr) => _arr.indexOf(item) === index);
    const filesInOutputDir = (await readdir(`./output/${folder}`));
    const fileNames = filesInOutputDir.join(", ");
    const downloadedPins = logFilesContent.reduce((map, item) => {
        if(item.media.src) {
            map.set(item.media.src, item)
        }
        return map;
    }, new Map());
    
    console.log(chalk.gray(`Based on your log files for folder "${folder}/", you should have at least ${downloadedPins.size} pins`))
    let color = chalk.green;
    if(filesInOutputDir.length < downloadedPins.size) color = chalk.red;
    console.log(color(`You have ${filesInOutputDir.length} pins downloaded`));

    for(let pin of logFilesContent) {
        if(!pin.media.src) continue;
        const filenameRegex = /\/+(?![^\/]*\/)(.*)\./g.exec(pin.media.src);
        if(!filenameRegex || !filenameRegex[1]) return;
        const filename = filenameRegex[1];
        if(fileNames.indexOf(filename) == -1) console.log(chalk.red(`Pin not found on your folder:\n - media.src: ${pin.media.src}\n - url: ${pin.url}\n`));
    }
    console.log(chalk.green(`All pins verified`));
}