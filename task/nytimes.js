require('dotenv').config();
const fs = require('fs').promises;
const Data = require('../model/data');
const nytimesDB = new Data('nytimes');
const proofDB = new Data('proof');
proofDB.initializeData();
const Nytimes = require('../adapters/nytimes_adapter');
const { Web3Storage, File } = require('web3.storage');
const storageClient = new Web3Storage({
  token: process.env.SECRET_WEB3_STORAGE_KEY,
});
const { namespaceWrapper } = require('../_koiiNode/koiiNode');
const dataFromCid = require('../helpers/dataFromCid');
const DEBUG_MODE = process.env.DEBUG_MODE;
const LOCALE = process.env.LOCALE;

const { Connection, PublicKey } = require('@_koi/web3.js');

//Import SEARCH_TERM from env, if not present, use false
let SEARCH_TERM;

if (process.env.SEARCH_TERM == 'default') {
  SEARCH_TERM = false;
} else if (process.env.SEARCH_TERM && process.env.SEARCH_TERM.trim() !== '') {
  SEARCH_TERM = process.env.SEARCH_TERM;
} else {
  SEARCH_TERM = false;
}

const MAX_PAGES = process.env.MAX_PAGES || 10;

async function main(round) {
  let credentials = {
    username: process.env.NYTIMES_USERNAME,
    password: process.env.NYTIMES_PASSWORD,
  };

  let alterationCheck = false;

  //Decide if this round we will "alteration check" from a previous submission
  if ((round + 1) % 5 === 0) {
    let result = await articleAlterationCheck(round);
    alterationCheck = [
      result.linksArray,
      result.contentHashArray,
      result.titleArray,
      result.descriptionArray,
    ];
  }

  let adapter = alterationCheck
    ? new Nytimes(
        credentials,
        nytimesDB,
        3,
        LOCALE,
        DEBUG_MODE,
        SEARCH_TERM,
        MAX_PAGES,
        alterationCheck,
      )
    : new Nytimes(
        credentials,
        nytimesDB,
        3,
        LOCALE,
        DEBUG_MODE,
        SEARCH_TERM,
        MAX_PAGES,
      );

  await adapter.negotiateSession();

  const articleList = await adapter.crawl(round);

  const articleListMeta = JSON.stringify(articleList);
  const articleListMetaFile = new File(
    [articleListMeta],
    `articleList-round${round}.json`,
    {
      type: 'application/json',
    },
  );

  const articleListCid = await storageClient.put([articleListMetaFile]);
  await proofDB.create({ articleListCid, round });
  await adapter.stop();

  return articleListCid;
}

/**
 * Asynchronously submits proof for a given round.
 *
 * @param {number} round - Represents the specific round or iteration for which we want to submit proof.
 *
 * @returns {Promise<string>} - Returns a promise that resolves to the Content Identifier (CID) of the proof.
 */
async function submit(round) {
  try {
    // Retrieve the data associated with the current round from the proofDB.
    const dbData = await proofDB.getEverything();
    //console.log("omg", testTime);
    //const value = await proofDB.getItem(round);
    //console.log("hey", value);
    //const submission_articleListCid = value.articleListCid;
    //console.log("yo", submission_articleListCid);

    let jsonToSubmit = dbData
      .filter(item => 'articleListCid' in item)
      .reduce(
        (prev, current) => (prev.round > current.round ? prev : current),
        { round: -Infinity },
      );

    if (!jsonToSubmit) {
      jsonToSubmit = { status: 'Node is warming up!' };
    }

    // Construct the submission payload.
    const submission = {
      value: jsonToSubmit,
      // Get the public key of the main account.
      node_pubkey: await namespaceWrapper.getMainAccountPubkey(),
      // Sign the payload using the retrieved public key.
      node_signature: await namespaceWrapper.payloadSigning(jsonToSubmit),
    };

    // Save the constructed submission payload to the proofDB.
    await proofDB.create(submission);

    // Convert the submission payload to a JSON file for storage.
    const proofFile = new File(
      [JSON.stringify(submission)],
      `articleList-proof-${round}.json`,
      {
        type: 'application/json',
      },
    );

    // Store the JSON file and retrieve its CID (Content Identifier).
    const proof_cid = await storageClient.put([proofFile]);

    return proof_cid;
  } catch (err) {
    // Log any encountered errors.
    console.log('ERROR IN SUBMIT' + err);
  }
}

async function auditSubmission(submission, round) {
  const outputraw = await dataFromCid(submission);
  if (!outputraw) {
    console.log('VOTE FALSE');
    console.log('SLASH VOTE DUE TO FAKE VALUE');
    return false;
  }
  const output = outputraw.data;
  // console.log('OUTPUT', output);
  const { value, node_pubkey, node_signature } = output;
  const voteResp = await namespaceWrapper.verifySignature(
    node_signature,
    node_pubkey,
  );
  const cleanVoteRespData = voteResp.data.replace(/"/g, '');

  if (!voteResp || cleanVoteRespData !== value) {
    console.log('cleanVoteRespData', cleanVoteRespData);
    console.log('value received', value);
    console.log('VOTE FALSE');
    console.log('SLASH VOTE DUE TO DATA MISMATCH');
    return false;
  }
  const articleList = await dataFromCid(value);
  if (!articleList) {
    console.log('VOTE FALSE');
    console.log('SLASH VOTE DUE TO FAKE articleList CID');
    return false;
  }
  if (!articleList.data) {
    console.log('NO ARTICLE LIST DATA');
    return true;
  }
  // Check if the steam special is valid
  // If format of steam_special_resp.data is image, return true
  // Else return false
  if (!typeof articleList.data === 'json') {
    console.log('VOTE FALSE');
    console.log('SLASH VOTE DUE TO FAKE articleList');
    return false;
  }

  console.log('VOTE TRUE');
  return true;
}

async function articleAlterationCheck(round) {
  let choosenCid = null;
  async function getCidToCheck() {
    let dbToUse = await namespaceWrapper.getDb();
    const resp = await dbToUse.find({ articleListCid: { $exists: true } }); // An empty query object retrieves all documents
    const randomIndex = Math.floor(Math.random() * resp.length);
    return resp[randomIndex].articleListCid;
    /*  return 'bafybeiesw67pqnsejz76jpeinzujhaasy6aahr6s42i5ns5lh3uqdxwj5e'; */
  }

  choosenCid = await getCidToCheck();

  const { data: dataToCheck } = await dataFromCid(choosenCid);

  const linksArray = dataToCheck.map(item => item.link);
  console.log('linksArray', linksArray);
  const contentHashArray = dataToCheck.map(item => item.contentHash);
  const titleArray = dataToCheck.map(item => item.title);
  const descriptionArray = dataToCheck.map(item => item.description);

  return {
    linksArray: linksArray,
    contentHashArray: contentHashArray,
    titleArray: titleArray,
    descriptionArray: descriptionArray,
  };
}

module.exports = { main, submit, auditSubmission };
