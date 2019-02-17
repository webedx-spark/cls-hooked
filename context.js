/* eslint-disable max-len */
'use strict';

const util = require('util');
const assert = require('assert');
const wrapEmitter = require('emitter-listener');
const async_hooks = require('async_hooks');
const semver = require('semver');

const CONTEXTS_SYMBOL = 'cls@contexts';
const ERROR_SYMBOL = 'error@context';

const DEBUG_CLS_HOOKED = process.env.DEBUG_CLS_HOOKED;

let _currentExecutionId = -1;
let _previousExecutionId = -1;

module.exports = {
  getNamespace: getNamespace,
  createNamespace: createNamespace,
  destroyNamespace: destroyNamespace,
  reset: reset,
  ERROR_SYMBOL: ERROR_SYMBOL
};

// TODO: Check if this impacts JS optimizations.
let getExecutionAsyncId;
if(semver.gte(process.versions.node, '8.2.0')){
  getExecutionAsyncId = function(){
    if(_previousExecutionId !== _currentExecutionId){
      _previousExecutionId = _currentExecutionId;
    }
    _currentExecutionId = async_hooks.executionAsyncId();
    return _currentExecutionId;
  };
}else{
  getExecutionAsyncId = function(){
    if(_previousExecutionId !== _currentExecutionId){
      _previousExecutionId = _currentExecutionId;
    }
    _currentExecutionId = async_hooks.currentId();
    return _currentExecutionId;
  };
}

function Namespace(name){
  this.name = name;
  // changed in 2.7: no default context
  this.active = null;
  this._set = [];
  this.id = null;
  this._contexts = new Map();
  this._indent = 0;
}

Namespace.prototype.set = function set(key, value){
  if(!this.active){
    throw new Error('No context available. ns.run() or ns.bind() must be called first.');
  }

  this.active[key] = value;

  DEBUG_CLS_HOOKED && debug3(`CONTEXT-SET (${this.name}) KEY:${key}=${value}`, null, this, this.active);

  return value;
};

Namespace.prototype.get = function get(key){
  if(!this.active){
    DEBUG_CLS_HOOKED && debug3(`CONTEXT-GETTING KEY NO ACTIVE NS: (${this.name}) KEY:${key}`, null, this);
    return void 0;
  }
  DEBUG_CLS_HOOKED && debug3(`CONTEXT-GETTING KEY: (${this.name}) KEY:${key}`, null, this, this.active);
  return this.active[key];
};

Namespace.prototype.createContext = function createContext(){
  // Prototype inherit existing context if created a new child context within existing context.
  let context = Object.create(this.active ? this.active : Object.prototype);
  context._ns_name = this.name;
  //context.id = _currentExecutionId;
  context.id = getExecutionAsyncId();

  DEBUG_CLS_HOOKED && debug3(`CONTEXT-CREATED Context: (${this.name})`, null, this, context);
  return context;
};

Namespace.prototype.run = function run(fn){
  let context = this.createContext();
  this.enter(context);

  try{
    DEBUG_CLS_HOOKED && debug3(`CONTEXT-RUN BEGIN: (${this.name})`, null, this, context);
    fn(context);
    return context;
  }catch(exception){
    if(exception){
      exception[ERROR_SYMBOL] = context;
    }
    throw exception;
  }finally{
    DEBUG_CLS_HOOKED && debug3(`CONTEXT-RUN END: (${this.name})`, null, this, context);
    this.exit(context);
  }
};

Namespace.prototype.runAndReturn = function runAndReturn(fn){
  let value;
  this.run(function(context){
    value = fn(context);
  });
  return value;
};

/**
 * Uses global Promise and assumes Promise is cls friendly or wrapped already.
 * @param {function} fn
 * @returns {*}
 */
Namespace.prototype.runPromise = function runPromise(fn){
  let context = this.createContext();
  this.enter(context);

  let promise = fn(context);
  if(!promise || !promise.then || !promise.catch){
    throw new Error('fn must return a promise.');
  }

  DEBUG_CLS_HOOKED && debug3(`CONTEXT-runPromise BEFORE: (' + this.name + ')`, null, this, context);

  return promise
  .then(result => {
    DEBUG_CLS_HOOKED && debug3(`CONTEXT-runPromise AFTER then: (' + this.name + ')`, null, this, context);
    this.exit(context);
    return result;
  })
  .catch(err => {
    err[ERROR_SYMBOL] = context;
    DEBUG_CLS_HOOKED && debug3(`CONTEXT-runPromise AFTER catch: (' + this.name + ')`, null, this, context);
    this.exit(context);
    throw err;
  });
};

