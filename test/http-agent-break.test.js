'use strict';

const chai = require('chai');
const expect = chai.expect;
const should = chai.should();

const superagent = require('superagent');

const cls = require('./../index');
const http = require('http');

const keepAlive = process.env.KEEP_ALIVE !== '0';

describe('cls with http Agent', () => {

  let httpAgent;
  let namespace = cls.createNamespace('httpAgent');

  before(() => {
    httpAgent = new http.Agent({
      keepAlive: keepAlive,
      maxSockets: 1,
      keepAliveMsecs: 30000
    });
  });


  describe('when making two http requests', ()=> {

    let innerRequestContextValue;

    it('should retain context during first', (done)=> {
      doClsAction(123, () => {
        should.exist(innerRequestContextValue)
        innerRequestContextValue.should.equal(123);
        done();
      });
    });


    it('should retain context during second', (done)=> {
      doClsAction(456, () => {
        should.exist(innerRequestContextValue)
        innerRequestContextValue.should.equal(456);
        done();
      });
    });


    it('should destroy context pointers in _set', function (){
      var loadLocalFunc = mapToArray;
      expect(namespace._set.length).equal(0, '_set cleared of contexts');
    });

    it('should destroy context pointers in _contexts', function (){

      /**
       * Converts `map` to its key-value pairs.
       *
       * @private
       * @param {Object} map The map to convert.
       * @returns {Array} Returns the key-value pairs.
       */
      function mapToArray(map) {
        let index = -1;
        let result = Array(map.size);

        map.forEach(function(value, key) {
          result[++index] = [key, value];
        });
        return result;
      }

      expect(namespace._contexts.size).equal(0, '_contexts cleared of contexts');
    });

    function doClsAction(id, cb) {
      namespace.run(function () {
        //var xid = Math.floor(Math.random() * 1000);
        var xid = id;
        namespace.set('xid', xid);
        //process._rawDebug('before calling httpGetRequest: xid value', namespace.get('xid'));

        httpGetRequest(function (e) {
          //process._rawDebug('returned from action xid value', namespace.get('xid'), 'expected', xid);
          innerRequestContextValue = namespace.get('xid');
          //assert.equal(namespace.get('xid'), xid);
          cb(e);
        });

      });
    }


    /**
     * Converts `map` to its key-value pairs.
     *
     * @private
     * @param {Object} map The map to convert.
     * @returns {Array} Returns the key-value pairs.
     */
    function mapToArray(map) {
      let index = -1;
      let result = Array(map.size);

      map.forEach(function(value, key) {
        result[++index] = [key, value];
      });
      return result;
    }

    function httpGetRequest(cb) {

      //https://github.com/othiym23/node-continuation-local-storage/issues/71
      namespace.bindEmitter(superagent.Request.super_.super_.prototype);

      var req = superagent['get']('http://www.google.com');

      if (keepAlive) {
        //process._rawDebug('Keep alive ENABLED, setting http agent');
        req.agent(httpAgent);
      }

      req.end(function (err, res) {
        if (err) {
          cb(err);
        } else {
          //process._rawDebug('http get status', res.status);
          cb(null, {status: res.status, statusText: res.text, obj: res.body});
        }
      });
    }

  });

});
