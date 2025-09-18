import Puppeteer, {Browser, Page} from 'puppeteer-core'
import { writeFile, mkdir } from "node:fs/promises"
import { exec } from "node:child_process"
import { existsSync } from "node:fs"
import { getCookies } from "./auth.js";
import delay from './delay.js';

var _browserInstance: Browser;
var cookieHashMap: Map<string, unknown>;
async function _getBrowser(): Promise<Browser> {
    const cookieData = await getCookies();
    cookieHashMap = cookieData.hashMap;
    if(!_browserInstance) _browserInstance = await Puppeteer.launch({
        headless: false, 
        executablePath: process.env.CHROME_PATH,
        defaultViewport: null
    });
    await _browserInstance.setCookie(...cookieData.cookies as any);
    return _browserInstance;
}


async function _openNewTab(): Promise<Page> {
    const BROWSER = await _getBrowser();
    let _page = await BROWSER.newPage();
    return _page;
}

export async function getFolderItems(folderUrl: string, options: {limit: number, recursive: boolean}) {
    // @ts-ignore
    let pinDownloadLimit = options.limit;
    const output = {
        pins: new Map<string, PinData>(),
        name: '',
        subfolders: [] as FolderData[]
    };
    const page = await goToURL(folderUrl);
    output.name = await getFolderName(page);
    console.log({folderName: output.name})
    let pinsFounded: Map<string, PinData> = new Map();
    console.log({pinDownloadLimit, size: pinsFounded.size})
    if(pinDownloadLimit <= 0) {
        return {
            name: output.name,
            pins: Array.from(output.pins.values()),
            subfolders: output.subfolders,
        };
    }
    while(pinDownloadLimit > pinsFounded.size) {
        console.info(`Extracting pins from current screen`)
        let {pinsMap, foldersMap} = await extractPinDataFromCurrentScreen(page, {howMany: pinDownloadLimit - pinsFounded.size})!;
        if(pinsMap) {
            for (const [key, pin] of pinsMap.entries()) pinsFounded.set(key, pin);
            if(options.recursive == false) console.log(`Ignoring folders from download logic`);
            else for (const [key, pin] of foldersMap.entries()) pinsFounded.set(key, pin);
        }
        
        console.info(`Scrolling page down`)
        await scrollPageDown(page);
        if(await reachedTheBottom(page)) break;
    }
    console.info(`Founded ${pinsFounded.size} pins, preparing the data...`)
    
    for(let [key, pinData] of pinsFounded.entries()) {
        if(pinData.type == "DELETED_PIN") {
            console.log(`Pin was deleted by it's creator, trying to recover the data`);
            try {
                const {src} = await getDeletedPinData(pinData.url);
                if(src) {
                    console.log(`Founded src ${src} for pin ${pinData.id}`);
                    pinData.type = "PIN";
                    pinData.media = { src }
                }
            }
            catch(notWorked) {
                console.error(notWorked);
            }
        }
        if(pinData.type == "PIN") {
            if(!pinData.media.src) {
                const pinResource = await getPinResource(pinData);
                if(!pinResource) continue;
                pinData.media.src = pinResource.streamUrl;
                pinData.media.storyImages = pinResource.storyImages;
            }
            pinData.media.extension = getPinExtension(pinData.media.src)?.toLowerCase() as PinData["media"]["extension"];
            pinData.media.type = pinData.media.extension 
                ? getPinType(pinData.media.extension)
                : undefined;
        }
        output.pins.set(pinData.id ?? key, pinData);
    }
    const folderList = Array.from(output.pins.values()).filter((item) => item.type === 'FOLDER');
    console.info(`All data prepared, looking for subfolders (${folderList.length})`)
    while(folderList.length > 0) {
        let folderItem = folderList.shift();
        if(!folderItem) continue;
        let folderData = await getFolderItems(folderItem.url, {limit: pinDownloadLimit - (pinsFounded.size - folderList.length), recursive: false});
        output.subfolders.push(folderData);
    }
    console.log(`Founded ${output.pins.size} pins`);
    await page.close();
    await delay(1000);
    await killBrowser();
    return {
        name: output.name,
        pins: Array.from(output.pins.values()),
        subfolders: output.subfolders,
    };
}