Namespace.prototype.bind = function bindFactory(fn, context){
  if(!context){
    if(!this.active){
      context = this.createContext();
    }else{
      context = this.active;
    }
  }

  let self = this;
  return function clsBind(){
    self.enter(context);
    try{
      return fn.apply(this, arguments);
    }catch(exception){
      if(exception){
        exception[ERROR_SYMBOL] = context;
      }
      throw exception;
    }finally{
      self.exit(context);
    }
  };
};

Namespace.prototype.enter = function enter(context){
  assert.ok(context, 'context must be provided for entering');

  DEBUG_CLS_HOOKED && debug3(`CONTEXT-ENTER: (${this.name})`, null, this, context);

  this._set.push(this.active);
  this.active = context;
};

Namespace.prototype.exit = function exit(context){
  assert.ok(context, 'context must be provided for exiting');

  DEBUG_CLS_HOOKED && debug3(`CONTEXT-EXIT: (${this.name})`, null, this, context);

  // Fast path for most exits that are at the top of the stack
  if(this.active === context){
    assert.ok(this._set.length, 'can\'t remove top context');
    this.active = this._set.pop();
    return;
  }

  // Fast search in the stack using lastIndexOf
  let index = this._set.lastIndexOf(context);

  if(index < 0){
    DEBUG_CLS_HOOKED && debug2('??ERROR?? context exiting but not entered - ignoring: ' + util.inspect(context));
    assert.ok(index < 0, 'context not currently entered; can\'t exit. \n' + util.inspect(this) + '\n' + util.inspect(context));
  }else{
    assert.ok(index, 'can\'t remove top context');
    this._set.splice(index, 1);
  }
};

Namespace.prototype.bindEmitter = function bindEmitter(emitter){
  assert.ok(emitter.on && emitter.addListener && emitter.emit, 'can only bind real EEs');

  let namespace = this;
  let thisSymbol = 'context@' + this.name;

  // Capture the context active at the time the emitter is bound.
  function attach(listener){
    if(!listener){
      return;
    }
    if(!listener[CONTEXTS_SYMBOL]){
      listener[CONTEXTS_SYMBOL] = Object.create(null);
    }

    listener[CONTEXTS_SYMBOL][thisSymbol] = {
      namespace: namespace,
      context: namespace.active
    };
  }

  // At emit time, bind the listener within the correct context.
  function bind(unwrapped){
    if(!(unwrapped && unwrapped[CONTEXTS_SYMBOL])){
      return unwrapped;
    }

    let wrapped = unwrapped;
    let unwrappedContexts = unwrapped[CONTEXTS_SYMBOL];
    Object.keys(unwrappedContexts).forEach(function(name){
      let thunk = unwrappedContexts[name];
      wrapped = thunk.namespace.bind(wrapped, thunk.context);
    });
    return wrapped;
  }

  wrapEmitter(emitter, attach, bind);
};

/**
 * If an error comes out of a namespace, it will have a context attached to it.
 * This function knows how to find it.
 *
 * @param {Error} exception Possibly annotated error.
 */
Namespace.prototype.fromException = function fromException(exception){
  return exception[ERROR_SYMBOL];
};

function getNamespace(name){
  return process.namespaces[name];
}

