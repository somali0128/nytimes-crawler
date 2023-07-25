require('dotenv').config();
const Data = require('../model/data');
const Nytimes = require('../adapters/nytimes_adapter');

async function main() {
    let credentials = {
        username: process.env.NYTIMES_USERNAME,
        password: process.env.NYTIMES_PASSWORD
    }

    let db = new Data ('nytimes')
    let adapter = new Nytimes(credentials, db, 3);

    // await adapter.negotiateSession();

    return 1;
}

module.exports = { main };