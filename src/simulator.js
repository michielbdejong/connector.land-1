let handlers = {}
module.exports = async function(url, options) {
  if (typeof handlers[url.split('?')[0]] === 'undefined') {
    console.error('cannot fetch!', url.split('?'), Object.keys(handlers))
  }
  let params = {}
  let pairs = url.split('?')[1].split('&')
  pairs.map(pair => {
    params[pair.split('=')[0]] = pair.split('=')[1]
  })
  let ret = await (handlers[url.split('?')[0]] || (() => Promise.resolve()))(url, params, options && options.body)
  return { json: () => ret }
}

module.exports.registerUri = function(url, handler) {
  handlers[url] = handler
}
