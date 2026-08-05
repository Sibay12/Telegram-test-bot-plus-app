const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, '../server_debug.log');

function debugLog(moduleName, message, data = '') {
    const timestamp = new Date().toLocaleString();
    const logMessage = `[${timestamp}] [${moduleName.toUpperCase()}] ${message} ${data ? JSON.stringify(data) : ''}\n`;
    
    console.log(logMessage.trim());
    try {
        fs.appendFileSync(logFilePath, logMessage);
    } catch (e) {
        console.error('❌ Failed to write log:', e.message);
    }
}

function getRecentLogs() {
    try {
        if (!fs.existsSync(logFilePath)) return 'No logs recorded yet.';
        const data = fs.readFileSync(logFilePath, 'utf8');
        const lines = data.trim().split('\n');
        // आखिरी के 50 लॉग्स दिखाना
        return lines.slice(-50).join('\n');
    } catch (e) {
        return 'Error reading log file: ' + e.message;
    }
}

module.exports = { debugLog, getRecentLogs };
