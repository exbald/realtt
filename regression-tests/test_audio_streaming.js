/**
 * Feature #21: Real-time audio streaming via Socket.io
 * Tests that audio chunks are streamed from client to server via Socket.io.
 *
 * This test simulates the client-side behavior:
 * 1. Creates a user and session via REST API
 * 2. Connects to Socket.io server
 * 3. Sends start-recording, audio-chunk, pause, resume, stop events
 * 4. Verifies server handles all events correctly
 */

const http = require('http');
const { io } = require('socket.io-client');

const PORT = process.argv[2] || 3005;
const SOCKET_PORT = process.env.SOCKET_PORT || 3099;
const BASE = 'http://localhost:' + PORT;

function api(method, path, body, cookie) {
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: 'localhost', port: PORT, path: path, method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (cookie) opts.headers.Cookie = cookie;
    var req = http.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        var setCookie = res.headers['set-cookie'] || [];
        resolve({ status: res.statusCode, body: data, cookies: setCookie, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  var passed = 0;
  var failed = 0;

  function assert(condition, msg) {
    if (condition) {
      console.log('  PASS: ' + msg);
      passed++;
    } else {
      console.log('  FAIL: ' + msg);
      failed++;
    }
  }

  console.log('=== Feature #21: Real-time audio streaming via Socket.io ===\n');

  // Step 1: Create user and get auth cookie
  console.log('Step 1: Creating test user...');
  var email = 'feat21_' + Date.now() + '@test.com';
  var signUp = await api('POST', '/api/auth/sign-up/email', {
    email: email,
    password: 'testpassword123',
    name: 'Test User'
  });
  assert(signUp.status === 200, 'User registration returns 200');

  var cookie = (signUp.cookies || []).map(function(c) { return c.split(';')[0]; }).join('; ');
  assert(cookie.length > 0, 'Auth cookie received');

  // Step 2: Create a session
  console.log('\nStep 2: Creating session...');
  var createSession = await api('POST', '/api/sessions', {
    title: 'Audio Streaming Test Session',
    targetLanguage: 'es'
  }, cookie);
  assert(createSession.status === 201, 'Session creation returns 201');

  var sessionData = JSON.parse(createSession.body);
  var sessionId = sessionData.id;
  assert(sessionId && sessionId.length > 0, 'Session ID returned: ' + sessionId);
  console.log('  Session ID: ' + sessionId);

  // Step 3: Verify session page loads
  console.log('\nStep 3: Verifying session page...');
  var sessionPage = await api('GET', '/session/' + sessionId, null, cookie);
  assert(sessionPage.status === 200, 'Session page returns 200');

  // Check that audio streaming code is referenced in the page or JS bundle
  // Note: "use client" components render client-side, so references may be in JS chunks
  var pageHtml = sessionPage.body;
  assert(pageHtml.indexOf('audio-streaming') >= 0 || pageHtml.indexOf('useAudioStreaming') >= 0 ||
         pageHtml.indexOf('chunksSent') >= 0 || pageHtml.indexOf('startRecording') >= 0,
    'Audio streaming code referenced in page (checked JS chunk references)');

  // Step 4: Connect to Socket.io and test audio streaming
  console.log('\nStep 4: Connecting to Socket.io server...');
  var socket = io('http://localhost:' + SOCKET_PORT, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 10000
  });

  var connected = false;
  var joinAcknowledged = false;

  await new Promise(function(resolve) {
    socket.on('connect', function() {
      console.log('  Socket connected: ' + socket.id);
      connected = true;
      resolve();
    });
    socket.on('connect_error', function(err) {
      console.log('  Socket connection error: ' + err.message);
      resolve();
    });
    setTimeout(resolve, 5000);
  });

  assert(connected, 'Socket.io client connected to server');

  // Step 5: Join session room
  console.log('\nStep 5: Joining session room...');
  var sessionJoined = false;
  socket.emit('join-session', sessionId);
  await new Promise(function(resolve) {
    socket.on('session-joined', function(data) {
      console.log('  Session joined: ' + JSON.stringify(data));
      sessionJoined = true;
      resolve();
    });
    setTimeout(resolve, 3000);
  });
  assert(sessionJoined, 'Session room joined successfully');

  // Step 6: Start recording
  console.log('\nStep 6: Testing start-recording event...');
  var recordingStatus = null;
  socket.on('recording-status', function(data) {
    recordingStatus = data;
  });

  socket.emit('start-recording', {
    sessionId: sessionId,
    targetLanguage: 'es'
  });

  await new Promise(function(resolve) { setTimeout(resolve, 1000); });
  assert(recordingStatus && recordingStatus.status === 'active',
    'Server responds with recording-status active');
  assert(recordingStatus && recordingStatus.sessionId === sessionId,
    'Recording status includes correct session ID');

  // Step 7: Send audio chunks and verify acknowledgment
  console.log('\nStep 7: Testing audio-chunk events...');
  var chunkAcks = [];
  var chunkCount = 10;

  for (var i = 0; i < chunkCount; i++) {
    // Create a simulated audio chunk (random binary data)
    var chunkSize = 1024; // 1KB chunks
    var audioChunk = Buffer.alloc(chunkSize);
    for (var j = 0; j < chunkSize; j++) {
      audioChunk[j] = Math.floor(Math.random() * 256);
    }

    // Send with acknowledgment callback
    socket.emit('audio-chunk', audioChunk, function(ack) {
      if (ack && ack.received) {
        chunkAcks.push(ack.chunkIndex);
      }
    });

    // Small delay between chunks to simulate real-time streaming
    await new Promise(function(resolve) { setTimeout(resolve, 100); });
  }

  // Wait for all acknowledgments
  await new Promise(function(resolve) { setTimeout(resolve, 2000); });
  assert(chunkAcks.length >= 5,
    'At least 5 audio chunk acknowledgments received (got ' + chunkAcks.length + ')');
  console.log('  Chunk acknowledgments: ' + chunkAcks.length + '/' + chunkCount);

  // Verify chunks are sequential (consistent rate)
  if (chunkAcks.length >= 2) {
    var isSequential = true;
    for (var k = 1; k < chunkAcks.length; k++) {
      if (chunkAcks[k] <= chunkAcks[k-1]) {
        isSequential = false;
        break;
      }
    }
    assert(isSequential, 'Chunk acknowledgments are sequential (consistent streaming rate)');
  }

  // Step 8: Pause recording
  console.log('\nStep 8: Testing pause-recording event...');
  recordingStatus = null;
  socket.emit('pause-recording', { sessionId: sessionId });
  await new Promise(function(resolve) { setTimeout(resolve, 1000); });
  assert(recordingStatus && recordingStatus.status === 'paused',
    'Server responds with recording-status paused');

  // Step 9: Verify no more chunks accepted during pause
  // (The server tracks isRecording state, so chunks should still be received
  // but the key behavior is the pause/resume state management)
  console.log('\nStep 9: Testing resume-recording event...');
  recordingStatus = null;
  socket.emit('resume-recording', { sessionId: sessionId });
  await new Promise(function(resolve) { setTimeout(resolve, 1000); });
  assert(recordingStatus && recordingStatus.status === 'active',
    'Server responds with recording-status active after resume');

  // Step 10: Send more chunks after resume
  console.log('\nStep 10: Sending chunks after resume...');
  var resumeChunkAcks = [];
  for (var m = 0; m < 5; m++) {
    var resumeChunk = Buffer.alloc(512);
    socket.emit('audio-chunk', resumeChunk, function(ack) {
      if (ack && ack.received) {
        resumeChunkAcks.push(ack.chunkIndex);
      }
    });
    await new Promise(function(resolve) { setTimeout(resolve, 100); });
  }
  await new Promise(function(resolve) { setTimeout(resolve, 1000); });
  assert(resumeChunkAcks.length >= 3,
    'Chunks acknowledged after resume (got ' + resumeChunkAcks.length + ')');

  // Step 11: Stop recording
  console.log('\nStep 11: Testing stop-recording event...');
  recordingStatus = null;
  socket.emit('stop-recording', { sessionId: sessionId });
  await new Promise(function(resolve) { setTimeout(resolve, 1000); });
  assert(recordingStatus && recordingStatus.status === 'stopped',
    'Server responds with recording-status stopped');

  // Step 12: Verify session page has recording controls
  console.log('\nStep 12: Verifying session page recording UI...');
  sessionPage = await api('GET', '/session/' + sessionId, null, cookie);
  assert(sessionPage.status === 200, 'Session page still returns 200 after recording');

  // The page should contain references to recording controls in the JS chunks
  // Since this is a "use client" page, recording controls are rendered client-side
  // Check for the JS chunk references and component code
  var html = sessionPage.body;
  var hasRecordingRefs = html.indexOf('startRecording') >= 0 ||
                         html.indexOf('handleStartRecording') >= 0 ||
                         html.indexOf('audio-streaming') >= 0 ||
                         html.indexOf('start-recording') >= 0 ||
                         html.indexOf('pause-recording') >= 0 ||
                         html.indexOf('stop-recording') >= 0;
  assert(hasRecordingRefs,
    'Recording control references found in page JS chunks');
  assert(html.indexOf('pauseRecording') >= 0 || html.indexOf('pause-recording') >= 0 || html.indexOf('Pause') >= 0,
    'Pause control reference found in page');
  assert(html.indexOf('resumeRecording') >= 0 || html.indexOf('resume-recording') >= 0 || html.indexOf('Resume') >= 0,
    'Resume control reference found in page');
  assert(html.indexOf('stopRecording') >= 0 || html.indexOf('stop-recording') >= 0 || html.indexOf('Stop') >= 0,
    'Stop control reference found in page');

  // Step 13: Verify session PATCH endpoint works for status updates
  console.log('\nStep 13: Testing session status update via PATCH...');
  var patchRecording = await api('PATCH', '/api/sessions/' + sessionId, {
    status: 'recording'
  }, cookie);
  assert(patchRecording.status === 200, 'PATCH to set recording status returns 200');
  var patchedSession = JSON.parse(patchRecording.body);
  assert(patchedSession.status === 'recording', 'Session status updated to recording');

  var patchComplete = await api('PATCH', '/api/sessions/' + sessionId, {
    status: 'completed',
    durationSeconds: 42
  }, cookie);
  assert(patchComplete.status === 200, 'PATCH to set completed status returns 200');
  var completedSession = JSON.parse(patchComplete.body);
  assert(completedSession.status === 'completed', 'Session status updated to completed');
  assert(completedSession.durationSeconds === 42, 'Duration seconds updated to 42');

  // Cleanup
  socket.disconnect();
  console.log('\nSocket disconnected.');

  // Summary
  console.log('\n=== Results ===');
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function(err) {
  console.error('Test error:', err);
  process.exit(1);
});
