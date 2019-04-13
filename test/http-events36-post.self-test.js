'use strict';

const cls = require('../index.js');
const http = require('http');
//const assert = require('assert');

const namespace = cls.createNamespace('ns');

let serverOnData;
let serverOnEnd;
let serverOnRequest;
let serverOnEndDataKey;
let serverOnConnection;
let serverOnConnectionKey;

const server = http.createServer(function onRequestEvent(req, res){
  namespace.run(function onRequestEventNSRun(){
    let body = [];

    namespace.set('key', 1);

    req.on('data', function serverOnRequestDataCB(chunk){
      body.push(chunk);
      serverOnData = namespace.get('key');
      serverOnConnectionKey = namespace.get('ConnKey');
      namespace.set('DataKey', 2);
      process._rawDebug(`------ Server: ${req.method} onData: ${chunk} key=${serverOnData}`);
    });

    req.on('end', function serverOnRequestEndCB(){
      body = Buffer.concat(body).toString();
      serverOnEnd = namespace.get('key');
      serverOnEndDataKey = namespace.get('DataKey');
      process._rawDebug(`------ Server: ${req.method} onEnd: key=${serverOnEnd}`);
      res.end(`${namespace.get('key')}`);
    });

    server.on('request', (request, response) => {
      serverOnRequest = namespace.get('key');
      process._rawDebug(`------ Server: ${req.method} onRequest: key=${serverOnRequest}`);
    });

  });
});

server.listen({port: 58082}, (conn) => {
  namespace.run(function onConnectEventNSRun(){
    serverOnConnection = namespace.get('key');
    namespace.set('ConnKey', 3);
    process._rawDebug(`------ Server: ${conn} onConnection: key=${serverOnConnection}`);
  });
});


const request = http.request({host: 'localhost', port: 58082, method: 'POST'}, function OnClientConnectCB(res){
  res.on('data', (chunk => {
    process._rawDebug(`------ Client: Response onData: responseChunk:${chunk}`);
  }));
  res.on('end', () => {
    process._rawDebug(`------ Client: Response onEnd:`);
    server.close();
    serverOnData === 1 ? process._rawDebug('Assertion: serverOnData === 1') : console.warn(`Assertion: serverOnData === ${serverOnData}`);
    serverOnEnd === 1 ? process._rawDebug('Assertion: serverOnEnd === 1') : console.warn(`Assertion: serverOnEnd === ${serverOnEnd}`);
    serverOnRequest === 1 ? process._rawDebug('Assertion: serverOnRequest === 1') : console.warn(`Assertion: serverOnRequest === ${serverOnRequest}`);
    serverOnEndDataKey === 2 ? process._rawDebug('Assertion: serverOnEndDataKey === 1') : console.warn(`Assertion: serverOnEndDataKey === ${serverOnEndDataKey}`);
    serverOnConnectionKey === 3 ? process._rawDebug('Assertion: serverOnConnectionKey === 1') : console.warn(`Assertion: serverOnConnectionKey === ${serverOnConnectionKey}`);
  });
});

request.write("A message from client");

request.end();






