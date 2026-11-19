// Preloaded into the SDK surface probe so that loading the real SDK cannot
// reach the network. Any socket or DNS use fails loudly.
const net = require("node:net");
const dns = require("node:dns");

function blocked(what) {
  throw new Error(`network blocked in Daytona SDK probe: ${what}`);
}

net.Socket.prototype.connect = () => blocked("net.Socket.connect");
dns.lookup = () => blocked("dns.lookup");
dns.promises.lookup = async () => blocked("dns.promises.lookup");
globalThis.fetch = async () => blocked("fetch");
