const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const nodemailer = require('nodemailer');

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Initial in-memory database structure
let db = {
  questions: [],      // { id, question_text, creator_id, creator_email, creator_name, created_at, status }
  responses: [],      // { id, question_id, answer, respondent_name, responded_at, respondent_id }
  notifications: [],  // { id, creator_id, question_id, message, question_text, read, created_at }
  emails: []          // { id, to, subject, respondent_name, question_id, sent_at, status }
};

// Load existing database if available
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(data);
      if (!Array.isArray(db.emails)) db.emails = [];
    } else {
      saveDatabase();
    }
  } catch (err) {
    console.error('Error loading database, initializing fresh:', err);
    saveDatabase();
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

loadDatabase();

const LOG_FILE = path.join(__dirname, 'server.log');
function logServer(...args) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {}
  console.log(...args);
}

// Prevent crashes on client socket resets or network disconnects
process.on('uncaughtException', (err) => {
  logServer('CRITICAL UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : String(err));
});
process.on('unhandledRejection', (reason) => {
  logServer('UNHANDLED REJECTION:', String(reason));
});
process.on('exit', (code) => {
  logServer('Process exited with code:', code);
});

// SSE (Server-Sent Events) active clients for real-time notifications
// Map: creator_id -> Set of res objects
const sseClients = new Map();

function broadcastNotification(creatorId, notification) {
  if (sseClients.has(creatorId)) {
    const clients = sseClients.get(creatorId);
    const data = JSON.stringify(notification);
    for (const res of Array.from(clients)) {
      if (res.destroyed || res.writableEnded) {
        clients.delete(res);
        continue;
      }
      try {
        res.write(`event: notification\ndata: ${data}\n\n`, (err) => {
          if (err) clients.delete(res);
        });
      } catch (e) {
        clients.delete(res);
      }
    }
  }
}

// Periodic heartbeat to keep connections alive and clean up stale sockets
setInterval(() => {
  for (const [creatorId, clients] of Array.from(sseClients.entries())) {
    for (const client of Array.from(clients)) {
      if (client.destroyed || client.writableEnded) {
        clients.delete(client);
        continue;
      }
      try {
        client.write(': heartbeat\n\n', (err) => {
          if (err) clients.delete(client);
        });
      } catch (e) {
        clients.delete(client);
      }
    }
    if (clients.size === 0) sseClients.delete(creatorId);
  }
}, 15000);

// Email Dispatcher Function
async function sendAcceptanceEmail(question, respondentName) {
  const targetEmail = question.creator_email || 'inlostlalit@gmail.com';
  const name = respondentName || 'Someone';
  const qText = question.question_text || 'Will you say yes?';
  const dateStr = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  const subject = `🎉 ${name} accepted your question: "${qText}" ❤️`;
  const messageText = `Great news! This user (${name}) accepted your question (${qText}) ❤️\n\nAnswer: YES 🎉\nTime: ${dateStr}\nQuestion ID: ${question.id}`;

  const htmlBody = `
    <div style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; background: #fff1f2; padding: 32px 24px; border-radius: 24px; color: #1e1b4b; max-width: 520px; margin: 0 auto; border: 2px solid #fecdd3;">
      <div style="font-size: 38px; text-align: center; margin-bottom: 12px;">🎉💌</div>
      <h1 style="color: #e11d48; margin: 0 0 14px 0; font-size: 24px; text-align: center; font-weight: 800;">Someone Answered YES! ❤️</h1>
      <p style="font-size: 16px; line-height: 1.6; text-align: center; color: #334155; margin-bottom: 20px;">
        This user <strong>(${name})</strong> accepted your question:
      </p>
      <div style="background: #ffffff; border-left: 5px solid #10b981; padding: 18px 20px; border-radius: 14px; margin: 20px 0; font-size: 20px; font-weight: 800; color: #0f172a; box-shadow: 0 8px 24px rgba(0,0,0,0.06); text-align: center;">
        "${qText}"
      </div>
      <div style="background: rgba(255,255,255,0.7); border-radius: 14px; padding: 14px 18px; margin-top: 18px; font-size: 14px; color: #64748b; line-height: 1.6;">
        <div>👤 <strong>User:</strong> ${name}</div>
        <div>✅ <strong>Answer:</strong> YES ❤️</div>
        <div>📅 <strong>Time:</strong> ${dateStr}</div>
        <div>🆔 <strong>Question ID:</strong> <code>${question.id}</code></div>
      </div>
      <hr style="border: none; border-top: 1px solid #fecdd3; margin: 26px 0 18px 0;">
      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
        Sent with ❤️ by <strong>Just Say Yes</strong>
      </p>
    </div>
  `;

  logServer(`[Email] Dispatching notification to ${targetEmail} for user: "${name}", question: "${qText}"`);

  if (!db.emails) db.emails = [];
  const emailRecord = {
    id: 'email_' + generateShortId(8),
    to: targetEmail,
    subject: subject,
    respondent_name: name,
    question_id: question.id,
    question_text: qText,
    sent_at: new Date().toISOString(),
    status: 'pending'
  };
  db.emails.unshift(emailRecord);
  saveDatabase();

  // Method 1: FormSubmit API dispatch to email inbox
  try {
    const postPayload = JSON.stringify({
      _subject: subject,
      user_name: name,
      question: qText,
      message: `This user (${name}) accepted your question (${qText}) ❤️`,
      timestamp: dateStr
    });

    const formReq = https.request(`https://formsubmit.co/ajax/${encodeURIComponent(targetEmail)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Referer': 'https://justsayyes.love',
        'Origin': 'https://justsayyes.love'
      }
    }, (formRes) => {
      let formBody = '';
      formRes.on('data', c => formBody += c);
      formRes.on('end', () => {
        logServer(`[Email FormSubmit] Delivered attempt to ${targetEmail}, status: ${formRes.statusCode}`);
        emailRecord.status = 'dispatched_via_webhook';
        emailRecord.webhook_response = formBody;
        saveDatabase();
      });
    });
    formReq.on('error', (e) => {
      logServer(`[Email FormSubmit Error]: ${e.message}`);
    });
    formReq.write(postPayload);
    formReq.end();
  } catch (e) {
    logServer(`[Email FormSubmit Exception]: ${e.message}`);
  }

  // Method 2: Nodemailer SMTP if SMTP environment variables are configured
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        service: process.env.SMTP_SERVICE || 'gmail',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      await transporter.sendMail({
        from: `"Just Say Yes ❤️" <${process.env.SMTP_USER}>`,
        to: targetEmail,
        subject: subject,
        text: messageText,
        html: htmlBody
      });
      logServer(`[Email Nodemailer] Email sent successfully via SMTP to ${targetEmail}`);
      emailRecord.status = 'sent_via_smtp';
      saveDatabase();
    } catch (smtpErr) {
      logServer(`[Email Nodemailer Error]: ${smtpErr.message}`);
    }
  }
}

// Generate short, clean unique IDs like "8F73K2"
function generateShortId(length = 6) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// MIME types helper
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  req.on('error', (err) => {
    logServer('req error:', err.message);
  });
  res.on('error', (err) => {
    logServer('res error:', err.message);
  });

  // Enable CORS for cross-device & static host compatibility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Creator-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // JSON helper
  function sendJson(statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  // Parse JSON body helper
  function parseBody(callback) {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const json = body ? JSON.parse(body) : {};
        callback(null, json);
      } catch (err) {
        callback(err, null);
      }
    });
  }

  // 0. GET /api/network-info -> Fetch local LAN IP and direct mobile URL
  if (pathname === '/api/network-info' && req.method === 'GET') {
    const ip = getLocalIpAddress();
    return sendJson(200, {
      ip,
      port: PORT,
      url: `http://${ip}:${PORT}`
    });
  }

  // 1. POST /api/questions -> Create new question
  if (pathname === '/api/questions' && req.method === 'POST') {
    parseBody((err, data) => {
      if (err || !data.question_text) {
        return sendJson(400, { error: 'question_text is required' });
      }

      let id = generateShortId();
      while (db.questions.some(q => q.id === id)) {
        id = generateShortId();
      }

      const creatorId = data.creator_id || ('creator_' + generateShortId(8));
      const creatorEmail = (data.creator_email && data.creator_email.trim()) || 'inlostlalit@gmail.com';
      const creatorName = (data.creator_name && data.creator_name.trim()) || '';
      const newQuestion = {
        id,
        question_text: data.question_text.trim(),
        creator_id: creatorId,
        creator_email: creatorEmail,
        creator_name: creatorName,
        created_at: new Date().toISOString(),
        status: 'waiting' // 'waiting' | 'accepted'
      };

      db.questions.unshift(newQuestion);
      saveDatabase();

      sendJson(201, {
        success: true,
        question: newQuestion
      });
    });
    return;
  }

  // 2. GET /api/questions/:id -> Fetch question details for receiver or preview
  if (pathname.startsWith('/api/questions/') && !pathname.endsWith('/respond') && req.method === 'GET') {
    const questionId = pathname.split('/')[3];
    const question = db.questions.find(q => q.id === questionId);

    if (questionId === 'demo') {
      return sendJson(200, {
        id: 'demo',
        question_text: 'Will you say yes? ❤️',
        status: 'waiting',
        created_at: new Date().toISOString(),
        already_answered: false,
        responded_at: null
      });
    }

    if (!question) {
      return sendJson(404, { error: 'Question not found' });
    }

    const response = db.responses.find(r => r.question_id === questionId);

    // Return minimum information required for privacy
    sendJson(200, {
      id: question.id,
      question_text: question.question_text,
      status: question.status,
      created_at: question.created_at,
      creator_name: question.creator_name || '',
      already_answered: question.status === 'accepted',
      respondent_name: response ? response.respondent_name : null,
      responded_at: response ? response.responded_at : null
    });
    return;
  }

  // 3. POST /api/questions/:id/respond -> Submit YES answer
  if (pathname.startsWith('/api/questions/') && pathname.endsWith('/respond') && req.method === 'POST') {
    const parts = pathname.split('/');
    const questionId = parts[3];

    const question = db.questions.find(q => q.id === questionId);
    if (!question) {
      return sendJson(404, { error: 'Question not found' });
    }

    parseBody((err, data) => {
      if (question.status === 'accepted') {
        return sendJson(200, {
          success: true,
          message: 'Question was already accepted!',
          already_accepted: true
        });
      }

      question.status = 'accepted';
      const respondentName = (data.respondent_name && data.respondent_name.trim()) || 'Someone';

      const responseObj = {
        id: 'resp_' + generateShortId(8),
        question_id: questionId,
        answer: 'YES',
        respondent_name: respondentName,
        responded_at: new Date().toISOString(),
        respondent_id: data.respondent_id || ('resp_' + generateShortId(6))
      };
      db.responses.unshift(responseObj);

      const notifMessage = respondentName !== 'Someone'
        ? `${respondentName} answered YES ❤️`
        : 'Someone answered YES ❤️';

      // Create notification for question creator
      const notif = {
        id: 'notif_' + generateShortId(8),
        creator_id: question.creator_id,
        question_id: question.id,
        question_text: question.question_text,
        respondent_name: respondentName,
        message: notifMessage,
        read: false,
        created_at: new Date().toISOString()
      };
      db.notifications.unshift(notif);

      saveDatabase();

      // Real-time broadcast to creator if SSE connection is open
      broadcastNotification(question.creator_id, notif);

      // Send email to inlostlalit@gmail.com
      sendAcceptanceEmail(question, respondentName);

      sendJson(200, {
        success: true,
        response: responseObj
      });
    });
    return;
  }

  // 4. GET /api/creators/:creatorId/questions -> List creator's questions
  if (pathname.startsWith('/api/creators/') && pathname.endsWith('/questions') && req.method === 'GET') {
    const creatorId = pathname.split('/')[3];
    const creatorQuestions = db.questions.filter(q => q.creator_id === creatorId);

    const fullList = creatorQuestions.map(q => {
      const resp = db.responses.find(r => r.question_id === q.id);
      return {
        ...q,
        response: resp ? resp.answer : null,
        respondent_name: resp ? resp.respondent_name : null,
        responded_at: resp ? resp.responded_at : null
      };
    });

    sendJson(200, { questions: fullList });
    return;
  }

  // 4b. GET /api/email-logs -> View sent email records
  if (pathname === '/api/email-logs' && req.method === 'GET') {
    return sendJson(200, { emails: db.emails || [] });
  }

  // 5. GET /api/creators/:creatorId/notifications -> Fetch notifications
  if (pathname.startsWith('/api/creators/') && pathname.endsWith('/notifications') && req.method === 'GET') {
    const creatorId = pathname.split('/')[3];
    const notifs = db.notifications.filter(n => n.creator_id === creatorId);
    sendJson(200, { notifications: notifs });
    return;
  }

  // 6. GET /api/creators/:creatorId/stream -> Server-Sent Events (SSE) for Real-Time Instant Notification
  if (pathname.startsWith('/api/creators/') && pathname.endsWith('/stream') && req.method === 'GET') {
    const creatorId = pathname.split('/')[3];

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    res.write('event: connected\ndata: {"status":"connected"}\n\n');

    if (!sseClients.has(creatorId)) {
      sseClients.set(creatorId, new Set());
    }
    sseClients.get(creatorId).add(res);

    const cleanup = () => {
      if (sseClients.has(creatorId)) {
        sseClients.get(creatorId).delete(res);
        if (sseClients.get(creatorId).size === 0) {
          sseClients.delete(creatorId);
        }
      }
    };

    req.on('close', cleanup);
    res.on('error', cleanup);
    return;
  }

  // 7. DELETE /api/questions/:id -> Delete a question
  if (pathname.startsWith('/api/questions/') && req.method === 'DELETE') {
    const questionId = pathname.split('/')[3];
    const creatorHeader = req.headers['x-creator-id'];

    const idx = db.questions.findIndex(q => q.id === questionId);
    if (idx === -1) {
      return sendJson(404, { error: 'Question not found' });
    }

    if (creatorHeader && db.questions[idx].creator_id !== creatorHeader) {
      return sendJson(403, { error: 'Unauthorized to delete this question' });
    }

    db.questions.splice(idx, 1);
    db.responses = db.responses.filter(r => r.question_id !== questionId);
    db.notifications = db.notifications.filter(n => n.question_id !== questionId);
    saveDatabase();

    sendJson(200, { success: true });
    return;
  }

  // ==========================================
  // STATIC FILE SERVING
  // ==========================================
  // If route is /question/:id or / -> serve index.html
  let filePath = path.join(__dirname, 'index.html');

  if (pathname !== '/' && !pathname.startsWith('/question/')) {
    const potentialPath = path.join(__dirname, pathname);
    if (fs.existsSync(potentialPath) && fs.statSync(potentialPath).isFile()) {
      filePath = potentialPath;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server Error loading file');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.on('clientError', (err, socket) => {
  logServer('server clientError:', err ? err.message : 'unknown');
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  } else {
    socket.destroy();
  }
});

server.on('error', (err) => {
  logServer('server error:', err ? (err.stack || err.message) : 'unknown');
});

// Configure timeouts for tunnel and proxy compatibility
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 0;

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIpAddress();
  logServer(`Just Say Yes server is running:`);
  logServer(`  - Local:   http://localhost:${PORT}`);
  logServer(`  - Mobile:  http://${ip}:${PORT}`);
});