async function getDeletedPinData(src: string) {
    const page = await goToURL(src);
    // find edit button
    const editBtnDropdown = await page.$(`[data-test-id="closeup-action-bar-button"] button`);
    if(!editBtnDropdown) throw new Error(`Edit button dropdown not found`);
    await editBtnDropdown.click();
    await delay(500);
    
    const editPinMenuOption = await page.$(`[data-test-id="pin-action-dropdown-edit-pin"]`);
    if(!editPinMenuOption) throw new Error(`Edit pin menu option not found`);
    await editPinMenuOption.click();
    await delay(500);
    
    try { await page.waitForSelector(`[data-test-id="edit-pin-cover-box"]`) }
    catch(e) { throw new Error(`Pin image did not appear on screen`) }
    
    const recoveredPinSrc = await page.$eval(`[data-test-id="edit-pin-cover-box"] img`, (img) => img.src);
    await page.close();
    return {src : recoveredPinSrc};
}

async function killBrowser() {
    const BROWSER = await _getBrowser();
    const tabCount = (await BROWSER.pages()).length;
    if(tabCount > 1) return;
    await BROWSER.close();
    delay(500);
}
async function goToURL(url: string): Promise<Page> {
    const page = await _openNewTab();
    await page.goto(url);
    await delay(2000);
    return page;
}

async function getFolderName(tab: Page): Promise<string> {
    const title = await tab.$$eval('.mainContainer h1', (titleTagNodeList => titleTagNodeList[titleTagNodeList.length - 1].textContent));
    if(!title) throw new Error(`Could not find the title for url: ${tab.url}`)
    return title;
}

async function extractPinDataFromCurrentScreen(page: Page, options: {howMany: number}) {
    const foldersMap = new Map<string, PinData>();
    const pinsMap = new Map<string, PinData>();

    const pinsArray = await page.$$eval(`.masonryContainer`, function(pinGridArray) {
        const getPinSrcUrl = (gridItem: Element) => {
            const hasVideo = gridItem.querySelector(`video`) as HTMLVideoElement;
            const mediaBadge = gridItem.querySelector(`[data-test-id=PinTypeIdentifier]`);
            if(hasVideo) return undefined;
            if(mediaBadge && mediaBadge.textContent?.toUpperCase() != "GIF") return undefined;
            const item = gridItem.querySelector(`[data-test-id=pinWrapper] img`) as HTMLImageElement;
            if(!item || !item.srcset) return undefined;
            const data = /(https[^\s]+) 3x.*(https[^\s]+originals[^\s]+)/gm.exec(item.srcset)
            if(!data || !data[1]) return undefined;
            if(data[2].indexOf(".heic") != -1) return data[1];
            return data[2];
        }
        const getPinId = (href: string) => {
            const result = /.*\/pin\/(.*)?\//g.exec(href);
            if(!result || !result[1]) throw new Error(`Pin Id was not found (${href})`);
            return result[1];
        }
        return Promise.all(pinGridArray
            .map(pinGrid => [...pinGrid.querySelectorAll("[data-grid-item]")])
            .flat()
            .filter(gridItem => gridItem != null)
            .map((gridItem) => new Promise<PinData | null>((resolve) => {
                // @ts-ignore - because i'm only defining a variable that's gaing to be written after
                let pinData: PinData = {};
                const pinAnchorTag = gridItem.querySelector("a");
                if(!pinAnchorTag) return resolve(null);
                const isACarouselPin = gridItem.querySelector(`[data-test-id="carousel-pin"]`);
                const isADeletedPin = gridItem.querySelector(`[data-test-id="unavailable-pin"]`);
                const isAFolder = pinAnchorTag.href.indexOf("/pin/") == -1;
                if(isACarouselPin) {
                    pinData.type = 'CAROUSEL_PIN';
                    pinData.url = pinAnchorTag.href;
                    const carouselImages = [...gridItem.querySelectorAll(`[data-test-id="carousel-pin"] img`)].map((img) => (img as HTMLImageElement).src.replace("236", "736"));
                    pinData.media = {
                        storyImages: carouselImages
                    };
                    pinData.id = getPinId(pinData.url);
                }
                else if(isADeletedPin) {
                    pinData.type = 'DELETED_PIN';
                    pinData.url = pinAnchorTag.href;
                    pinData.id = getPinId(pinData.url);
                }
                else if(isAFolder) {
                    pinData.type = 'FOLDER';
                    pinData.url = pinAnchorTag.href;
                }
                else {
                    pinData.type = 'PIN';
                    pinData.url = pinAnchorTag.href;
                    pinData.id = getPinId(pinData.url);
                    pinData.text = gridItem.querySelector(`[data-test-id="pinrep-footer"] a`)?.textContent ?? undefined;
                    if(!pinData.text) pinData.text = gridItem.querySelector(`[data-test-id="related-pins-title"] div`)?.textContent ?? undefined;
                    const src = getPinSrcUrl(gridItem);
                    pinData.media = { src };
                }
                resolve(pinData);
            }))
            .filter(pin => pin != null)
        ) as Promise<PinData[]>
    });
    for(const pin of pinsArray) {
        switch(pin.type) {
            case 'DELETED_PIN':
            case 'CAROUSEL_PIN': {
                pinsMap.set(pin.id, pin);
            } break;

            case 'FOLDER': {
                const folderNameCatch = /\/([^\/]+)\/?$/g.exec(pin.url);
                if(!folderNameCatch) continue;
                foldersMap.set(folderNameCatch[1], pin);
            } break;

            case 'PIN': 
            default: {
                let pinID = pin.media.src && /\/[\d\w]{2}\/([^\/]+)\./g.exec(pin.media.src);
                if(!pinID) pinID = /pin\/([\d\w]+)/g.exec(pin.url);
                if(!pinID) throw new Error(`Pin Id not found`);
                pinsMap.set(pinID[1], pin);
            } break;
        }
    }

    return {pinsMap, foldersMap};
}

