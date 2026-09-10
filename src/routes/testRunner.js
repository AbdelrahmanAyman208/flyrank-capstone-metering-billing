/**
 * Test runner route — triggers `npm test` and streams the output back as JSON.
 * Only available in development mode for safety.
 */
const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const path = require('path');

router.post('/run', async (req, res) => {
  try {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const output = execSync('npx jest --verbose --forceExit --no-color 2>&1', {
      cwd: projectRoot,
      timeout: 30000,
      encoding: 'utf8',
    });

    // Parse the jest output into structured results
    const results = parseJestOutput(output);
    res.json(results);
  } catch (err) {
    // Jest exits with code 1 when tests fail, but still produces output
    const output = err.stdout || err.stderr || err.message;
    const results = parseJestOutput(output);
    res.json(results);
  }
});

function parseJestOutput(output) {
  const lines = output.split('\n');
  const suites = [];
  let currentSuite = null;
  let currentDescribe = null;

  // Counters
  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;
  let duration = '';

  for (const line of lines) {
    // Match suite header: PASS tests/cost.test.js or FAIL tests/cost.test.js
    const suiteMatch = line.match(/^\s*(PASS|FAIL)\s+(.+\.test\.js)/);
    if (suiteMatch) {
      currentSuite = {
        status: suiteMatch[1],
        file: suiteMatch[2],
        describes: [],
      };
      suites.push(currentSuite);
      currentDescribe = null;
      continue;
    }

    // Match describe block (indented suite name)
    const describeMatch = line.match(/^\s{2,4}(\S.+)$/);
    if (describeMatch && currentSuite && !line.match(/[√×✓✕]/)) {
      currentDescribe = {
        name: describeMatch[1],
        tests: [],
      };
      currentSuite.describes.push(currentDescribe);
      continue;
    }

    // Match test result: √ or × (or checkmark/cross)
    const testMatch = line.match(/^\s+(√|✓|×|✕)\s+(.+?)(?:\s+\((\d+)\s*ms\))?\s*$/);
    if (testMatch && currentDescribe) {
      const passed = testMatch[1] === '√' || testMatch[1] === '✓';
      currentDescribe.tests.push({
        name: testMatch[2],
        passed,
        duration: testMatch[3] ? parseInt(testMatch[3]) : 0,
      });
      if (passed) totalPassed++;
      else totalFailed++;
      totalTests++;
      continue;
    }

    // Match summary line: Tests: 52 passed, 52 total
    const summaryMatch = line.match(/Tests:\s+(\d+)\s+passed/);
    if (summaryMatch) totalPassed = parseInt(summaryMatch[1]);

    const failMatch = line.match(/(\d+)\s+failed/);
    if (failMatch) totalFailed = parseInt(failMatch[1]);

    // Match time: Time: 1.471 s
    const timeMatch = line.match(/Time:\s+(.+)/);
    if (timeMatch) duration = timeMatch[1].trim();
  }

  return {
    passed: totalPassed,
    failed: totalFailed,
    total: totalTests || totalPassed + totalFailed,
    duration,
    suites,
    raw: output,
  };
}

module.exports = router;
