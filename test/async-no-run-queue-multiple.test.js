'use strict';

const expect = require('chai').expect;
const cls = require('../index.js');

describe('cls edges and regression testing', function() {
  let namespace;

  before(function() {
    namespace = cls.createNamespace('test');
  })

  it('minimized test case that caused #6011 patch to fail', function(done) {

    console.log('+');
    // when the flaw was in the patch, commenting out this line would fix things:
    process.nextTick(function() {
      console.log('!');
    });

    expect(!namespace.get('state'), 'state should not yet be visible');

    namespace.run(function() {
      namespace.set('state', true);
      expect(namespace.get('state'), 'state should be visible');

      process.nextTick(function() {
        expect(namespace.get('state'), 'state should be visible');
        done();
      });
    });
  });

  it('should destroy context pointers in _set', function (){
    expect(namespace._set.length).equal(0, '_set cleared of contexts');
  });

  it('should destroy context pointers in _contexts', function (){
    expect(namespace._contexts.size).equal(0, '_contexts cleared of contexts');
  });


});