async function scrollPageDown(page: Page): Promise<void> {
    await page.evaluate(() => scrollBy(0, window.innerHeight));
    await delay(1500);
}

async function reachedTheBottom(page: Page): Promise<boolean> {
    await delay(500);
    const { scrollValue, scrollHeight } = await page.evaluate(() => {
        if(!document.scrollingElement) return {scrollValue: 0, scrollHeight: 1};
        return {
            scrollHeight: document.scrollingElement.scrollHeight, 
            scrollTop: document.scrollingElement.scrollTop, 
            windowHeight: window.innerHeight, 
            scrollValue: Math.ceil(document.scrollingElement.scrollTop + window.innerHeight)
        }
    });
    if(scrollValue >= scrollHeight) return true;
    return false;
}

async function getPinResource(pin: PinData) {
    const data = {
        options: {
            id: pin.id,
            field_set_key: "auth_web_main_pin",
            noCache: true,
            fetch_visual_search_objects: false,
            get_page_metadata: true
        },
        context: {}
    }
    const cookieHashMap = (await getCookies()).hashMap;
    const timestamp = new Date().getTime();
    const url = `https://br.pinterest.com/resource/PinResource/get/?source_url=${encodeURIComponent(`/pin/${pin.id}/`)}&data=${encodeURIComponent(JSON.stringify(data))}&_=${timestamp}`
    const headers = {
        "x-pinterest-pws-handler": "www/pin/[id].js",
        "cookie": `csrftoken=${cookieHashMap.get(`csrftoken`)!.value};_b=${cookieHashMap.get(`_b`)!.value};_auth=${cookieHashMap.get(`_auth`)!.value};_pinterest_sess=${cookieHashMap.get(`_pinterest_sess`)!.value};__Secure-s_a=${cookieHashMap.get(`__Secure-s_a`)!.value};sessionFunnelEventLogged=${cookieHashMap.get(`sessionFunnelEventLogged`)!.value};`,
    }
    const request = await fetch(url, {
        headers,
        "method": "GET"
    });

    if(!request.ok) {
        console.error(`Could not get pin data`);
        return undefined;
    }

    const _retrievedData = await request.text();
    // if(!existsSync(`logs`)) await mkdir(`logs`);
    // await writeFile(`logs/${pin.id}.log`, _retrievedData);
    // console.log(` - Log: ${pin.id}.log`)

    try {
        let response = {
            streamUrl: "",
            storyImages: [] as string[]
        };
        const { resource_response } = JSON.parse(_retrievedData);
        if(resource_response?.bodyData?.data?.story_pin_data != null) {
            response.storyImages = resource_response.bodyData.data.story_pin_data.pages.map((page: any) => page.blocks[0].image.images.originals.url);
        }
        else {
            response.streamUrl = /url"\s?\:([^},]+(m3u8|mp4|gif))/g.exec(_retrievedData)![1]?.replace("\"", "");
        }
        return response;
    }
    catch(error) {
        // console.log(`Error on getPinResource`, {pin})
        return undefined;
    }

}

function getPinType(extension: string): PinData["media"]["type"] {
    if(extension && ['png', 'jpeg', 'jpg', 'gif'].includes(extension)) return "IMAGE";
    return "VIDEO"
}

function getPinExtension(pinUrl: string) {
    const data = /\.(\w+)$/g.exec(pinUrl);
    if(!data || !data[1]) return undefined;
    return data[1];
}

// async function getFolderDestination({createIfNotExists}): string(path) {
    
