const COMMISSION=1.337

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
  addRoute(routeObj) {
    const subTable = this.findSubTable(routeObj.destination_ledger.split('.'))
    subTable.routes[routeObj.source_ledger] = routeObj
  },
  removeRoute(targetPrefix) {
    const subTable = this.findSubTable(targetPrefix.split('.'))
    delete subTable.routes[routeObj.source_ledger]
  },
  findBestHop(finalAddress, sourceAmount, finalAmount) {
    const subTable = this.findSubtable(finalAddress)
    let bestHop
    let bestDistance
    let bestPrice
    for (let peerLedger in this.routes) {
      let thisDistance = calcDistance(this.routes[peerLedger])
      if (bestHop && bestDistance < thisDistance) {
        continue // too long, discard
      }
      let thisPrice = calcPrice(this.routes[peerLedger], sourceAmount, finalAmount)
      if (bestHop && bestPrice <= thisPrice) {
        continue // too expensive, discard
      }
      bestHop = peerLedger
      bestDistance = thisDistance
      bestPrice = thisPrice
    }
    return { bestHop, bestDistance, bestPrice }
  }
}
