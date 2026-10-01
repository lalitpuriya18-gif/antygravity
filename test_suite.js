const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function request(method, pathUrl, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (e) {
          json = body;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING JUST SAY YES COMPREHENSIVE TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // ----------------------------------------------------
    // TEST 1 & 2: Create question & Generate Link
    // ----------------------------------------------------
    console.log('--- TEST 1 & 2: Create question & Generate link (Person A) ---');
    const testCreatorId = 'creator_test_' + Date.now();
    const createRes = await request('POST', '/api/questions', {
      question_text: 'Will you say yes?',
      creator_id: testCreatorId
    });

    assert(createRes.statusCode === 201, 'Status code is 201 Created');
    assert(createRes.data.success === true, 'Response reports success: true');
    assert(createRes.data.question && createRes.data.question.id, `Generated Question ID: ${createRes.data.question ? createRes.data.question.id : 'N/A'}`);
    assert(createRes.data.question.question_text === 'Will you say yes?', 'Question text is correctly stored');
    assert(createRes.data.question.status === 'waiting', 'Initial status is "waiting"');

    const questionId = createRes.data.question.id;
    const generatedUrl = `${BASE_URL}/?q=${questionId}`;
    const generatedPathUrl = `${BASE_URL}/question/${questionId}`;
    console.log(`  🔗 Unique Link Generated: ${generatedUrl}`);
    console.log(`  🔗 Direct Path Route: ${generatedPathUrl}`);

    // ----------------------------------------------------
    // TEST 3 & 4: Open link in another browser / Display correct question (Person B)
    // ----------------------------------------------------
    console.log('\n--- TEST 3 & 4: Open link as Person B & Display correct question ---');
    const getRes = await request('GET', `/api/questions/${questionId}`);
    assert(getRes.statusCode === 200, 'Person B can fetch question (HTTP 200)');
    assert(getRes.data.id === questionId, 'Fetched correct question ID');
    assert(getRes.data.question_text === 'Will you say yes?', 'Displays correct question text');
    assert(getRes.data.already_answered === false, 'Question is not yet answered');

    // Also check static page serve for /question/:id
    const pageRes = await request('GET', `/question/${questionId}`);
    assert(pageRes.statusCode === 200, 'HTML page served successfully for /question/:id');
    assert(typeof pageRes.data === 'string' && pageRes.data.includes('Just Say Yes'), 'Serves valid Just Say Yes HTML application');

    // ----------------------------------------------------
    // TEST 5: NO escape behavior physics math verification
    // ----------------------------------------------------
    console.log('\n--- TEST 5: NO escape behavior (360° omnidirectional escape) ---');
    function testDirection(name, px, py, cx, cy) {
      let dx = px - cx;
      let dy = py - cy;
      let dist = Math.hypot(dx, dy);
      let fleeX = -dx / dist;
      let fleeY = -dy / dist;
      return { fleeX, fleeY };
    }

    const cx = 200, cy = 200;
    // Touch from bottom: py = 250 (cy + 50) -> fleeY should be negative (UP)
    const bottom = testDirection('bottom', 200, 250, cx, cy);
    assert(bottom.fleeY < -0.9 && Math.abs(bottom.fleeX) < 0.01, 'Touch from BOTTOM -> Flees UP ⬆️');

    // Touch from top: py = 150 (cy - 50) -> fleeY should be positive (DOWN)
    const top = testDirection('top', 200, 150, cx, cy);
    assert(top.fleeY > 0.9 && Math.abs(top.fleeX) < 0.01, 'Touch from TOP -> Flees DOWN ⬇️');

    // Touch from right: px = 250 (cx + 50) -> fleeX should be negative (LEFT)
    const right = testDirection('right', 250, 200, cx, cy);
    assert(right.fleeX < -0.9 && Math.abs(right.fleeY) < 0.01, 'Touch from RIGHT -> Flees LEFT ⬅️');

    // Touch from left: px = 150 (cx - 50) -> fleeX should be positive (RIGHT)
    const left = testDirection('left', 150, 200, cx, cy);
    assert(left.fleeX > 0.9 && Math.abs(left.fleeY) < 0.01, 'Touch from LEFT -> Flees RIGHT ➡️');

    // Touch from bottom-left: px = 150, py = 250 -> fleeX > 0 (RIGHT), fleeY < 0 (UP) -> TOP-RIGHT
    const bl = testDirection('bottom-left', 150, 250, cx, cy);
    assert(bl.fleeX > 0.6 && bl.fleeY < -0.6, 'Touch from BOTTOM-LEFT -> Flees TOP-RIGHT ↗️');

    // Touch from bottom-right: px = 250, py = 250 -> fleeX < 0 (LEFT), fleeY < 0 (UP) -> TOP-LEFT
    const br = testDirection('bottom-right', 250, 250, cx, cy);
    assert(br.fleeX < -0.6 && br.fleeY < -0.6, 'Touch from BOTTOM-RIGHT -> Flees TOP-LEFT ↖️');

    // Touch from top-left: px = 150, py = 150 -> fleeX > 0 (RIGHT), fleeY > 0 (DOWN) -> BOTTOM-RIGHT
    const tl = testDirection('top-left', 150, 150, cx, cy);
    assert(tl.fleeX > 0.6 && tl.fleeY > 0.6, 'Touch from TOP-LEFT -> Flees BOTTOM-RIGHT ↘️');

    // Touch from top-right: px = 250, py = 150 -> fleeX < 0 (LEFT), fleeY > 0 (DOWN) -> BOTTOM-LEFT
    const tr = testDirection('top-right', 250, 150, cx, cy);
    assert(tr.fleeX < -0.6 && tr.fleeY > 0.6, 'Touch from TOP-RIGHT -> Flees BOTTOM-LEFT ↙️');

    // Arbitrary angle: 37 degrees
    const arbitraryAngle = 37 * Math.PI / 180;
    const px = cx + 50 * Math.cos(arbitraryAngle);
    const py = cy + 50 * Math.sin(arbitraryAngle);
    const arb = testDirection('arbitrary', px, py, cx, cy);
    const expectedFleeAngle = (arbitraryAngle + Math.PI) % (2 * Math.PI);
    const actualFleeAngle = (Math.atan2(arb.fleeY, arb.fleeX) + 2 * Math.PI) % (2 * Math.PI);
    assert(Math.abs(expectedFleeAngle - actualFleeAngle) < 0.001, 'Arbitrary Angle -> Exact 180° reversed flee vector');

    // ----------------------------------------------------
    // TEST 6 & 7: YES submission & Database response (Person B clicks YES)
    // ----------------------------------------------------
    console.log('\n--- TEST 6 & 7: YES submission & Database response ---');
    const respondRes = await request('POST', `/api/questions/${questionId}/respond`, {
      answer: 'YES',
      respondent_id: 'person_b_tester'
    });
    assert(respondRes.statusCode === 200, 'YES submission succeeded (HTTP 200)');
    assert(respondRes.data.success === true, 'Response reports success: true');
    assert(respondRes.data.response && respondRes.data.response.answer === 'YES', 'Database recorded YES answer');

    // Verify question status is updated to 'accepted' in DB
    const updatedQuestionRes = await request('GET', `/api/questions/${questionId}`);
    assert(updatedQuestionRes.data.status === 'accepted', 'Question status in DB is now "accepted"');
    assert(updatedQuestionRes.data.already_answered === true, 'already_answered flag is true');

    // ----------------------------------------------------
    // TEST 8: Creator notification ("Someone answered YES ❤️")
    // ----------------------------------------------------
    console.log('\n--- TEST 8: Creator notification (Person A receives notification) ---');
    const notifsRes = await request('GET', `/api/creators/${testCreatorId}/notifications`);
    assert(notifsRes.statusCode === 200, 'Fetched creator notifications (HTTP 200)');
    assert(Array.isArray(notifsRes.data.notifications), 'Notifications is an array');
    assert(notifsRes.data.notifications.length >= 1, 'At least 1 notification exists');
    const latestNotif = notifsRes.data.notifications[0];
    assert(latestNotif.message === 'Someone answered YES ❤️', `Notification message is exactly: "${latestNotif.message}"`);
    assert(latestNotif.question_id === questionId, 'Notification references the correct question ID');
    assert(latestNotif.question_text === 'Will you say yes?', 'Notification includes question text');

    // ----------------------------------------------------
    // TEST 9: Multiple questions support
    // ----------------------------------------------------
    console.log('\n--- TEST 9: Multiple questions support ---');
    const q2Res = await request('POST', '/api/questions', {
      question_text: 'Will you go out with me?',
      creator_id: testCreatorId
    });
    const q3Res = await request('POST', '/api/questions', {
      question_text: 'Are you ready for lunch?',
      creator_id: testCreatorId
    });
    assert(q2Res.statusCode === 201 && q3Res.statusCode === 201, 'Multiple questions created successfully');

    const creatorQuestionsRes = await request('GET', `/api/creators/${testCreatorId}/questions`);
    assert(creatorQuestionsRes.data.questions.length === 3, `Creator has 3 questions listed (found ${creatorQuestionsRes.data.questions.length})`);
    assert(creatorQuestionsRes.data.questions.some(q => q.question_text === 'Will you say yes?' && q.status === 'accepted'), 'First question is tracked as accepted');
    assert(creatorQuestionsRes.data.questions.some(q => q.question_text === 'Will you go out with me?' && q.status === 'waiting'), 'Second question tracked as waiting');

    // ----------------------------------------------------
    // TEST 10: Mobile access & LAN IP
    // ----------------------------------------------------
    console.log('\n--- TEST 10: Mobile access ---');
    const networkRes = await request('GET', '/api/network-info');
    assert(networkRes.statusCode === 200, 'Network info endpoint responds (HTTP 200)');
    assert(networkRes.data.ip && networkRes.data.ip !== '127.0.0.1', `Local LAN IP detected: ${networkRes.data.ip}`);
    assert(networkRes.data.url.startsWith('http://'), `Mobile URL generated: ${networkRes.data.url}`);

    // ----------------------------------------------------
    // TEST 11: Desktop access (localhost)
    // ----------------------------------------------------
    console.log('\n--- TEST 11: Desktop access ---');
    const rootRes = await request('GET', '/');
    assert(rootRes.statusCode === 200, 'Desktop access at / returns HTTP 200');
    assert(typeof rootRes.data === 'string' && rootRes.data.includes('Will you say yes?'), 'Contains default preset text');

    // ----------------------------------------------------
    // TEST 12: Refresh behavior (re-fetching answered question)
    // ----------------------------------------------------
    console.log('\n--- TEST 12: Refresh behavior ---');
    const refreshRes = await request('GET', `/api/questions/${questionId}`);
    assert(refreshRes.statusCode === 200, 'Refreshing page fetches question state reliably');
    assert(refreshRes.data.already_answered === true, 'Persists accepted state on refresh without resetting');

    // ----------------------------------------------------
    // TEST 13: Invalid question link handling
    // ----------------------------------------------------
    console.log('\n--- TEST 13: Invalid question link handling ---');
    const invalidRes = await request('GET', '/api/questions/NON_EXISTENT_ID_999');
    assert(invalidRes.statusCode === 404, 'Invalid question returns 404 Not Found');
    assert(invalidRes.data.error === 'Question not found', 'Returns proper error message');

    // ----------------------------------------------------
    // TEST 14: Duplicate response handling
    // ----------------------------------------------------
    console.log('\n--- TEST 14: Duplicate response handling ---');
    const dupRes = await request('POST', `/api/questions/${questionId}/respond`, {
      answer: 'YES'
    });
    assert(dupRes.statusCode === 200, 'Duplicate request handled gracefully');
    assert(dupRes.data.already_accepted === true, 'Returns already_accepted: true to prevent double submission');

    // ----------------------------------------------------
    // TEST 15: Console errors and script validation in index.html
    // ----------------------------------------------------
    console.log('\n--- TEST 15: Console errors and script validation ---');
    const htmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const scriptMatches = htmlContent.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi);
    assert(scriptMatches && scriptMatches.length > 0, `Found ${scriptMatches.length} script blocks in index.html`);

    let syntaxErrors = 0;
    scriptMatches.forEach((scriptTag, idx) => {
      const jsCode = scriptTag.replace(/^<script[\s\S]*?>/i, '').replace(/<\/script>$/i, '');
      try {
        new Function(jsCode);
        console.log(`  ✅ PASS: Script block #${idx + 1} syntax is 100% valid with 0 syntax errors`);
        passed++;
      } catch (e) {
        console.error(`  ❌ FAIL: Syntax error in script block #${idx + 1}:`, e.message);
        failed++;
        syntaxErrors++;
      }
    });

    assert(syntaxErrors === 0, 'Zero script syntax errors in index.html');

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
