'use strict';

const cls = require('../index.js');
const http = require('http');
const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
chai.should();
chai.use(sinonChai);

describe('http-events36: with http server and client request', () => {

  let requestGetSpy = sinon.spy();
  let requestPostSpy = sinon.spy();
  let requestContextSpy = sinon.spy();
  //let responseSpy = sinon.spy();
  //let responseDataSpy = sinon.spy();
  let _getDone = false;
  let _postDone = false;
  let _ctx;

  before(done => {

    let namespace = cls.createNamespace('ns');

    const server = http.createServer(function onRequestEvent(request, response){
      namespace.run(function onRequestEventNSRun(ctx){
        _ctx = ctx;
        let body = [];

        namespace.set('key', 1);

        request.on('data', function serverOnRequestDataCB(chunk){
          body.push(chunk);
          process._rawDebug(`------ Server: ${request.method} onData: ${chunk}`);
        });

        request.on('end', function serverOnRequestEndCB(){
          body = Buffer.concat(body).toString();
          requestContextSpy(ctx);
          if(request.method === 'GET'){
            requestGetSpy(namespace.get('key'));
          }else if(request.method === 'POST'){
            requestPostSpy(namespace.get('key'));
          }
          process._rawDebug(`------ Server: ${request.method} onEnd: key=${namespace.get('key')}`);
          response.end(`key: ${namespace.get('key')}\r\n`);
        });

      });
    });

    server.listen(58080);

    function DoClientGet(){
      let request = http.request({host: 'localhost', port: 58080, method: 'GET', }, function OnClientConnectCB(res){
        res.on('data', (chunk => {
          //process._rawDebug(`ClientGet: Response Data key: ${namespace.get('key')} responseChunk:${chunk}`);
        }));
        res.on('end', () => {
          //process._rawDebug(`ClientGet: Response Data key: ${namespace.get('key')} responseChunk:${chunk}`);
          _getDone = true;
          CheckClientsFinished();
        });
      });
      request.end( () =>{
        //process._rawDebug(`ClientGet: Request End - key: ${namespace.get('key')}`);
      });
    }

    DoClientGet();

    function DoClientPost(){
      let request = http.request({host: 'localhost', port: 58080, method: 'POST'}, function OnClientConnectCB(res){
        res.on('data', (chunk => {
          //process._rawDebug(`ClientPost: Response Data key: ${namespace.get('key')} responseChunk:${chunk}`);
        }));
        res.on('end', () => {
          //process._rawDebug(`ClientGet: Response Data key: ${namespace.get('key')} responseChunk:${chunk}`);
          _postDone = true;
          CheckClientsFinished();
        });
      });
      request.write("A message from client");
      request.end( () =>{
        //._rawDebug(`ClientPost: Request End - key: ${namespace.get('key')}`);
      });
    }

    DoClientPost();

    function CheckClientsFinished(){
      if(_getDone && _postDone){
        done();
      }
    }

  });

  it('should have key value from GET request', () => {
    requestGetSpy.should.have.been.calledWith(1);
  });

  it('should have key value from POST request', () => {
    requestPostSpy.should.have.been.calledWith(1);
  });



});
