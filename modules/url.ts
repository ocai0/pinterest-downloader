export function normalizeUrl(url: string) {
    if(!url) throw new Error(`You must provide a url`);
    const testRegex = /http[\w\/:\.]+pinterest.com/g.test(url);
    const sanitizedUrl = url
        .replace(/http(s)?/g, "")
        .replace(/:\/\//g, "")
        .replace(/\w+\.pinterest.com/g, "")
        return `https://pinterest.com/${sanitizedUrl}`;
}