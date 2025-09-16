import "dotenv/config"
import chalk from "chalk"
import { readFile, writeFile } from "node:fs/promises"
import { DateTime } from "luxon";
import puppeteer from "puppeteer-core";
import delay from "./delay.js";

const SELECTOR_FOR = {
    SIGN_IN: `[data-test-id="simple-login-button"]`,
    EMAIL_INPUT: `[data-test-id="emailInputField"]`,
    PASS_INPUT: `[data-test-id="passwordInputField"]`,
    LOGIN_BTN: `[data-test-id="registerFormSubmitButton"]`
}

var cookies: TGetCookies[] | undefined;
export async function printStatus() {
    try {
        const cookieData = await getCookies();
        const expirationTime = DateTime.fromSeconds(cookieData.hashMap.get("csrftoken")!.expires)
        const today = DateTime.now()
        if(expirationTime.valueOf() - today.valueOf() < 0) throw new Error(`Session Expired`)
        console.log(chalk.greenBright(`You're logged`));
        return;
    }
    catch(error) {
        console.log(chalk.redBright(`You're not logged`))
        return;
    }
}

export async function login() {
    const email = process.env.EMAIL;
    const password = process.env.PASS;
    if(!email) throw new Error(`Must provide the email`);
    if(!password) throw new Error(`Must provide the password`);
    
    const browser = await puppeteer.launch({
        headless: false, 
        executablePath: process.env.CHROME_PATH,
        defaultViewport: null
    });

    const [page] = await browser.pages();
    await page.goto("https://br.pinterest.com/")
    
    const signInBtn = await page.locator(SELECTOR_FOR.SIGN_IN)
    await signInBtn.click();

    await delay(2000);
    
    await page.waitForSelector(SELECTOR_FOR.EMAIL_INPUT);
    await page.locator(SELECTOR_FOR.EMAIL_INPUT).fill(email);
    await page.locator(SELECTOR_FOR.PASS_INPUT).fill(password);

    const logInBtn = await page.locator(SELECTOR_FOR.LOGIN_BTN)
    await logInBtn.setTimeout(3000).click();

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // Extract cookies
    const cookies = await browser.cookies();

    // Serialize cookies
    const serializedCookies = JSON.stringify(cookies);

    // Store cookies to a file
    await writeFile('session-cookies.json', serializedCookies);

    await browser.close();
}

export async function getCookies() {
    try {
        if(!cookies) {
            cookies = JSON.parse((await readFile('session-cookies.json')).toString()) as TGetCookies[];
        }
        const hashMap = cookies.reduce((map, item) => {
            map.set(item.name, item)
            return map
        }, new Map<TGetCookies["name"], TGetCookies>());

        return {cookies, hashMap};
    }
    catch(e) {
        throw new Error(`Could not obtain cookies`)
    }
}

type TGetCookies = {
    name: "_GRECAPTCHA" | "csrftoken" | "_routing_id" | "_ir" | "sessionFunnelEventLogged" | "_b" | "_immortal|deviceToken" | "timestamp" | "_auth" | "_pinterest_sess" | "__Secure-s_a",
    value: string,
    domain: string,
    path: string,
    expires: EpochTimeStamp,
    size: number,
    httpOnly: boolean,
    secure: boolean,
    session: boolean,
    sameSite: string,
    priority: string,
    sameParty: boolean,
    sourceScheme: string,
    sourcePort: number,
}