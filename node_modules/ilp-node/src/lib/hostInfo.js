const fetch = require('node-fetch')

function rollingAvg(existing, measured) {
  if (typeof existing === 'undefined') {
    return measured
  }
  return (existing * 99999 + measured) / 100000
}

module.exports = async function getHostInfo(hostname, /* by ref */ obj) {
  try {
    let protocol = 'https'
    if (hostname.split(':')[0] === 'localhost') {
      protocol = 'http'
    }
    const webFingerUri = `${protocol}://${hostname}/.well-known/webfinger?resource=${protocol}://${hostname}`

    // request
    const startTime = new Date().getTime()
    const response = await fetch(webFingerUri)
    const delay = new Date().getTime() - startTime

    // parsing
    const data = await response.json()
    console.log('data: ', data)
    // { subject: 'https://red.ilpdemo.org',
    //   properties:
    //    { 'https://interledger.org/rel/publicKey': '0ZwLzlPLd2UWJPwYSz6RhOh3S-N-cdAhVqG62iqb6xI',
    //      'https://interledger.org/rel/title': 'Michiel',
    //      'https://interledger.org/rel/protocolVersion': 'Compatible: ilp-kit v2.0.0-alpha' },
    //   links:
    //    [ { rel: 'https://interledger.org/rel/ledgerUri',
    //        href: 'https://red.ilpdemo.org/ledger' },
    //      { rel: 'https://interledger.org/rel/peersRpcUri',
    //        href: 'https://red.ilpdemo.org/api/peers/rpc' },
    //      { rel: 'https://interledger.org/rel/settlementMethods',
    //        href: 'https://red.ilpdemo.org/api/settlement_methods' } ] }
    obj.version = data.properties['https://interledger.org/rel/protocolVersion']
    obj.pubKey = data.properties['https://interledger.org/rel/publicKey']
    obj.title = data.properties['https://interledger.org/rel/title']
    // support ilp-kit version 2:
    if (typeof obj.title !== 'string') {
      console.log('no title!', data, 'trying', `${protocol}://${hostname}/api/config`)
      const configResponse = await fetch(`${protocol}://${hostname}/api/config`)
      const configData = await configResponse.json()
      console.log(configData)
      obj.title = configData.title
    }
    console.log('got pubKey!', obj, data.properties)
    obj.health = rollingAvg(obj.health, 1)
    obj.latency = rollingAvg(obj.latency, delay)

    if (typeof obj.lastDownTime === 'undefined') {
      obj.lastDownTime = new Date().getTime()
    }
    // keep this secret!
    // for (let link of data.links) {
    //   switch (link.rel) {
    //   case 'https://interledger.org/rel/ledgerUri':
    //     obj.ledgerUri = link.href
    //     break
    //   case 'https://interledger.org/rel/peersRpcUri':
    //     obj.peersRpcUri = link.href
    //     break
    //   case 'https://interledger.org/rel/settlementMethods':
    //     obj.settlementMethodsUri = link.href
    //     break
    //   }
    // }
  } catch (error) {
    console.log('error: ', error)
    if (obj.hostname) {
      obj.health = rollingAvg(obj.health, 0)
      obj.lastDownTime = new Date().getTime()
    }
  }
  return obj
}
//updateHostInfo('red.ilpdemo.org', {
//      "hostname": "red.ilpdemo.org",
//      "owner": "",
//      "prefix": "us.usd.red.",
//      "version": "<span style=\"color:green\">Compatible: ilp-kit v1.1.0</span>",
//      "health": 1,
//      "settlements": "<span style=\"color:green\"></span>",
//      "ping": 0,
//      "protocolVersion": "Compatible: ilp-kit v2.0.0-alpha",
//      "publicKey": "0ZwLzlPLd2UWJPwYSz6RhOh3S-N-cdAhVqG62iqb6xI",
//      "ledgerUri": "https://red.ilpdemo.org/ledger",
//      "peersRpcUri": "https://red.ilpdemo.org/api/peers/rpc",
//      "settlementMethods": "https://red.ilpdemo.org/api/settlement_methods"
//    })
