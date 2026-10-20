// Isolated SMTP capture fixture. Never forwards mail to another server.
const net = require('node:net');
const http = require('node:http');
const messages = [];
net.createServer(socket => {
  socket.setTimeout(30000, () => socket.destroy());
  let buffer = '', data = false, lines = [];
  const reply = text => socket.write(text + '\r\n');
  reply('220 caf-smtp-test ESMTP');
  socket.on('error', () => {});
  socket.on('data', chunk => {
    buffer += chunk.toString();
    let boundary;
    while ((boundary = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      if (data) {
        if (line === '.') { messages.push(lines.join('\r\n')); lines = []; data = false; reply('250 queued'); }
        else lines.push(line.startsWith('..') ? line.slice(1) : line);
        continue;
      }
      const command = line.split(' ')[0].toUpperCase();
      if (command === 'EHLO' || command === 'HELO') reply('250-caf-smtp-test\r\n250-AUTH PLAIN\r\n250 SIZE 524288');
      else if (command === 'AUTH') {
        const parts = Buffer.from(line.split(' ')[2] || '', 'base64').toString().split('\0');
        reply(parts.at(-2) === 'fixture-user' && parts.at(-1) === 'fixture-smtp-password' ? '235 authenticated' : '535 authentication failed');
      } else if (command === 'DATA') { data = true; reply('354 end with dot'); }
      else if (command === 'QUIT') { reply('221 goodbye'); socket.end(); }
      else if (['MAIL', 'RCPT', 'RSET', 'NOOP'].includes(command)) reply('250 OK');
      else reply('502 not supported');
    }
  });
}).listen(2525, '0.0.0.0');
http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/messages') response.end(JSON.stringify(messages));
  else response.end(JSON.stringify({ ready: true }));
}).listen(8025, '0.0.0.0');
