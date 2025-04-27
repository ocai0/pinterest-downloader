import puppeteer from "puppeteer-core";

const DEFAULT_TIMER = 2000

class PuppeteerDownloader {
    browser = null

    delay(time) {
        return new Promise(function(resolve) { 
            setTimeout(resolve, time)
        });
    }

    async launchBrowser() {
        this.browser = await puppeteer.launch({
            headless: false, 
            executablePath: process.env.CHROME_PATH,
            defaultViewport: null
        })
    }

    async gotoPinterestWebsite() {
        if(!this.browser) await this.launchBrowser()
        const page = await this.browser.newPage();
        await page.goto(`https://pinterest.com/`)

        await this.delay(DEFAULT_TIMER)
    }

    async login(user, password) {
        await this.gotoPinterestWebsite()

        // clicar no botao de entrar
        // focar o campo de email
        // escrever o valor que ta no env
        // focar o campo de senha
        // escrever o valor que ta no env
        // clicar em entrar
        
        await this.delay(DEFAULT_TIMER)
    }
}


export default PuppeteerDownloader