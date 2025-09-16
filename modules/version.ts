import chalk from "chalk"

const version = "0.1"

export function logVersion() {
    return `The version is: ${chalk.blueBright(version)}`;
}

export function getVersion() {
    return version;
}