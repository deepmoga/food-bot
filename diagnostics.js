const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

function execCmd(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000 });
  } catch (e) {
    return `[ERROR RUNNING "${cmd}"]: ${e.message}\n`;
  }
}

function postRequest(url, data, contentType = 'text/plain') {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'NodeJS-Diagnostics-Script'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body.trim()));
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  let output = `=== VPS DIAGNOSTICS RUN AT ${new Date().toISOString()} ===\n\n`;

  output += execCmd('whoami');
  output += `CWD: ${process.cwd()}\n`;
  output += `Node Version: ${process.version}\n\n`;

  output += execCmd('pm2 list');
  output += execCmd('pm2 show food-bot');

  const home = process.env.HOME || '/root';
  const errLogPath = path.join(home, '.pm2/logs/food-bot-error.log');
  const outLogPath = path.join(home, '.pm2/logs/food-bot-out.log');

  output += "=== PM2 ERROR LOGS ===\n";
  if (fs.existsSync(errLogPath)) {
    try {
      const lines = fs.readFileSync(errLogPath, 'utf8').split('\n').slice(-100).join('\n');
      output += lines + '\n\n';
    } catch (e) {
      output += `Error reading error log: ${e.message}\n\n`;
    }
  } else {
    output += `Error log not found at: ${errLogPath}\n\n`;
  }

  output += "=== PM2 OUT LOGS ===\n";
  if (fs.existsSync(outLogPath)) {
    try {
      const lines = fs.readFileSync(outLogPath, 'utf8').split('\n').slice(-100).join('\n');
      output += lines + '\n\n';
    } catch (e) {
      output += `Error reading out log: ${e.message}\n\n`;
    }
  } else {
    output += `Out log not found at: ${outLogPath}\n\n`;
  }

  output += "=== PORT LISTENING (SS) ===\n";
  output += execCmd('ss -tulnp | grep node');

  output += "\n=== PORT LISTENING (NETSTAT) ===\n";
  output += execCmd('netstat -tulnp | grep node');

  console.log('Diagnostics gathered. Size:', output.length, 'bytes');

  // Try uploading to pastebin
  let pasteUrl = '';
  try {
    console.log('Uploading to paste.c-net.org...');
    pasteUrl = await postRequest('https://paste.c-net.org', output);
    console.log('Paste URL:', pasteUrl);
  } catch (e) {
    console.error('Failed to upload to pastebin:', e.message);
  }

  // Publish to ntfy.sh
  try {
    const topicUrl = 'https://ntfy.sh/antigravity-vps-logs-992854';
    if (pasteUrl && pasteUrl.startsWith('http')) {
      console.log('Publishing Paste URL to ntfy.sh...');
      await postRequest(topicUrl, `VPS Diagnostics: ${pasteUrl}`);
    } else {
      console.log('Publishing raw snippet to ntfy.sh (fallback)...');
      // Limit to 4000 characters for ntfy.sh body limit
      const snippet = output.substring(0, 4000);
      await postRequest(topicUrl, snippet);
    }
    console.log('Successfully published to ntfy.sh.');
  } catch (e) {
    console.error('Failed to publish to ntfy.sh:', e.message);
  }
}

main().catch(err => {
  console.error('Unhandled diagnostics error:', err);
});
