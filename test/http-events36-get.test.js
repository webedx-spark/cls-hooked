'use strict';

const cls = require('../index.js');
const http = require('http');
const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
chai.should();
chai.use(sinonChai);

describe('http-events36-get: with http server and client get request', () => {

  let requestGetSpy = sinon.spy();

  before(done => {

    let namespace = cls.createNamespace('ns');

    const server = http.createServer(function onRequestEvent(request, response){
      namespace.run(function onRequestEventNSRun(){
        let body = [];

        namespace.set('key', 1);

        request.on('data', function serverOnRequestDataCB(chunk){
          body.push(chunk);
          process._rawDebug(`------ Server: ${request.method} onData: ${chunk}`);
        });

        request.on('end', function serverOnRequestEndCB(){
          body = Buffer.concat(body).toString();
          requestGetSpy(namespace.get('key'));
          process._rawDebug(`------ Server: ${request.method} onEnd: key=${namespace.get('key')}`);
          response.end(`key: ${namespace.get('key')}\r\n`);
        });

      });
    });

    server.listen(58081);

    function DoClientGet(){
      let request = http.request({host: 'localhost', port: 58081, method: 'GET', }, function OnClientConnectCB(res){
        res.on('data', (chunk => {
          //process._rawDebug(`ClientGet: Response Data key: ${namespace.get('key')} responseChunk:${chunk}`);
        }));
        res.on('end', () => {
          //process._rawDebug(`ClientGet: Response Data key: ${namespace.get('key')} responseChunk:${chunk}`);
          done();
        });
      });
      request.end();
    }

    DoClientGet();

  });

  it('should have key value from GET request', () => {
    requestGetSpy.should.have.been.calledWith(1);
  });


});
