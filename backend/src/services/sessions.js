'use strict';
// Shared in-process store for SSH sessions.
// Both ssh.js and scp.js require this same module instance (Node caches it).
const sessions = new Map();
module.exports = sessions;
