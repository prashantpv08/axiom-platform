import { ticketQualityEvaluationCases } from '../evaluation/ticket-quality-v1';
import { evaluateTicketQuality } from '../src/work-items/ticket-quality.evaluator';

let matched = 0;
const results = ticketQualityEvaluationCases.map((evaluationCase) => {
  const report = evaluateTicketQuality(evaluationCase.input);
  const actualCodes = [...new Set(report.findings.map((finding) => finding.code))].sort();
  const expectedCodes = [...evaluationCase.expectedFindingCodes].sort();
  const expectationMatched = report.passed === evaluationCase.expectedPassed
    && JSON.stringify(actualCodes) === JSON.stringify(expectedCodes);
  if (expectationMatched) matched += 1;
  return { id: evaluationCase.id, expectedPassed: evaluationCase.expectedPassed, actualPassed: report.passed, expectedCodes, actualCodes, expectationMatched, metrics: report.metrics };
});

console.log(JSON.stringify({ datasetVersion: 'ticket-quality-v1', reviewStatus: 'AWAITING_HUMAN_REVIEW', cases: results.length, matched, results }, null, 2));
if (matched !== results.length) process.exitCode = 1;
