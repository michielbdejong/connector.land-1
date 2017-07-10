var package = require('../../package.json')

module.exports = (resource, creds, hostname) => {
  if (typeof resource !== 'string') {
    return
  }
  let protocol = 'https'
  if (hostname.split(':')[0] === 'localhost') {
    protocol = 'http'
  }
  if (resource === `${protocol}://${hostname}`) {
    console.log('host resource!')
    return {
      subject: resource,
      properties: {
        'https://interledger.org/rel/protocolVersion': `Compatible: ${package.name} v${package.version}`,
        'https://interledger.org/rel/publicKey': creds.keypair.pub
      },
      links:[
        { rel: 'https://interledger.org/rel/peersRpcUri', href: `https://${hostname}/rpc`}
      ]
    }
  } else if (resource.startsWith('acct:')) {
    const parts = resource.substring('acct:'.length).split('@')
    if (parts[1] === hostname) {
      return {
        subject: resource,
        links: [
          { rel: 'https://interledger.org/rel/ilpAddress', href: `g.dns.${hostname.split('.').reverse().join('.')}.${parts[0]}` },
          { rel: 'https://interledger.org/rel/spsp/v2', href: `https://${hostname}/spsp` }
        ]
      }
    }
  }
  console.log('Uh oh! reached the end!', { resource, creds, hostname })
}
