const IlpNode = require('../ilp-node-src')
let storage = {}

const simulator = require('./simulator')

const node1 = new IlpNode({ set: function(k, v) { storage['1_' + k] = v }, get: function(k) { return storage['1_' + k] } }, 'asdf1.com', simulator)
const node2 = new IlpNode({ set: function(k, v) { storage['2_' + k] = v }, get: function(k) { return storage['2_' + k] } }, 'asdf2.com', simulator)
const node3 = new IlpNode({ set: function(k, v) { storage['3_' + k] = v }, get: function(k) { return storage['3_' + k] } }, 'asdf3.com', simulator)

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
