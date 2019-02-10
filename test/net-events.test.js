'use strict';

const cls = require('../index.js');
require('mocha');
const chai = require('chai');
const should = chai.should();
const net = require('net');
const util = require('util');
const DEBUG_CLS_HOOKED = process.env.DEBUG_CLS_HOOKED;

//net-eventsX.test.js Tests PASS in Node <= v8.9.4 but FAIL in >= 8.10.0
//nvm install 8.9.4 && nvm use 8.9.4
//npm i -g mocha rimraf && rimraf node_modules && npm i && npm test

describe('cls with net connection', () => {

  let namespace = cls.createNamespace('net');
  let testValue1;
  let testValue2;
  let testValue3;
  let testValue4;

  before(function(done) {

    let serverDone = false;
    let clientDone = false;

    DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [1]: First namespace.run`);
    namespace.run(() => {
      namespace.set('test', 'originalValue');

      let server;

      DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [2]: Second namespace.run`);
      namespace.run(() => {
        namespace.set('test', 'newContextValue');

        DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [4]: net.createServer`);
        server = net.createServer((socket) => {
          //namespace.bindEmitter(socket);

          testValue1 = namespace.get('test');
          DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [5]: testValue1:${testValue1}`);

          DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [6]: socket.on('data')`);
          socket.on('data', () => {
            testValue2 = namespace.get('test');
            DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [7]: testValue2:${testValue2}`);

            DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [8]: server.close()`);
            server.close();

            DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [9]: socket.end()`);
            socket.end('GoodBye');

            serverDone = true;
            checkDone();
          });

        });

        DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [10]: server.listen()`);
        server.listen(() => {
          const address = server.address();

          DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [11]: server.listen ${JSON.stringify(address)} - Third namespace.run`);
          namespace.run(() => {
            namespace.set('test', 'MONKEY');

            DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [12]: net.connect`);
            const client = net.connect({port: address.port, family:4}, () => {
              //namespace.bindEmitter(client);
              testValue3 = namespace.get('test');
              DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [13]: testValue3:${testValue3}`);
              DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [14]: client.write`);
              client.write('Hello');

              DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [15]: client.on('data')`);
              client.on('data', () => {
                testValue4 = namespace.get('test');

                DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [16]: testValue4:${testValue4}`);
                clientDone = true;
                checkDone();
              });

            });
          });
        });
      });
    });

    function checkDone() {
      DEBUG_CLS_HOOKED && debug2(`NET-EVENTS.TEST [--]: checkDone serverDone:${serverDone} clientDone:${clientDone}`);
      if (serverDone && clientDone) {
        done();
      }
    }

  });

  it('value newContextValue', () => {
    should.exist(testValue1);
    testValue1.should.equal('newContextValue');
  });

  it('value newContextValue 2', () => {
    should.exist(testValue2);
    testValue2.should.equal('newContextValue');
  });

  it('value MONKEY', () => {
    should.exist(testValue3);
    testValue3.should.equal('MONKEY');
  });

  it('value MONKEY 2', () => {
    should.exist(testValue4);
    testValue4.should.equal('MONKEY');
  });

});

function debug2(...args) {
  if (DEBUG_CLS_HOOKED) {
    //fs.writeSync(1, `${util.format(...args)}\n`);
    process._rawDebug(`${util.format(...args)}`);
  }
}