// }

export async function saveFolderOnDisk(folder: FolderData, path: string, options = {deletePinsAfterDownload: false}) {
    const completePath = `${path}/${sanitizeFolderName(folder.name)}`
    if(!existsSync(completePath)) 
        await mkdir(completePath, {recursive: true})
    while(folder.pins.length) {
        const pin: PinData | undefined = folder.pins.shift();

        if(!pin || pin.type == "FOLDER") continue;
        let downloadResult: ICheckDownload;
        console.log(`\n\nStart download of pin ${pin.url}`)
        if(pin.media.storyImages?.length && pin.media.storyImages.length > 0) {
            let index = 0
            console.info(`Downloading ${pin.media.storyImages.length} images from carousel/story pin`);
            while(pin.media.storyImages.length) {
                const storyItem = pin.media.storyImages.shift();
                if(!storyItem) continue;
                const fakePin: PinData = {
                    id: `${pin.id}-${index}`,
                    type: 'PIN',
                    url: storyItem,
                    media: {
                        extension: getPinExtension(storyItem) as PinData["media"]["extension"],
                        src: storyItem,
                        type: "IMAGE"
                    }

                };
                downloadResult = await downloadImage(fakePin, undefined, completePath);
                if(downloadResult.fileWasDownloaded == false) throw new Error(`While downloading carousel/story pin something wrong ocourred:\ntype: ${pin.type}\nurl: ${pin.url}\nmedia: ${pin.media.storyImages}`)
                index++;
            }
        }
        else {
            switch(pin.media.extension) {
                case "m3u8": {
                    downloadResult = await downloadM3U8Video(pin, undefined, completePath);
                    break;
                }
                case "mp4": {
                    downloadResult = await downloadMP4Video(pin, undefined, completePath);
                    break;
                }
                default: {
                    downloadResult = await downloadImage(pin, undefined, completePath);
                    break;
                }
            }
        }
        delay(500);
        if(pin.text) {
            console.info(`Saving metadata text in ${downloadResult!.savedPinPath}.log`)
            await writeFile(`${downloadResult!.savedPinPath}.log`, pin.text)
        }
        if(!downloadResult!.fileWasDownloaded) console.info(`Something wrong ocourred`, {pin});
        else {
            console.info(` - Downloaded pin to folder "${downloadResult!.savedPinPath}"`)
            if(options.deletePinsAfterDownload) {
                console.info(` - Deleting pin: ${pin.id}`)
                // TODO: add a try/catch here
                await deletePinFromFolder(pin.id);
                console.info(` - Deleted`)
            }
        }
    }
    while(folder.subfolders.length) {
        const subfolder = folder.subfolders.shift();
        if(!subfolder) continue;
        console.info(`Downloading folder: ${subfolder.name}, with ${subfolder.pins.length} pins`);
        await saveFolderOnDisk(subfolder, `${completePath}`, options);
    }
}

async function downloadM3U8Video(pin: PinData, filename: string | undefined, path: string) {
    if(!pin.media.src) throw new Error(`Media.src is null`);
    if(!filename) {
        let name = /videos.+\/([^\/]+)\..+$/g.exec(pin.media.src);
        if(!name) filename = pin.id;
        else filename = name[1];
    }
    let index = -1
    let alreadyExistsAFile = false;
    do {
        let _filename = filename;
        if(index != -1) _filename += ` (${index})`;
        alreadyExistsAFile = await checkIfFileExists(`${path}/${_filename}.mp4`);
        if(alreadyExistsAFile) index++
    } while(alreadyExistsAFile);

    try {
        if(index != -1) filename += ` (${index})`;
        const command = `ffmpeg -y -i "${pin.media.src}" -bsf:a aac_adtstoasc -vcodec copy -c copy -crf 50 ${path}/${filename}.mp4`
        await cmd(command);
        return (checkDownload(`${path}/${filename}.mp4`));
    }
    catch(error) {
        console.error(error);
        return {
            fileWasDownloaded: false,
            savedPinPath: ""
        } as ICheckDownload
    }
}

async function downloadMP4Video(pin: PinData, filename: string | undefined, path: string) {
    if(!pin.media.src) throw new Error(`Media.src is null`);
    if(!filename) {
        let name = /videos.+\/([^\/]+)\..+$/g.exec(pin.media.src);
        if(!name) filename = pin.id;
        else filename = name[1];
    }
    try {
        const response = await fetch(pin.media.src)
        if(!response.ok) throw new Error(`Response from url "${pin.media.src}" was not ok`);
        const videoBuffer = toBuffer(await response.arrayBuffer());
        const extension = pin.media.extension
        await writeFile(`${path}/${filename}.${extension}`, videoBuffer);
        return (checkDownload(`${path}/${filename}.${extension}`));
    }
    catch(error) {
        console.error(error);
        return {
            fileWasDownloaded: false,
            savedPinPath: ""
        } as ICheckDownload
    }
}

