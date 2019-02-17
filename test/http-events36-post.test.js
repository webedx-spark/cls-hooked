'use strict';

const cls = require('../index.js');
const http = require('http');
const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
chai.should();
chai.use(sinonChai);

describe('http-events36-post: with http server and client request', () => {

  let requestonDataPostSpy = sinon.spy();
  let requestonEndPostSpy = sinon.spy();
  let clientResponsePostSpy = sinon.spy();

  before(done => {

    let namespace = cls.createNamespace('ns');

    const server = http.createServer(function onRequestEvent(request, response){
      namespace.run(function onRequestEventNSRun(){
        let body = [];

        namespace.set('key', 1);

        request.on('data', function serverOnRequestDataCB(chunk){
          body.push(chunk);
          requestonDataPostSpy(namespace.get('key'));
          process._rawDebug(`------ Server: ${request.method} onData: ${chunk}`);
        });

        request.on('end', function serverOnRequestEndCB(){
          body = Buffer.concat(body).toString();
          requestonEndPostSpy(namespace.get('key'));
          process._rawDebug(`------ Server: ${request.method} onEnd: key=${namespace.get('key')}`);
          response.end(`${namespace.get('key')}`);
        });

      });
    });

    server.listen(58082);

    function DoClientPost(){
      let request = http.request({host: 'localhost', port: 58082, method: 'POST'}, function OnClientConnectCB(res){
        res.on('data', (chunk => {
          process._rawDebug(`ClientPost: Response Data key: ${namespace.get('key')} responseChunk:${chunk}\r\n`);
          clientResponsePostSpy(chunk);
        }));
        res.on('end', () => {
          //process._rawDebug(`ClientPost: Response Data key: ${namespace.get('key')} responseChunk:${chunk}`);
          done();
        });
      });
      request.write("A message from client");
      request.end();
    }

    DoClientPost();

  });

  it('client should have received a response from server', () => {
    clientResponsePostSpy.should.have.been.called;
  });

  it('server should have key value of 1 inside \'data\' event in POST request', () => {
    requestonDataPostSpy.should.have.been.calledWith(1);
  });

  it('server should have key value of 1 inside \'end\' event in POST request', () => {
    requestonEndPostSpy.should.have.been.calledWith(1);
  });



});
