const COMMISSION=1.337
const MIN_MESSAGE_WINDOW = 10000

const Oer = require('oer-utils')
const uuid = require('uuid/v4')
const crypto = require('crypto')
const sha256 = (secret) => { return crypto.createHmac('sha256', secret).digest('base64') }

function Hopper(ilpNodeObj) {
  this.ilpNodeObj = ilpNodeObj
  this.table = new Table(this.ilpNodeObj, '')
  this.pending = {}
  this.paymentsInitiatedById = {}
  this.paymentsInitiatedByCondition = {}
}

function makeFulfillment(id, preimage) { return { method: 'fulfill_condition', body: [ id, preimage ] } }
function makeRejection(id, reason) { return { method: 'reject_incoming_transfer', body: [ id, reason ] } }

// this is where the Interledger chaining layer is implemented! Forward a payment if all of 1), 2), and 3):
Hopper.prototype = {
  handleTransfer(transfer, incomingPeerHost) {
    // 1) expiry > nextExpiry, so that this connector has time to fulfill
    if (transfer.expiresAt - new Date() < MIN_MESSAGE_WINDOW) { return Promise.resolve(makeRejection(transfer.id, 'not enough time')) }
    const nextExpiryMs = new Date(transfer.expiresAt).getTime() - MIN_MESSAGE_WINDOW
  
    // this is the path finding step:
    const bestHop = this.table.findBestHop(transfer.ilp)

    // this is the receiver:
    if (bestHop.isLocal) {
      if (!this.paymentsInitiatedByCondition[transfer.executionCondition]) {
        return Promise.resolve(makeRejection(transfer.id, 'unknown condition'))
      }
      return Promise.resolve(makeFulfillment(transfer.id, this.paymentsInitiatedByCondition[transfer.executionCondition]))
    }
 
    // 2) amount > exchangeRate(nextAmount), so that this connector makes a bit of money
    if (transfer.amount <= bestHop.nextAmount) { return Promise.resolve(makeRejection(transfer.id, 'not enough money')) }
  
    // 3) condition = nextCondition, so that if the next payment gets fulfilled, this connector can also fulfill the source payment
    if (typeof this.ilpNodeObj.peers[bestHop.nextHost] === 'undefined') { return Promise.resolve(makeRejection(transfer.id, 'no route found')) }
  
    // in current protocol (bit annoyingly I guess?), this call returns immediately, and the connector will be called back:
    const outgoingUuid = uuid()
    this.ilpNodeObj.peers[bestHop.nextHost].sendTransfer(bestHop.nextAmount, transfer.executionCondition, nextExpiryMs, transfer.ilp, outgoingUuid)
    return new Promise(resolve => {
      this.pending[outgoingUuid] = {
        incomingPeerHost,
        incomingUuid: transfer.id,
        executionCondition: transfer.executionCondition,
        resolve
      }
    })
  },
  handleTransferResult(method, bodyObj) {
    if (Array.isArray(bodyObj) && this.paymentsInitiatedById[bodyObj[0]]) { // check if we were the sender
      if (method === 'fulfill_condition') {
        if (bodyObj[1] === this.paymentsInitiatedById[bodyObj[0]]) {
          // console.log('TEST PAYMENT WAS SUCCESSFUL!')
        } else {
          console.log('TEST PAYMENT FULFILLMENT WRONG!', bodyObj, this.paymentsInitiatedById)
        }
      } else {
        console.log('TEST PAYMENT REJECTED!', method, bodyObj)
      }
      delete this.paymentsInitiatedById[bodyObj[0]]
    } else { // check if we forwarded this transfer
      let remembered = this.pending[bodyObj[0]]
      if (typeof remembered !== 'object') {
        console.log('panic!', { method, bodyObj, remembered, pending: this.pending })
      }
      delete this.pending[bodyObj[0]]
      if (method === 'fulfill_condition' && bodyObj[1] && sha256(bodyObj[1]) === remembered.executionCondition) {
        return this.ilpNodeObj.peers[remembered.incomingPeerHost].postToPeer('fulfill_condition', [ remembered.incomingUuid, bodyObj[1] ], true)
      } else {
        return this.ilpNodeObj.peers[remembered.incomingPeerHost].postToPeer('reject_incoming_transfer', [ remembered.incomingUuid, bodyObj[1] ], true)
      }
    }
  }
}

