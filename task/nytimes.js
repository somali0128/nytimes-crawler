require('dotenv').config();
const Data = require('../model/data');
const Nytimes = require('../adapters/nytimes_adapter');

async function main(round) {
    let credentials = {
        username: process.env.NYTIMES_USERNAME,
        password: process.env.NYTIMES_PASSWORD
    }

    let nytimesDB = new Data ('nytimes')
    let adapter = new Nytimes(credentials, nytimesDB, 3);

    await adapter.negotiateSession();

    await adapter.crawl(round)

    return 1;
}

module.exports = { main };