'use strict';

const cls = require('../index.js');
const http = require('http');
const assert = require('assert');

const namespace = cls.createNamespace('ns');

let requestOnData;
let requestOnEnd;

const server = http.createServer(function onRequestEvent(req, res){
  namespace.run(function onRequestEventNSRun(){
    let body = [];

    namespace.set('key', 1);

    req.on('data', function serverOnRequestDataCB(chunk){
      body.push(chunk);
      //requestOnData = namespace.get('key');  // Fails but doesn't make sense in a GET request
      process._rawDebug(`------ Server: ${req.method} onData: ${chunk}`);
    });

    req.on('end', function serverOnRequestEndCB(){
      body = Buffer.concat(body).toString();
      requestOnEnd = namespace.get('key');
      process._rawDebug(`------ Server: ${req.method} onEnd: key=${requestOnEnd}`);
      res.end(`${namespace.get('key')}`);
    });

  });
});

server.listen(58093);


const request = http.request({host: 'localhost', port: 58093, method: 'GET'}, function OnClientConnectCB(res){
  res.on('data', (chunk => {
    process._rawDebug(`Client: Response Data: responseChunk:${chunk}\r\n`);
  }));
  res.on('end', () => {
    server.close();
    //assert(requestOnData === 1);
    assert(requestOnEnd === 1);
  });
});

request.end();






