const IlpNode = require('../ilp-node-src')
let storage = {}

const simulator = require('./simulator')

const node1 = new IlpNode({ set: function(k, v, cb) { storage['1_' + k] = v; cb() }, get: function(k, cb) { cb(null, storage['1_' + k] || null) } }, 'asdf1.com', simulator)
const node2 = new IlpNode({ set: function(k, v, cb) { storage['2_' + k] = v; cb() }, get: function(k, cb) { cb(null, storage['2_' + k] || null) } }, 'asdf2.com', simulator)
const node3 = new IlpNode({ set: function(k, v, cb) { storage['3_' + k] = v; cb() }, get: function(k, cb) { cb(null, storage['3_' + k] || null) } }, 'asdf3.com', simulator)

simulator.registerUri('https', 'asdf1.com', '/.well-known/webfinger', node1.handleWebFinger)
simulator.registerUri('https', 'asdf1.com', '/rpc', node1.handleRpc)

simulator.registerUri('https', 'asdf2.com', '/.well-known/webfinger', node2.handleWebFinger)
simulator.registerUri('https', 'asdf2.com', '/rpc', node2.handleRpc)

simulator.registerUri('https', 'asdf3.com', '/.well-known/webfinger', node3.handleWebFinger)
simulator.registerUri('https', 'asdf3.com', '/rpc', node3.handleRpc)

node1.peerWith('asdf2.com')
node1.peerWith('asdf3.com')

node2.peerWith('asdf3.com')
node2.peerWith('asdf1.com')

node3.peerWith('asdf1.com')
node3.peerWith('asdf2.com')
