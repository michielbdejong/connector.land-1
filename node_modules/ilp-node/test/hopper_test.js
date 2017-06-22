var assert = require('assert')
assert.closeTo = function(a, b) {
  return assert.equal(a.toFixed(8), b.toFixed(8))
}

var Hopper = require('../src/lib/hopper')

function MockIlpNode(peers) {
  this.peers = peers
}

function MockPeer(routes) {
  this.routes = routes
  this.rate = 1
}

describe('calcSlope', function() {
  it('should calculate a slope', function() {
    assert.equal(Hopper.calcSlope([0, 0], [10, 5]), .5)
    assert.equal(Hopper.calcSlope([0, 5], [10, 5]), 0)
    assert.equal(Hopper.calcSlope([0, 15], [10, -3]), -1.8)
    assert.equal(Hopper.calcSlope([10, 5], [0, 5]), 0)
  })
})

describe('valueAt', function() {
  it('should calculate a value', function() {
    assert.closeTo(Hopper.valueAt({
     startIn: 10,
     startOut: 12,
     slope: -2.8
    }, 14), 0.8) // 12 + -2.8*4 = 12 - 11.2 = 0.8
  })
})

describe('usefulAt', function() {
  it('should calculate usefulness', function() {
    assert.equal(Hopper.usefulAt({
     startIn: 12,
     startOut: 10,
     slope: 3 // value at 11 is 12+3 = 15
    }, {
     startIn: 13,
     startOut: 11,
     slope: 2
    }), true) // because 15 > 11
  })
})

describe('Simple ilp node', function() {
  beforeEach(function() {
    this.routes = {
      'g.destination.': [
        [0, 0],
        [10, 5],
        [20, 8]
      ]
    }
    this.peers = {
      'example.com': new MockPeer(this.routes)
    }
    this.node = new MockIlpNode(this.peers)
  })

  describe('Table', function() {
    describe('constructor', function() {
      it('should instantiate an object', function() {
        let table = new Hopper.Table('g.destination.', this.peers[0])
        assert.equal(typeof table, 'object')
      })
    })
  })
  
  describe('Curve', function() {
    describe('constructor', function() {
      it('should instantiate an object', function() {
        let curve = new Hopper.Curve(this.node, 'example.com', 'g.destination.')
        assert.equal(typeof curve, 'object')
      })
    })
  })
})
