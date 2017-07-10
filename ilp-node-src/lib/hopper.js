const COMMISSION=1.337

const Oer = require('oer-utils')

function Hopper(peersDict) {
  this.peers = peersDict
  this.table = new Table()
}

// this is where the Interledger chaining layer is implemented! Namely, forward a payment if all of:
// 1) expiry > nextExpiry, so that this connector has time to fulfill
// 2) amount > exchangeRate(nextAmount), so that this connector makes a bit of money
// 3) condition = nextCondition, so that if the next payment gets fulfilled, this connector can also fulfill the source payment
Hopper.prototype.forward = function(bodyObj) {
  // 1) expiry > nextExpiry:
  if (bodyObj.expiresAt - new Date() < MIN_MESSAGE_WINDOW) { // don't try to predict forward message window, we just care about securing the backward one
    bodyObj.method = 'reject'
    bodyObj.reason = 'not enough time'
    return bodyObj
  }
  const nextExpiry = new Date(new Date(bodyObj.expiresAt).getTime() - MIN_MESSAGE_WINDOW)

  const bestHop = this.getBestHop(bodyObj.ilp)
  // 2) check amount > exchangeRate(nextAmount):
  if (bodyObj.amount <= bestHop.nextAmount) {
    bodyObj.method = 'reject'
    bodyObj.reason = 'not enough money'
    return bodyObj
  }
  // 3) ensure condition = nextCondition, and forward the payment:
  return this.peers[bestHop.nextHost].pay(bestHop.nextAmount, bodyObj.condition, nextExpiry, bodyObj.ilp)
}

// The rest of the Hopper class implements routing tables:
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

function Table() {
  this.routes = {}
  this.subTables = {}
}

Table.prototype = {
  findSubTable(addressParts) {
    if (addressParts.length === 1) {
      return this
    } else {
      if (this.subTables[addressParts[0]] === undefined) {
        this.subTables[addressParts[0]] = new Table()
      }
      return this.subTables[addressParts[0]]
    }
  },
  addRoute(peerHost, routeObj, andBroadcast = false) {
    const subTable = this.findSubTable(routeObj.destination_ledger.split('.'))
    subTable.routes[peerHost] = routeObj
    if (andBroadcast) {
      Object.keys(this.peers).map(otherPeer => {
        console.log('forwarding broadcast from-to', peerHost, otherPeer)
        if (otherPeer !== peerHost) {
          this.peers[otherPeer].announceRoute(routeObj.destination_ledger, routeObj.curve) // TODO: apply own rate
        }
      })
    }
  },
  removeRoute(targetPrefix, peerHost) {
    const subTable = this.findSubTable(targetPrefix.split('.'))
    delete subTable.routes[peerHost]
  },
  findBestHop(packet) {
    const reader1 = Oer.Reader.from(Buffer.fromData(packet, 'base64'))
    const packetType = reader1.readUInt8()
    if (packetType !== 1 /* TYPE_ILP_PAYMENT */) {
      throw new Error('Packet has incorrect type')
    }
    const contents = reader1.readVarOctetString()
    const reader2 = Oer.Reader.from(contents)
    const destAmountHighBits = reader2.readUInt32()
    const destAmountLowBits = reader2.readUInt32()
    const destAccount = reader2.readVarOctetString().toString('ascii')
    const subTable = this.findSubtable(destAccount)
    let bestHost
    let bestDistance
    let bestPrice
    for (let peerHost in this.routes) {
      let thisDistance = calcDistance(this.routes[peerHost])
      if (bestHost && bestDistance < thisDistance) {
        continue // too long, discard
      }
      let thisPrice = calcPrice(this.routes[peerHost], sourceAmount, destAmountLowBits)
      if (bestHop && bestPrice <= thisPrice) {
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