function createNamespace(name){
  assert.ok(name, 'namespace must be given a name.');

  if(DEBUG_CLS_HOOKED){
    debug2(`NS-CREATING NAMESPACE (${name})`);
  }
  const namespace = new Namespace(name);
  namespace.id = _currentExecutionId;

  const hook = async_hooks.createHook({
    init(asyncId, type, triggerId, resource){
      const executionAsyncId = getExecutionAsyncId();

      //CHAIN Parent's Context onto child if none exists. This is needed to pass net-events.spec
      // let initContext = namespace.active;
      // if(!initContext && triggerId) {
      //   let parentContext = namespace._contexts.get(triggerId);
      //   if (parentContext) {
      //     namespace.active = parentContext;
      //     namespace._contexts.set(currentExecutionId, parentContext);
      //     if (DEBUG_CLS_HOOKED) {
      //       const indentStr = ' '.repeat(namespace._indent < 0 ? 0 : namespace._indent);
      //       debug2(`${indentStr}INIT [${type}] (${name}) WITH PARENT CONTEXT asyncId:${asyncId} currentExecutionId:${currentExecutionId} triggerId:${triggerId} active:${util.inspect(namespace.active, true)} resource:${resource}`);
      //     }
      //   } else if (DEBUG_CLS_HOOKED) {
      //       const indentStr = ' '.repeat(namespace._indent < 0 ? 0 : namespace._indent);
      //       debug2(`${indentStr}INIT [${type}] (${name}) MISSING CONTEXT asyncId:${asyncId} currentExecutionId:${currentExecutionId} triggerId:${triggerId} active:${util.inspect(namespace.active, true)} resource:${resource}`);
      //     }
      // }else {
      //   namespace._contexts.set(currentExecutionId, namespace.active);
      //   if (DEBUG_CLS_HOOKED) {
      //     const indentStr = ' '.repeat(namespace._indent < 0 ? 0 : namespace._indent);
      //     debug2(`${indentStr}INIT [${type}] (${name}) asyncId:${asyncId} currentExecutionId:${currentExecutionId} triggerId:${triggerId} active:${util.inspect(namespace.active, true)} resource:${resource}`);
      //   }
      // }
      if(namespace.active){
        namespace._contexts.set(asyncId, namespace.active);
        DEBUG_CLS_HOOKED && debug3(`INIT [${type}] (${name})`, asyncId, namespace, null, resource);
      }else {
        const triggerIdContext = namespace._contexts.get(triggerId);
        if(triggerIdContext){
          namespace._contexts.set(asyncId, triggerIdContext);
          DEBUG_CLS_HOOKED && debug3(`INIT USING CONTEXT FROM TRIGGER_ID [${type}] (${name})`, asyncId, namespace, null, resource);
        }

        let executionIdContext;
        // CurrentId will be 0 when triggered from C++. Promise events
        // https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md#triggerid
        if(executionAsyncId !== 0 && (executionIdContext = namespace._contexts.get(executionAsyncId))){
          namespace._contexts.set(asyncId, executionIdContext);
          DEBUG_CLS_HOOKED && debug3(`INIT USING CONTEXT FROM EXECUTION_ID [${type}] (${name})`, asyncId, namespace, null, resource);
        }else{
          const previousExecutionContext = namespace._contexts.get(_previousExecutionId);
          if(previousExecutionContext){
            namespace._contexts.set(asyncId, previousExecutionContext);
            DEBUG_CLS_HOOKED && debug3(`INIT USING CONTEXT FROM PREVIOUS_EXECUTION_ID [${type}] (${name})`, asyncId, namespace, null, resource);
          }else{
            DEBUG_CLS_HOOKED && debug3(`INIT MISSING CONTEXT [${type}] (${name})`, asyncId, namespace, null, resource);
          }
        }
      }

      if(DEBUG_CLS_HOOKED && type === 'PROMISE'){
        const parentId = resource.parentId;
        debug3(`INIT RESOURCE-PROMISE [${type}] (${name}) parentId:${parentId}`, asyncId, namespace, null, resource);
      }

    },
    before(asyncId){
      const executionAsyncId = getExecutionAsyncId();

      let context;

      /*
      if(currentExecutionId === 0){
        // CurrentId(executionAsyncId) will be 0 when triggered from C++. Promise events
        // https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md#triggerid
        //const triggerId = async_hooks.triggerAsyncId();
        context = namespace._contexts.get(asyncId); // || namespace._contexts.get(triggerId);
      }else{
        context = namespace._contexts.get(currentExecutionId);
      }
      */

      //HACK to work with promises until they are fixed in node > 8.1.1
      //context = namespace._contexts.get(asyncId) || namespace._contexts.get(_currentUid) || namespace._contexts.get(async_hooks.triggerAsyncId());
      context = namespace._contexts.get(asyncId) || namespace._contexts.get(async_hooks.triggerAsyncId());

      if(context){
        DEBUG_CLS_HOOKED && debug3(`BEFORE (${name})`, asyncId, namespace, context);
        namespace._indent += 2;
        namespace.enter(context);
      }else{
        DEBUG_CLS_HOOKED && debug3(`BEFORE MISSING CONTEXT (${name})`, asyncId, namespace, context);
        namespace._indent += 2;
      }
    },
    promiseResolve(asyncId){
      const executionAsyncId = getExecutionAsyncId();

      let context;

      //HACK to work with promises until they are fixed in node > 8.1.1
      context = namespace._contexts.get(asyncId) || namespace._contexts.get(executionAsyncId);

      namespace._indent += 2;
      if(context){
        DEBUG_CLS_HOOKED && debug3(`PROMISERESOLVE (${name})`, asyncId, namespace, context);
        namespace.enter(context);
      }else{
        DEBUG_CLS_HOOKED && debug3(`PROMISERESOLVE MISSING CONTEXT (${name})`, asyncId, namespace, context);
      }
    },
    after(asyncId){
      const executionAsyncId = getExecutionAsyncId();

      let context; // = namespace._contexts.get(currentExecutionId);
      /*
      if(currentExecutionId === 0){
        // CurrentId will be 0 when triggered from C++. Promise events
        // https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md#triggerid
        //const triggerId = async_hooks.triggerAsyncId();
        context = namespace._contexts.get(asyncId); // || namespace._contexts.get(triggerId);
      }else{
        context = namespace._contexts.get(currentExecutionId);
      }
      */
      //HACK to work with promises until they are fixed in node > 8.1.1
      //context = namespace._contexts.get(asyncId) || namespace._contexts.get(executionAsyncId) || namespace._contexts.get(async_hooks.triggerAsyncId());
      context = namespace._contexts.get(asyncId) || namespace._contexts.get(async_hooks.triggerAsyncId());

      namespace._indent -= 2;
      if(context){
        DEBUG_CLS_HOOKED && debug3(`AFTER (${name})`, asyncId, namespace, context);
        namespace.exit(context);
      }else {
        DEBUG_CLS_HOOKED && debug3(`AFTER MISSING CONTEXT (${name})`, asyncId, namespace, context);
      }
    },
    destroy(asyncId){
      getExecutionAsyncId();
      DEBUG_CLS_HOOKED && debug3(`DESTROY (${name})`, asyncId, namespace);
      namespace._contexts.delete(asyncId);
    }
  });

  hook.enable();

  process.namespaces[name] = namespace;
  return namespace;
}