async function downloadImage(pin: PinData, filename: string | undefined, path: string) {
    if(!pin.media.src) throw new Error(`Media.src is null`);
    if(!filename) {
        let name = /originals.+\/([^\/]+)\..+$/g.exec(pin.media.src);
        if(!name) filename = pin.id;
        else filename = name[1];
    }
    try {
        const response = await fetch(pin.media.src)
        if(!response.ok) throw new Error(`Response from url "${pin.media.src}" was not ok`);
        const imageBuffer = toBuffer(await response.arrayBuffer());
        const extension = pin.media.extension
        await writeFile(`${path}/${filename}.${extension}`, imageBuffer);
        return (checkDownload(`${path}/${filename}.${extension}`));
    }
    catch(error) {
        console.error(error);
        return {
            fileWasDownloaded: false,
            savedPinPath: ""
        } as ICheckDownload
    }
}

async function deletePinFromFolder(pinId: string) {
    const data = {
        "options": {
            "id": pinId
        },
        "context":{}
    };
    const cookieHashMap = (await getCookies()).hashMap;
    const headers = {
        "accept": "application/json, text/javascript, */*, q=0.01",
        "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,fr;q=0.6,ja;q=0.5",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "priority": "u=1, i",
        "x-csrftoken": cookieHashMap.get("csrftoken")!.value,
        "content-type": "application/x-www-form-urlencoded",
        "cookie": `csrftoken=${cookieHashMap.get("csrftoken")!.value};_b=${cookieHashMap.get("_b")!.value};_auth=${cookieHashMap.get("_auth")!.value};_pinterest_sess=${cookieHashMap.get("_pinterest_sess")!.value};__Secure-s_a=${cookieHashMap.get("__Secure-s_a")!.value};`,
    }
    const request = await fetch("https://br.pinterest.com/resource/PinResource/delete/", {
        headers,
        "body": `source_url=${encodeURIComponent(`/pin/${pinId}/`)}&data=${encodeURIComponent(`${JSON.stringify(data)}`)}`,
        "method": "POST"
    });
    const response = await request.text();
    // await writeFile(`./logs/pin-delete-${pinId}.log`, response);
}

export async function saveFolderLog(folder: FolderData) {
    if(!existsSync("logs")) await mkdir("logs");
    const filename = `folder_${sanitizeFolderName(folder.name)}_${Date.now().toString()}.json`
    await writeFile(`./logs/${filename}`, JSON.stringify(folder, null, 2))
}

function checkDownload(path: string): ICheckDownload {
    let response = {
        fileWasDownloaded: false,
        savedPinPath: path
    }
    if(existsSync(path)) response.fileWasDownloaded = true;
    return response;
}

async function checkIfFileExists(path: string) {
    return existsSync(path)
}


function toBuffer(arrayBuffer: ArrayBuffer) {
    const buffer = Buffer.alloc(arrayBuffer.byteLength);
    const view = new Uint8Array(arrayBuffer);
    for (let i = 0; i < buffer.length; ++i) {
      buffer[i] = view[i];
    }
    return buffer;
}

function cmd(command: string) {
    return new Promise((resolve, _) => 
        exec(command, (error, stdout, stderror) => {
            if(error) resolve(error)
            else if(stderror) resolve(stderror)
            else resolve(stdout)
        })
    )
}

function sanitizeFolderName(folderName: string) {
    return folderName
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\d\s\w\-]/g, "")
        .replace(/\s/g, "-")
        .replace(/-{2,}/g, "-")
        .toLowerCase();
}


// // -----------------------

export type PinData = {
    id: string;
    type: 'FOLDER' | 'PIN' | 'DELETED_PIN' | 'CAROUSEL_PIN';
    url: string;
    text?: string;
    media: {
        type?: 'VIDEO' | 'IMAGE';
        src?: string;
        storyImages?: string[];
        extension?: 'png' | 'jpeg' | 'jpg' | 'gif' | 'mp4' | 'm3u8'
    }
};

export type FolderData = {
    name: string;
    subfolders: FolderData[];
    pins: PinData[];
}

type ICheckDownload = {
    fileWasDownloaded: boolean;
    savedPinPath: string;
}