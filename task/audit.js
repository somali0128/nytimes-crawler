const { namespaceWrapper } = require('../_koiiNode/koiiNode');
const { auditSubmission } = require('./nytimes');

class Audit {
  async validateNode(submission_value, round) {

    console.log('SUBMISSION VALUE', submission_value, round);
    let vote = await auditSubmission(submission_value, round);
    return vote;
  }

  async auditTask(roundNumber) {
    console.log('auditTask called with round', roundNumber);
    console.log(
      await namespaceWrapper.getSlot(),
      'current slot while calling auditTask',
    );
    await namespaceWrapper.validateAndVoteOnNodes(
      this.validateNode,
      roundNumber,
    );
  }
}
const audit = new Audit();
module.exports = { audit };
