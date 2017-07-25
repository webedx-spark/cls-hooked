'use strict';

const expect = require('chai').expect;
const cls = require('../index.js');

describe('cls simple async local context', function () {
    let namespace;

    before(function(){
      namespace = cls.createNamespace('namespace');
    });

    it('asynchronously propagating state with local-context', function (done) {

        expect(process.namespaces.namespace, 'namespace has been created');

        namespace.run(function () {
            namespace.set('test', 1337);
            expect(namespace.get('test')).equal(1337, 'namespace is working');
            done();
        });
    });

    it('should destroy context pointers in _set', function (){
        expect(namespace._set.length).equal(0, '_set cleared of contexts');
    });

    it('should destroy context pointers in _contexts', function (){
        expect(namespace._contexts.size).equal(0, '_contexts cleared of contexts');
    });
});