// The rest of this file implements routing tables:
// Given an ilp packet's address and amount, decide
// * shortestPath & cheapest nextHost to forward it to
// * efficient nextAmount that will satisfy that nextHost

function calcDistance(route) {
  let longest = 0
  route.paths.map(path => {
    if (path.length > longest) {
      longest = path.length
    }
  })
}

function calcPrice(route, sourceAmount, finalAmount) {
  let buffer = Buffer.from(route.points, 'base64')
  const array = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
  let prevX = 0
  let prevY = 0
  for (let i = 0; i < array.length; i += 4) {
    // const xHi = array[i]
    const xLo = array[i + 1]
    // const yHi = array[i + 2]
    const yLo = array[i + 3]
    if (sourceAmount && sourceAmount >= prevX && sourceAmount <= xLo) {
      return (prevY + (sourceAmount - prevX) * (yLo - prevY) / (xLo - prevX)) / COMMISSION
    }
    if (finalAmount && finalAmount >= prevY && finalAmount <= yLo) {
      return (prevX + (finalAmount - prevY) * (xLo - prevX) / (yLo - prevY)) * COMMISSION
    }
    prevX = xLo
    prevY = yLo
  }
}

function Table(ilpNodeObj, prefix = '') {
  this.prefix = prefix
  this.ilpNodeObj = ilpNodeObj
  this.routes = {}
  this.subTables = {}
}

Table.prototype = {
  findSubTable(addressParts, orLastAncestor) {
    if (addressParts.length === 1) {
      return this
    } else {
      const nextPart = addressParts.shift()
      if (this.subTables[nextPart] === undefined) {
        if (orLastAncestor) {
          return this
        }
        this.subTables[nextPart] = new Table(this.ilpNodeObj, this.prefix + nextPart + '.')
      }
      return this.subTables[nextPart].findSubTable(addressParts, orLastAncestor)
    }
  },
  debugTable() {
    return {
      prefix: this.prefix,
      routes: this.routes,
      subTables: Object.keys(this.subTables).map(subTableName => { return { subTableName, contents: this.subTables[subTableName].debugTable() } })
    }
  },
  addRoute(peerHost, routeObj, andBroadcast = false) {
    const subTable = this.findSubTable(routeObj.destination_ledger.split('.'), false)
    subTable.routes[peerHost] = routeObj
    if (andBroadcast) {
      Object.keys(this.ilpNodeObj.peers).map(otherPeer => {
        if (otherPeer !== peerHost) {
          this.ilpNodeObj.peers[otherPeer].announceRoute(routeObj.destination_ledger, routeObj.points) // TODO: apply own rate
        }
      })
    }
  },
  removeRoute(targetPrefix, peerHost) {
    const subTable = this.findSubTable(targetPrefix.split('.'), true)
    if (subTable.prefix === targetPrefix) {
      delete subTable.routes[peerHost]
    }
  },
  findBestHop(packet) {
    const reader1 = Oer.Reader.from(Buffer.from(packet, 'base64'))
    const packetType = reader1.readUInt8() // should be 1 for TYPE_ILP_PAYMENT
    const reader2 = Oer.Reader.from(reader1.readVarOctetString())
    const destAmountHighBits = reader2.readUInt32()
    const destAmountLowBits = reader2.readUInt32()
    const destAccount = reader2.readVarOctetString().toString('ascii')
    if (destAccount.startsWith(this.ilpNodeObj.testLedger)) {
      // console.log('best hop is local!', destAccount)
      return {
        isLocal: true,
        destAmountHighBits,
        destAmountLowBits,
        destAccount
      }
    }
    const subTable = this.findSubTable(destAccount.split('.'), true)
    let bestHost
    let bestDistance
    let bestPrice
    // console.log('comparing various hops', Object.keys(subTable.routes))
    for (let peerHost in subTable.routes) {
      let thisDistance = calcDistance(subTable.routes[peerHost])
      if (bestHost && bestDistance < thisDistance) {
        continue // too long, discard
      }
      let thisPrice = calcPrice(subTable.routes[peerHost], undefined, destAmountLowBits)
      if (bestHost && bestPrice <= thisPrice) {
        continue // too expensive, discard
      }
      bestHost = peerHost
      bestDistance = thisDistance
      bestPrice = thisPrice
    }
    return { nextHost: bestHost, nextAmount: bestPrice }
  }
}

module.exports = { Hopper }
