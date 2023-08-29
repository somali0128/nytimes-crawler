const { namespaceWrapper } = require('../_koiiNode/koiiNode');
const { main, submit } = require('./nytimes');
class Submission {
  async task(round) {
    try {
      const articleListCid = await main(round);
      return articleListCid;
    } catch (err) {
      console.log('ERROR IN EXECUTING TASK', err);
      return 'ERROR IN EXECUTING TASK' + err;
    }
  }

  async submitTask(roundNumber) {
    console.log('submitTask called with round', roundNumber);
    try {
      console.log('inside try');
      console.log(
        await namespaceWrapper.getSlot(),
        'current slot while calling submit',
      );
      const submission = await this.fetchSubmission(roundNumber);
      console.log('SUBMISSION', submission);
      if (submission) {
        const response = await namespaceWrapper.checkSubmissionAndUpdateRound(
          submission,
          roundNumber,
        );
        console.log('after the submission call', response);
        return submission;
      } else {
        console.log(
          "Submission is null, that's why skipping the submission for this round",
        );
      }
    } catch (error) {
      console.log('error in submission', error);
    }
  }

  async fetchSubmission(round) {
    console.log('IN FETCH SUBMISSION');
    try {
      const submission = await submit(round);
      return submission || null;
    } catch (err) {
      console.log('ERROR IN FETCHING SUBMISSION', err);
      return 'ERROR IN FETCHING SUBMISSION' + err;
    }
  }
}
const submission = new Submission();
module.exports = { submission };