function destroyNamespace(name){
  let namespace = getNamespace(name);

  assert.ok(namespace, 'can\'t delete nonexistent namespace! "' + name + '"');
  assert.ok(namespace.id, 'don\'t assign to process.namespaces directly! ' + util.inspect(namespace));

  process.namespaces[name] = null;
}

function reset(){
  // must unregister async listeners
  if(process.namespaces){
    Object.keys(process.namespaces).forEach(function(name){
      destroyNamespace(name);
    });
  }
  process.namespaces = Object.create(null);
}

process.namespaces = Object.create(null);;

//const fs = require('fs');
function debug2(...args){
  if(DEBUG_CLS_HOOKED){
    //fs.writeSync(1, `${util.format(...args)}\n`);
    process._rawDebug(`${util.format(...args)}`);
  }
}

function debug3(msg, asyncId, namespace, context, resource){
  if(DEBUG_CLS_HOOKED){
    const executionAsyncId = getExecutionAsyncId();
    const triggerId = async_hooks.triggerAsyncId();
    const indentStr = ' '.repeat(namespace._indent < 0 ? 0 : namespace._indent);
    if(_currentExecutionId !== executionAsyncId){
      process._rawDebug(`${indentStr}${msg} ****** CEID IS DIFFERENT THAN EID ****** ceid:${_currentExecutionId} peid:${_previousExecutionId} aid:${asyncId} eid:${executionAsyncId} tid:${triggerId} active:${util.inspect(namespace.active, {showHidden: false, depth: 2, colors: false})} context:${util.inspect(context, {showHidden: false, depth: 2, colors: false})} resource:${resource}`);
    }
    process._rawDebug(`${indentStr}${msg} aid:${asyncId} eid:${executionAsyncId} tid:${triggerId} peid:${_previousExecutionId} active:${util.inspect(namespace.active, {showHidden: false, depth: 2, colors: false})} context:${util.inspect(context, {showHidden: false, depth: 2, colors: false})} resource:${resource}`);
  }
}
